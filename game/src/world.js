// The world: the live state of one run and the single step that advances it. It owns the order of
// operations — the thief moves, noise goes out, guards listen and walk and sweep, lenses swing,
// everyone's eyes are gathered into one list, the alarm folds them in, and the heist's own rules
// (the reach into the case, the getaway clock, the hatch) resolve last. Everything else in the
// game is a pure module this file drives, which is what makes a headless replay match a live one.
import { STEP, TOOLS, GUARD } from './config.js';
import { createLevel, shadowAt, isOnExit } from './level.js';
import { createGuards, updateGuard, guardSeesThief, guardHears, stealExposure, separateGuards } from './guard.js';
import { createCameras, updateCamera, cameraSeesThief } from './camera.js';
import { createThief, updateThief, updateGrab, createNoisemakers, updateNoisemakers, pingNoise } from './thief.js';
import { createAlarm, updateAlarm, startGetaway, reachGetaway } from './alarm.js';
import { createRandom } from './random.js';

export const EVENT_NONE = 0;
export const EVENT_SPOTTED = 1;
export const EVENT_HEARD = 2;
export const EVENT_LOOT = 4;
export const EVENT_ESCAPED = 8;
export const EVENT_CAUGHT = 16;

/** A fresh run at `seed`: the room, the crew, the lenses, the thief and a cold alarm. */
export function createWorld(seed) {
  const random = createRandom(seed);
  const level = createLevel(random);
  return {
    seed,
    random,
    level,
    time: 0,
    steps: 0,
    thief: createThief(level, random),
    guards: createGuards(level, random),
    cameras: createCameras(level),
    noisemakers: createNoisemakers(),
    alarm: createAlarm(),
    /** Every eye with a piece of the thief this frame, for the renderer's HUD and lines. */
    sightings: [],
    /** Where the mouse last pointed, in room coordinates: the noisemaker's aim. */
    aim: null,
    /** The run is finished, one way or the other. */
    over: false,
    won: false,
  };
}

/** Put a world back to its opening state without rebuilding the room. */
export function resetWorld(world) {
  const fresh = createWorld(world.seed);
  world.level = fresh.level;
  world.time = 0;
  world.steps = 0;
  world.thief = fresh.thief;
  world.guards = fresh.guards;
  world.cameras = fresh.cameras;
  world.noisemakers = fresh.noisemakers;
  world.alarm = fresh.alarm;
  world.sightings = [];
  world.over = false;
  world.won = false;
  return world;
}

/**
 * Gather what each guard and lens can see of the thief this frame. The list is the single source
 * of truth for both the alarm and the HUD, so "eyes on you" always means the same thing.
 */
function gatherSightings(world, shadow) {
  const { thief, level, guards, cameras } = world;
  const sightings = [];
  for (let index = 0; index < guards.length; index += 1) {
    const guard = guards[index];
    const raw = guardSeesThief(guard, thief, level);
    const pressure = stealExposure(raw, thief.exposure, shadow);
    if (pressure > 0) sightings.push({ kind: 'guard', source: guard, pressure, distance: Math.hypot(thief.x - guard.x, thief.y - guard.y) });
  }
  for (let index = 0; index < cameras.length; index += 1) {
    const camera = cameras[index];
    const pressure = cameraSeesThief(camera, thief, level, shadow);
    if (pressure > 0) sightings.push({ kind: 'camera', source: camera, pressure });
  }
  return sightings;
}

/**
 * Advance the whole world one fixed step. `intent` carries the player's wishes for this step:
 * moveX, moveY, sprint, crouch, grab, and throw (an angle or null). Returns EVENT_* flags for the
 * things that happened this step.
 */
export function stepWorld(world, dt, intent) {
  if (world.over) return EVENT_NONE;
  world.time += dt;
  world.steps += 1;
  let events = EVENT_NONE;

  const { level, thief, guards, cameras, noisemakers, alarm } = world;

  // 1. The thief moves, and its feet make the first noise of the step.
  const footstep = updateThief(thief, level, dt, {
    moveX: intent.moveX ?? 0,
    moveY: intent.moveY ?? 0,
    sprint: Boolean(intent.sprint),
    crouch: Boolean(intent.crouch),
    throw: intent.throw ?? null,
    noisemakers,
  });

  // 2. Thrown noisemakers fly, land and clatter.
  const landed = updateNoisemakers(noisemakers, level, dt);
  const noises = [];
  if (footstep) noises.push(footstep);
  for (let index = 0; index < noisemakers.list.length; index += 1) {
    const ping = noisemakers.list[index];
    if (ping.landed) noises.push(pingNoise(ping));
  }
  if (landed.length > 0) events |= EVENT_HEARD;

  // 3. Guards listen first, then walk: a guard pulled off its route this step still moves.
  for (let index = 0; index < guards.length; index += 1) {
    const guard = guards[index];
    for (let n = 0; n < noises.length; n += 1) {
      if (noises[n].strength <= 0.05) continue;
      if (guardHears(guard, noises[n], level)) events |= EVENT_HEARD;
    }
  }
  for (let index = 0; index < guards.length; index += 1) updateGuard(guards[index], level, dt, world);
  separateGuards(guards, level);

  // 4. Lenses sweep on their own timers.
  for (let index = 0; index < cameras.length; index += 1) updateCamera(cameras[index], dt, world.time);

  // 5. Everybody's eyes, then the meter.
  const shadow = shadowAt(level, thief.x, thief.y);
  world.sightings = gatherSightings(world, shadow);
  const before = alarm.value;
  updateAlarm(alarm, world.sightings, shadow, dt);
  if (alarm.value > before && alarm.pressure > 0) {
    events |= EVENT_SPOTTED;
    // A guard that has eyes on you leans in: its "!" and its flash are set here.
    for (let index = 0; index < world.sightings.length; index += 1) {
      const sighting = world.sightings[index];
      if (sighting.kind === 'guard') {
        sighting.source.notice = Math.min(1, sighting.source.notice + dt * 5 * sighting.pressure);
        if (sighting.source.notice > GUARD.noticeThreshold) sighting.source.alarmed = 1;
      } else {
        sighting.source.live = 0.5;
      }
    }
  }

  // 6. The heist's own rules: the case, the clock, the hatch, the bust.
  if (updateGrab(thief, level, dt, Boolean(intent.grab))) {
    level.vault.open = true;
    startGetaway(alarm);
    events |= EVENT_LOOT;
  }

  if (thief.carrying && isOnExit(level, thief.x, thief.y)) {
    reachGetaway(alarm);
    world.over = true;
    world.won = true;
    events |= EVENT_ESCAPED;
  }

  if (alarm.blared) {
    world.over = true;
    world.won = false;
    events |= EVENT_CAUGHT;
  }

  return events;
}

/** Run `seconds` of the simulation at the fixed step, calling `intentFor` each step. */
export function advanceWorld(world, seconds, intentFor) {
  const steps = Math.max(1, Math.round(seconds / STEP));
  let events = EVENT_NONE;
  for (let index = 0; index < steps; index += 1) {
    events |= stepWorld(world, STEP, intentFor(world) ?? {});
    if (world.over) break;
  }
  return events;
}

export { STEP, TOOLS };
