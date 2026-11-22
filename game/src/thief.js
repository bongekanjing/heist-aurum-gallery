// The thief: the body you steer, the three stances that trade speed against the noise you make
// and how easily a lens picks you out, the noisemakers in your coat, and the reach that lifts the
// Sunstone out of its case. Everything here is a pure function of the body's own state and the
// intent the loop hands it, so a headless autopilot can drive it exactly as a keyboard does.
import { THIEF, STANCE, TOOLS, GUARD } from './config.js';
import { resolveAgainstSolids, isWithinReachOfCase } from './level.js';
import { footstepNoise } from './guard.js';

const TAU = Math.PI * 2;

/** A fresh thief standing in the room's entry, tools in the coat, hands empty. */
export function createThief(level, random) {
  return {
    x: level.entry.x,
    y: level.entry.y,
    vx: 0,
    vy: 0,
    radius: THIEF.radius,
    stance: 'walk',
    noise: 0,
    exposure: STANCE.walk.exposure,
    speedFactor: 1,
    carrying: false,
    grabProgress: 0,
    toolsLeft: TOOLS.noisemakers,
    /** Seconds since the last footstep noise, so steps fall at a walking rhythm, not every frame. */
    stepTimer: 0,
    /** Set for a moment when a new footstep goes out, for the renderer's ring. */
    stepPulse: 0,
    /** True while the body is inside a crawl duct, which slows everything down. */
    inDuct: false,
    heading: -Math.PI / 2,
    alive: true,
  };
}

/** The noisemakers in flight and on the floor: each one rattles, then goes quiet. */
export function createNoisemakers() {
  return { list: [] };
}

/** Throw one noisemaker from the thief toward `angle`. False when the coat is empty. */
export function throwNoisemaker(thief, noisemakers, angle) {
  if (thief.toolsLeft <= 0) return false;
  thief.toolsLeft -= 1;
  thief.stepPulse = 1;
  noisemakers.list.push({
    x: thief.x,
    y: thief.y,
    vx: Math.cos(angle) * TOOLS.throwSpeed,
    vy: Math.sin(angle) * TOOLS.throwSpeed,
    life: TOOLS.pingSeconds,
    flight: TOOLS.flightTime,
    age: 0,
    landed: false,
    phase: 0,
  });
  return true;
}

/** Move the thrown noisemakers, land them on the first wall they hit, and expire the old ones. */
export function updateNoisemakers(noisemakers, level, dt) {
  const landed = [];
  for (let index = noisemakers.list.length - 1; index >= 0; index -= 1) {
    const ping = noisemakers.list[index];
    ping.age += dt;
    ping.phase += dt * 22;
    ping.life -= dt;
    if (!ping.landed) {
      ping.flight -= dt;
      const next = resolveAgainstSolids(level, ping.x + ping.vx * dt, ping.y + ping.vy * dt, 3);
      ping.x = next.x;
      ping.y = next.y;
      if (ping.flight <= 0) {
        ping.landed = true;
        landed.push(ping);
      }
    }
    if (ping.life <= 0) noisemakers.list.splice(index, 1);
  }
  return landed;
}

/** How loud a landed rattle is at this moment: full at the clatter, fading as it runs down. */
export function pingLoudness(ping) {
  if (!ping.landed) return 0;
  return Math.max(0, Math.min(1, ping.life / TOOLS.pingSeconds));
}

/** The noise a landed noisemaker is making this frame, in the shape the guards listen for. */
export function pingNoise(ping) {
  return {
    kind: 'rattle',
    x: ping.x,
    y: ping.y,
    radius: TOOLS.pingRadius * Math.max(0.35, pingLoudness(ping)),
    strength: pingLoudness(ping),
  };
}

/**
 * Advance the thief one step. `intent` is what the player (or the autopilot) asks for this frame:
 * { moveX, moveY, sprint, crouch, throw } in unit-ish axes, with `throw` an angle or null.
 * Returns the noise this step made, if any, for the guards to consider.
 */
export function updateThief(thief, level, dt, intent) {
  const crouch = Boolean(intent.crouch);
  const sprint = Boolean(intent.sprint) && !crouch;
  const stanceName = crouch ? 'crouch' : sprint ? 'sprint' : 'walk';
  const stance = STANCE[stanceName];
  thief.stance = stanceName;

  let moveX = intent.moveX ?? 0;
  let moveY = intent.moveY ?? 0;
  const magnitude = Math.hypot(moveX, moveY);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveY /= magnitude;
  }

  thief.inDuct = isInDuct(level, thief.x, thief.y);
  // Crawling through a duct is slower than walking the long way round: the shortcut costs time.
  const ductFactor = thief.inDuct ? 0.62 : 1;
  const cap = stance.speed * ductFactor * (thief.carrying ? 0.94 : 1);

  const wantedX = moveX * cap;
  const wantedY = moveY * cap;
  const accel = THIEF.accel * dt;
  thief.vx += Math.max(-accel, Math.min(accel, wantedX - thief.vx));
  thief.vy += Math.max(-accel, Math.min(accel, wantedY - thief.vy));

  const next = resolveAgainstSolids(level, thief.x + thief.vx * dt, thief.y + thief.vy * dt, thief.radius);
  // If the wall stopped us dead on an axis, drop that axis's speed so the next step can turn.
  if (Math.abs(next.x - (thief.x + thief.vx * dt)) > 0.01) thief.vx *= 0.2;
  if (Math.abs(next.y - (thief.y + thief.vy * dt)) > 0.01) thief.vy *= 0.2;
  thief.x = next.x;
  thief.y = next.y;

  const moving = Math.hypot(thief.vx, thief.vy);
  if (moving > 6) thief.heading = Math.atan2(thief.vy, thief.vx);

  // Noise and exposure follow the stance, scaled by how much you are actually moving: standing
  // still in a sprint stance is quiet, and only a body in motion is easy to pick out.
  const motion = Math.min(1, moving / Math.max(1, stance.speed));
  thief.noise = stance.noise * (0.25 + 0.75 * motion);
  thief.exposure = 1 + (stance.exposure - 1) * motion;
  thief.speedFactor = cap / STANCE.walk.speed;
  thief.stepPulse = Math.max(0, thief.stepPulse - dt * 3.2);

  if (intent.throw !== null && intent.throw !== undefined) {
    throwNoisemaker(thief, intent.noisemakers, intent.throw);
  }

  // Footsteps: a ring of sound every stride, louder the faster you are going.
  let noise = null;
  thief.stepTimer -= dt;
  if (moving > 24 && thief.stepTimer <= 0) {
    thief.stepTimer = crouch ? 0.46 : sprint ? 0.19 : 0.31;
    thief.stepPulse = 1;
    noise = footstepNoise(thief);
  } else if (moving <= 24) {
    thief.stepTimer = Math.min(thief.stepTimer, 0.1);
  }
  return noise;
}

/** Whether the body is inside a crawl duct, which the level marks as a narrow passage. */
function isInDuct(level, x, y) {
  for (let index = 0; index < level.ducts.length; index += 1) {
    const duct = level.ducts[index];
    if (x >= duct.x - 4 && x <= duct.x + duct.w + 4 && y >= duct.y - 4 && y <= duct.y + duct.h + 4) return true;
  }
  return false;
}

/**
 * Reach into the case. Holding the key beside it fills `grabProgress`; at full the Sunstone comes
 * out, the vault door swings and the getaway clock starts. Returns true on the step it is taken.
 */
export function updateGrab(thief, level, dt, holding) {
  if (thief.carrying || !level.case) {
    thief.grabProgress = Math.max(0, thief.grabProgress - dt * 2);
    return false;
  }
  const inReach = isWithinReachOfCase(level, thief.x, thief.y);
  if (!holding || !inReach) {
    thief.grabProgress = Math.max(0, thief.grabProgress - dt * 2);
    return false;
  }
  thief.grabProgress = Math.min(1, thief.grabProgress + dt / THIEF.grabSeconds);
  if (thief.grabProgress >= 1) {
    thief.carrying = true;
    return true;
  }
  return false;
}

/** Where the mouse is pointing, as an angle from the thief — the direction a noisemaker flies. */
export function aimAngle(thief, worldPoint) {
  if (!worldPoint) return thief.heading;
  const dx = worldPoint.x - thief.x;
  const dy = worldPoint.y - thief.y;
  if (Math.hypot(dx, dy) < 4) return thief.heading;
  return Math.atan2(dy, dx);
}

/** A small wobble on a throw so two throws never land in exactly the same spot. */
export function throwSpread(random) {
  return (random() - 0.5) * 0.09;
}

export { TAU, GUARD };
