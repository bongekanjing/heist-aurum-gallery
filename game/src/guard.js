// Guards: the body that walks a fixed route, the head that sweeps a cone as it walks, and the
// maths that decides what that cone actually sees. A guard also has ears: a footstep or a thrown
// noisemaker louder than its surroundings pulls it off its route to look.
//
// The cone is the game's whole threat model, so it lives here rather than in the renderer: the
// renderer draws `guardSightCone(guard)`, and detection uses the same numbers. What you see is
// exactly what catches you.
import { GUARD, HEARING, ALARM } from './config.js';
import { isSightBlocked, resolveAgainstSolids } from './level.js';

const TAU = Math.PI * 2;

/** The signed smallest angle from `b` to `a`, in (-PI, PI]. */
export function angleDifference(a, b) {
  let delta = (a - b) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta <= -Math.PI) delta += TAU;
  return delta;
}

/** Turn `current` toward `wanted` by at most `rate * dt` radians. */
function turnToward(current, wanted, rate, dt) {
  const delta = angleDifference(wanted, current);
  const step = rate * dt;
  if (Math.abs(delta) <= step) return wanted;
  return current + Math.sign(delta) * step;
}

/** How widely a guard's head is scanning: wider when it is standing still or searching. */
function sweepAmplitude(guard) {
  if (guard.state === 'investigate') return GUARD.sweepAmplitude * 1.7;
  if (guard.state === 'patrol' && guard.dwell > 0) return GUARD.sweepAmplitude * 1.35;
  return GUARD.sweepAmplitude;
}

/**
 * Build one guard from a patrol route. It starts on the route's first waypoint, already facing
 * the way it is about to walk, with its own sweep phase so the room never pulses in unison.
 */
function createGuardFromRoute(route, index, random) {
  const first = route.waypoints[0];
  const second = route.waypoints[1 % route.waypoints.length];
  return {
    id: route.id,
    name: route.name,
    colour: route.colour,
    index,
    route,
    x: first.x,
    y: first.y,
    heading: Math.atan2(second.y - first.y, second.x - first.x),
    facing: 0,
    sweepPhase: random() * TAU,
    targetIndex: 1 % route.waypoints.length,
    dwell: 0,
    speed: route.speed,
    state: 'patrol',
    investigate: null,
    listen: 0,
    notice: 0,
    /** Set for one frame when the alarm first bites: the renderer flashes the guard. */
    alarmed: 0,
  };
}

/** Every guard the level's patrol routes call for. */
export function createGuards(level, random) {
  return level.patrolRoutes.map((route, index) => createGuardFromRoute(route, index, random));
}

/** The wedge the guard is looking down right now. Detection and drawing both read this. */
export function guardSightCone(guard) {
  const halfAngle = guard.state === 'investigate' ? GUARD.alertHalfAngle : GUARD.coneHalfAngle;
  return {
    x: guard.x,
    y: guard.y,
    facing: guard.facing,
    halfAngle,
    range: GUARD.coneRange,
  };
}

/**
 * Walk one guard forward one step: the route, the dwell at each waypoint, the swing of its head,
 * and an errand to a noise if it heard one. `world` supplies the clock the sweep reads.
 */
export function updateGuard(guard, level, dt, world) {
  let goal = null;

  if (guard.state === 'investigate' && guard.investigate) {
    goal = guard.investigate;
    const dx = goal.x - guard.x;
    const dy = goal.y - guard.y;
    if (Math.sqrt(dx * dx + dy * dy) <= GUARD.arriveRadius * 1.6) {
      goal = null;
      guard.investigate.arrived = true;
      guard.investigate.timer -= dt;
      if (guard.investigate.timer <= 0) {
        guard.state = 'patrol';
        guard.investigate = null;
        guard.targetIndex = nearestWaypoint(guard);
      }
      guard.listen = Math.min(1, guard.listen + dt * 2);
    }
  } else {
    const waypoints = guard.route.waypoints;
    const waypoint = waypoints[guard.targetIndex];
    const dx = waypoint.x - guard.x;
    const dy = waypoint.y - guard.y;
    if (Math.sqrt(dx * dx + dy * dy) <= GUARD.arriveRadius) {
      guard.dwell += dt;
      if (guard.dwell >= (waypoint.wait ?? GUARD.waitAtWaypoint)) {
        guard.dwell = 0;
        guard.targetIndex = (guard.targetIndex + 1) % waypoints.length;
      }
    } else {
      goal = waypoint;
    }
  }

  const speed = guard.state === 'investigate' ? GUARD.investigateSpeed : guard.speed;
  if (goal) {
    const dx = goal.x - guard.x;
    const dy = goal.y - guard.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const step = Math.min(distance, speed * dt);
    const next = resolveAgainstSolids(level, guard.x + (dx / distance) * step, guard.y + (dy / distance) * step, GUARD.radius);
    guard.x = next.x;
    guard.y = next.y;
    guard.heading = turnToward(guard.heading, Math.atan2(dy, dx), GUARD.turnRate, dt);
  }

  // The head sweeps around whatever the body is facing: this is the rhythm you learn to read.
  const rate = (TAU / GUARD.sweepPeriod) * (guard.state === 'investigate' ? 1.35 : 1);
  const sweep = Math.sin(world.time * rate + guard.sweepPhase) * sweepAmplitude(guard);
  guard.facing = guard.heading + sweep;

  if (guard.state !== 'investigate') {
    guard.notice = Math.max(0, guard.notice - dt * 1.1);
    guard.listen = Math.max(0, guard.listen - dt * 0.5);
  }
  guard.alarmed = Math.max(0, guard.alarmed - dt);
}

/**
 * Keep guards from standing inside one another. Two patrols that hear the same footstep both walk
 * to the same point; without this they would merge into one body and read as a rendering fault.
 * A soft push apart, applied after everyone has moved, so neither loses its own step.
 */
export function separateGuards(guards, level) {
  const minimum = GUARD.radius * 2.1;
  for (let a = 0; a < guards.length; a += 1) {
    for (let b = a + 1; b < guards.length; b += 1) {
      const first = guards[a];
      const second = guards[b];
      let dx = second.x - first.x;
      let dy = second.y - first.y;
      let distance = Math.hypot(dx, dy);
      if (distance >= minimum) continue;
      if (distance < 0.001) {
        // Perfectly coincident: split them on a fixed axis so the result stays deterministic.
        dx = 1;
        dy = 0;
        distance = 1;
      }
      const push = (minimum - distance) / 2;
      const nx = (dx / distance) * push;
      const ny = (dy / distance) * push;
      const movedFirst = resolveAgainstSolids(level, first.x - nx, first.y - ny, GUARD.radius);
      const movedSecond = resolveAgainstSolids(level, second.x + nx, second.y + ny, GUARD.radius);
      first.x = movedFirst.x;
      first.y = movedFirst.y;
      second.x = movedSecond.x;
      second.y = movedSecond.y;
    }
  }
}

/** The waypoint on the route nearest the guard: where it rejoins after an errand. */
function nearestWaypoint(guard) {
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < guard.route.waypoints.length; index += 1) {
    const point = guard.route.waypoints[index];
    const dx = point.x - guard.x;
    const dy = point.y - guard.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/**
 * How hard this guard's cone is on the thief right now: 0 when the thief is out of range, behind
 * masonry, or outside the wedge; 1 when the thief stands square in the middle of it at close
 * range. The number falls off with distance and toward the cone's edge, so the alarm climbs fast
 * when you are careless and slowly when you are skirting.
 */
export function guardSeesThief(guard, thief, level) {
  const cone = guardSightCone(guard);
  const dx = thief.x - guard.x;
  const dy = thief.y - guard.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > cone.range) return 0;
  if (distance < 1) return 1;
  const offset = Math.abs(angleDifference(Math.atan2(dy, dx), cone.facing));
  if (offset > cone.halfAngle) return 0;
  if (isSightBlocked(level, guard.x, guard.y, thief.x, thief.y)) return 0;
  const near = 1 - 0.5 * (distance / cone.range);
  const centred = 1 - 0.35 * (offset / cone.halfAngle);
  return Math.max(0, Math.min(1, near * centred));
}

/**
 * Give the guard a noise worth following. Sounds carry through the room regardless of walls —
 * that is the point of a noisemaker — but they only pull a guard that is not already searching.
 */
export function guardHears(guard, noise, level) {
  if (guard.state === 'investigate' && guard.investigate && !guard.investigate.arrived) return false;
  const dx = noise.x - guard.x;
  const dy = noise.y - guard.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > noise.radius) return false;
  guard.state = 'investigate';
  guard.investigate = {
    x: noise.x + (noise.x - guard.x) * 0.04,
    y: noise.y + (noise.y - guard.y) * 0.04,
    timer: GUARD.investigateSeconds,
    arrived: false,
    source: noise.kind,
  };
  guard.dwell = 0;
  return true;
}

/**
 * What a stance and the darkness do to being seen by an eye: crouching halves you, sprinting makes
 * you easier to pick out, and standing in a dead pool of light more than halves it again.
 */
export function stealExposure(guardSight, stanceExposure, shadow) {
  return Math.min(1, guardSight * stanceExposure * shadow);
}

/** How loud a footstep is, whether a guard could hear it, and how far. */
export function footstepNoise(thief) {
  const { base, perNoise } = HEARING;
  return {
    kind: 'footstep',
    x: thief.x,
    y: thief.y,
    radius: base + perNoise * thief.noise,
    strength: thief.noise,
  };
}

export { ALARM };
