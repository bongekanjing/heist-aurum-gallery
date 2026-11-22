// The screenshot scenes behind ?shot=play|chase|win. Each one plays the real rules forward from a
// fresh world, steered by a small autopilot that follows a hand-picked route and refuses to walk
// into a cone it can see, so the frame is what a short heist really looks like rather than a pose.
// The same seed always gives the same frame, because the world, the sweeps and the pilot are all
// deterministic.
import { STEP, STANCE } from './config.js';
import { createWorld, stepWorld, EVENT_CAUGHT, EVENT_ESCAPED } from './world.js';
import { guardSightCone } from './guard.js';
import { cameraSightCone } from './camera.js';
import { shadowAt, isSolidAt } from './level.js';
import { SCREEN_GETAWAY, SCREEN_PLAY } from './render.js';
import { scoreRun } from './alarm.js';

const MAX_STEPS = 60 * 90;

/** The route in: up the hall, east along the north gallery, then in at the vault's side door. */
const ROUTE_IN = [
  { x: 552, y: 560 },
  { x: 620, y: 470 },
  { x: 640, y: 300 },
  { x: 760, y: 288 },
  { x: 880, y: 280 },
  { x: 966, y: 290 },
  { x: 1040, y: 268 },
  { x: 1104, y: 232, grab: true },
];

/** The route out: back through the side door, west along the gallery, then down to the hatch. */
const ROUTE_OUT = [
  { x: 1080, y: 300 },
  { x: 1030, y: 330 },
  { x: 972, y: 366, crouch: true },
  { x: 900, y: 350 },
  { x: 800, y: 392 },
  { x: 700, y: 394 },
  { x: 620, y: 470 },
  { x: 570, y: 560 },
  { x: 480, y: 620 },
  { x: 380, y: 600 },
  { x: 250, y: 520 },
  { x: 200, y: 600 },
  { x: 122, y: 612 },
];

/** How much of the thief any single eye or lens would see at (x, y) with no cover, 0..1. */
function exposureAt(world, x, y) {
  let worst = 0;
  for (const guard of world.guards) {
    const cone = guardSightCone(guard);
    const distance = Math.hypot(x - guard.x, y - guard.y);
    if (distance > cone.range) continue;
    let delta = Math.atan2(y - guard.y, x - guard.x) - cone.facing;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    if (Math.abs(delta) > cone.halfAngle) continue;
    const near = 1 - 0.5 * (distance / cone.range);
    const edge = 1 - 0.35 * (Math.abs(delta) / cone.halfAngle);
    worst = Math.max(worst, near * edge);
  }
  for (const camera of world.cameras) {
    const cone = cameraSightCone(camera);
    const distance = Math.hypot(x - camera.x, y - camera.y);
    if (distance > cone.range) continue;
    let delta = Math.atan2(y - camera.y, x - camera.x) - cone.facing;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    if (Math.abs(delta) > cone.halfAngle) continue;
    worst = Math.max(worst, 0.85 * (1 - 0.45 * (distance / cone.range)));
  }
  return worst;
}

/** Danger of standing at (x, y) right now, with the room's dead-light pools taken into account. */
function dangerAt(world, x, y) {
  const sight = exposureAt(world, x, y);
  if (sight <= 0) return 0;
  return shadowAt(world.level, x, y) < 0.6 ? sight * 0.42 : sight;
}

/** The worst danger along a short ray from where the thief stands, in the direction `angle`. */
function rayDanger(world, angle, distance) {
  const thief = world.thief;
  let worst = 0;
  for (let step = 0.34; step <= 1.001; step += 0.22) {
    const reach = distance * step;
    const x = thief.x + Math.cos(angle) * reach;
    const y = thief.y + Math.sin(angle) * reach;
    if (isSolidAt(world.level, x, y, thief.radius)) break;
    worst = Math.max(worst, dangerAt(world, x, y) * (1.12 - 0.12 * step));
  }
  return worst;
}

const DIRECTIONS = 20;

/**
 * One step of the pilot: head for `target`, but always down the danger gradient. When even standing
 * still is dangerous it walks whichever way lowers the danger most, which is how it backs out of a
 * cone instead of freezing inside one.
 */
function steerToward(world, target, options = {}) {
  const thief = world.thief;
  const dx = target.x - thief.x;
  const dy = target.y - thief.y;
  const distance = Math.hypot(dx, dy);
  const arrive = options.arrive ?? 9;
  const crouch = Boolean(options.crouch);
  const stance = crouch ? STANCE.crouch : options.sprint ? STANCE.sprint : STANCE.walk;
  const scan = stance.speed * 0.42;

  if (distance <= arrive) {
    return { moveX: 0, moveY: 0, crouch, grab: Boolean(options.grab) };
  }

  const desired = Math.atan2(dy, dx);
  if (options.careless) {
    // A pilot that does not read the cones: it walks the line and takes what comes. This is the
    // only honest way to stage a "spotted" frame — the alarm has to be earned by real eyes.
    const probeX = thief.x + Math.cos(desired) * scan;
    const probeY = thief.y + Math.sin(desired) * scan;
    if (isSolidAt(world.level, probeX, probeY, thief.radius + 1)) {
      return { moveX: 0, moveY: 0, crouch };
    }
    return {
      moveX: Math.cos(desired),
      moveY: Math.sin(desired),
      sprint: Boolean(options.sprint) && !crouch,
      crouch,
    };
  }
  const here = dangerAt(world, thief.x, thief.y);
  let best = null;
  for (let index = 0; index < DIRECTIONS; index += 1) {
    const angle = (index / DIRECTIONS) * Math.PI * 2;
    const probeX = thief.x + Math.cos(angle) * scan;
    const probeY = thief.y + Math.sin(angle) * scan;
    if (isSolidAt(world.level, probeX, probeY, thief.radius + 1)) continue;
    const ahead = rayDanger(world, angle, Math.min(distance, stance.speed * 0.55));
    const turn = Math.abs(Math.atan2(Math.sin(angle - desired), Math.cos(angle - desired)));
    const cost = ahead * 200 + turn * 26 - (shadowAt(world.level, probeX, probeY) < 0.6 ? 4 : 0);
    if (!best || cost < best.cost) best = { cost, angle, ahead };
  }

  if (!best) return { moveX: 0, moveY: 0, crouch: true };
  // Standing still is a valid move when every direction is worse than the ground you hold.
  if (best.cost > here * 200 + 12 && here > 0.02) {
    return { moveX: 0, moveY: 0, crouch: true };
  }
  const dangerous = best.ahead > 0.05;
  return {
    moveX: Math.cos(best.angle),
    moveY: Math.sin(best.angle),
    sprint: Boolean(options.sprint) && !crouch && !dangerous,
    crouch: crouch || dangerous,
  };
}

/**
 * Walk a route once, returning this step's intent and advancing the pilot's index. The pilot is
 * plain data, so a scene can be replayed step for step and always lands on the same frame.
 */
function followRoute(world, route, pilot, options = {}) {
  while (pilot.index < route.length) {
    const waypoint = route[pilot.index];
    const distance = Math.hypot(waypoint.x - world.thief.x, waypoint.y - world.thief.y);
    if (distance <= (waypoint.arrive ?? 14)) {
      if (waypoint.grab) {
        // Reach across the plinth and keep reaching until the stone is in the coat.
        if (world.thief.carrying) { pilot.index += 1; continue; }
        return { moveX: 0, moveY: 0, grab: true };
      }
      pilot.index += 1;
      continue;
    }
    return steerToward(world, waypoint, {
      crouch: waypoint.crouch,
      sprint: options.sprint,
      grab: waypoint.grab,
    });
  }
  return { moveX: 0, moveY: 0, crouch: true };
}

/** Run the world forward until `until` says stop, the run ends, or the step budget is spent. */
function playForward(world, intentFor, until, budget) {
  for (let step = 0; step < budget; step += 1) {
    const intent = intentFor(world, step);
    const events = stepWorld(world, STEP, intent);
    if (until(world, events, step)) return { events, steps: step + 1 };
    if (world.over) return { events, steps: step + 1 };
  }
  return { events: 0, steps: budget };
}

/**
 * Replay the same run twice: once to find the step whose frame best shows `score`, then again from
 * a fresh world, stopping exactly there. Every frame the game paints is therefore a step the real
 * rules produced — the camera is pointed at the most telling moment, it is not a pose.
 *
 * `makeIntentFor` returns a fresh pilot each time it is called, so the search pass and the replay
 * pass walk identical routes and land on identical states.
 */
function stageAtBestStep(world, makeIntentFor, score, budget) {
  const search = createWorld(world.seed);
  const searchIntent = makeIntentFor();
  let best = { value: -Infinity, step: 0 };
  for (let step = 0; step < budget; step += 1) {
    const events = stepWorld(search, STEP, searchIntent(search, step));
    const value = score(search, events);
    if (value > best.value) best = { value, step: step + 1 };
    if (search.over) break;
  }

  const replay = createWorld(world.seed);
  const replayIntent = makeIntentFor();
  for (let step = 0; step < best.step; step += 1) {
    stepWorld(replay, STEP, replayIntent(replay, step));
  }
  // Take the replayed world over wholesale — its time, its sightings and the meters are the frame.
  world.level = replay.level;
  world.time = replay.time;
  world.steps = replay.steps;
  world.thief = replay.thief;
  world.guards = replay.guards;
  world.cameras = replay.cameras;
  world.noisemakers = replay.noisemakers;
  world.alarm = replay.alarm;
  world.sightings = replay.sightings;
  world.over = replay.over;
  world.won = replay.won;
  return best.value;
}

/**
 * The ?shot= scene. `world` is rebuilt fresh from its seed, the route is walked by the pilot, and
 * the screen to draw is returned with the frame the pilot stopped on.
 */
export function stageShot(name, world) {
  const fresh = createWorld(world.seed);
  adoptWorld(world, fresh);
  if (name === 'chase') return stageChase(world);
  if (name === 'win') return stageWin(world);
  return stagePlay(world);
}

/** Copy a freshly built world's parts into the world the page already holds. */
function adoptWorld(target, fresh) {
  target.level = fresh.level;
  target.time = 0;
  target.steps = 0;
  target.thief = fresh.thief;
  target.guards = fresh.guards;
  target.cameras = fresh.cameras;
  target.noisemakers = fresh.noisemakers;
  target.alarm = fresh.alarm;
  target.sightings = [];
  target.over = false;
  target.won = false;
  target.aim = null;
}

/**
 * ?shot=play: the cover frame. The thief is halfway across the great hall with the Sunstone's case
 * and the vault in front of him, both walkers and the aisle watch on their beats, four lenses
 * sweeping, and the alarm already part filled from a lens that clipped him on the way in.
 */
function stagePlay(world) {
  // A fumbling approach: the thief comes up the hall, slips through the gap between the two
  // vitrines, drifts back, and tries again — so the hall walker and the gallery walker both get a
  // piece of him and the meter is genuinely part-filled when the frame is taken.
  const route = [
    { x: 552, y: 560 },
    { x: 620, y: 470 },
    { x: 636, y: 402 },
    { x: 740, y: 394 },
    { x: 862, y: 392 },
    { x: 890, y: 336 },
    { x: 800, y: 394 },
    { x: 700, y: 396 },
    { x: 760, y: 392 },
  ];
  stageAtBestStep(
    world,
    () => {
      const pilot = { index: 0 };
      return (state) => followRoute(state, route, pilot, { sprint: false, careless: true });
    },
    (state) => {
      const onView = state.thief.x > 640 && state.thief.x < 960 && state.thief.y > 300 && state.thief.y < 500;
      if (!onView) return -1;
      const alarm = state.alarm.value;
      if (alarm < 30) return alarm;
      // The cover frame is tension, not a bust: the meter is clearly part filled, but no cone is on
      // him this instant, so the picture reads "you have been seen once and you got away with it".
      const calm = state.sightings.length === 0 ? 400 : -state.sightings.length * 120;
      const near = state.sightings.length === 0 ? 1 : 0;
      return calm + 240 - Math.abs(alarm - 52) + near * 40;
    },
    60 * 45,
  );
  world.aim = { x: world.level.loot.x, y: world.level.loot.y };
  return { world, screen: SCREEN_PLAY, aim: world.aim, score: null };
}

/**
 * ?shot=chase: the pilot walks north up the great hall without reading the hall walker's wedge;
 * the frame chosen is the one where a guard's cone is hardest on him and the meter is fullest.
 */
function stageChase(world) {
  const route = [
    { x: 552, y: 560 },
    { x: 630, y: 470 },
    { x: 636, y: 402 },
    { x: 620, y: 330 },
    { x: 640, y: 286 },
    { x: 700, y: 240 },
    { x: 780, y: 210 },
    { x: 700, y: 250 },
    { x: 650, y: 300 },
    { x: 620, y: 360 },
  ];
  stageAtBestStep(
    world,
    () => {
      const pilot = { index: 0 };
      return (state) => followRoute(state, route, pilot, { sprint: true, careless: true });
    },
    (state) => {
      if (state.over) return -1;
      const guardEyes = state.sightings.filter((entry) => entry.kind === 'guard');
      const strongest = guardEyes.reduce((most, entry) => Math.max(most, entry.pressure), 0);
      if (strongest <= 0.05) return -1;
      const alarm = state.alarm.value;
      // Peak tension, not a bust: a guard's wedge hard on him with the meter nearly full but the
      // run still alive. Anything at or over the bust line is not the frame.
      if (alarm > 94) return -1;
      return strongest * 260 + (90 - Math.abs(alarm - 86)) * 4 + guardEyes.length * 30;
    },
    60 * 45,
  );
  world.aim = { x: 470, y: 250 };
  return { world, screen: SCREEN_PLAY, aim: world.aim, score: null };
}

/**
 * ?shot=win: the whole job — in past both walkers, the Sunstone out of its case, back through the
 * side door, west down the gallery and into the dark pocket to the lit hatch. The frame is the step
 * the escape resolves, so the getaway card is the game's own result.
 */
function stageWin(world) {
  const pilot = { index: 0 };
  const route = [...ROUTE_IN, ...ROUTE_OUT];
  playForward(
    world,
    () => followRoute(world, route, pilot, { sprint: true }),
    (state, events) => Boolean(events & (EVENT_ESCAPED | EVENT_CAUGHT)),
    MAX_STEPS,
  );
  world.aim = { x: 640, y: 560 };
  return {
    world,
    screen: world.won ? SCREEN_GETAWAY : SCREEN_PLAY,
    aim: world.aim,
    score: scoreRun(world),
  };
}
