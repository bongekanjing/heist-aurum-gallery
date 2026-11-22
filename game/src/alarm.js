// The alarm meter: the one number the whole room reacts to. It climbs while anything has eyes on
// you, holds its breath for a moment when nothing does, then bleeds away — faster in a pool of
// dead light. At the top the alarm bites, the job is blown, and the run ends. The meter also
// carries the two things the HUD narrates: the "spotted" flash and which eyes are on you.
import { ALARM, GETAWAY, SCORE } from './config.js';

/** A quiet alarm, the run clock at zero and no eyes on you. */
export function createAlarm() {
  return {
    value: 0,
    max: ALARM.max,
    /** Seconds since anything last had eyes on the thief: the decay grace counts this down. */
    quietFor: 0,
    /** 0..1: how recently the thief was freshly spotted, for the screen-edge flash. */
    spotted: 0,
    /** How many guards and lenses have eyes on the thief this frame. */
    seenByGuards: 0,
    seenByCameras: 0,
    /** Strongest single sighting this frame, 0..1. */
    pressure: 0,
    /** True on the step the meter filled: the run is over. */
    blared: false,
    /** Seconds left on the getaway once the Sunstone is out; null until it is. */
    getaway: null,
    /** Set the step the thief gets clear. */
    away: false,
  };
}

/**
 * Fold this frame's sightings into the meter. `sightings` is a list of { kind, pressure } from the
 * guards and lenses; `shadow` is how dark the floor under the thief is (1 in the open).
 */
export function updateAlarm(alarm, sightings, shadow, dt) {
  let guardPressure = 0;
  let cameraPressure = 0;
  let guardCount = 0;
  let cameraCount = 0;

  for (let index = 0; index < sightings.length; index += 1) {
    const sighting = sightings[index];
    if (sighting.pressure <= 0.02) continue;
    if (sighting.kind === 'camera') {
      cameraCount += 1;
      cameraPressure = Math.max(cameraPressure, sighting.pressure);
    } else {
      guardCount += 1;
      guardPressure = Math.max(guardPressure, sighting.pressure);
    }
  }

  alarm.seenByGuards = guardCount;
  alarm.seenByCameras = cameraCount;
  alarm.pressure = Math.max(guardPressure, cameraPressure);

  if (guardPressure > 0 || cameraPressure > 0) {
    const gain = guardPressure * ALARM.guardRate + cameraPressure * ALARM.cameraRate;
    // Two sets of eyes at once climb faster than either alone: being boxed in is what kills you.
    const crowd = 1 + 0.22 * Math.max(0, guardCount + cameraCount - 1);
    alarm.value = Math.min(alarm.max, alarm.value + gain * crowd * dt);
    alarm.quietFor = 0;
    alarm.spotted = Math.max(alarm.spotted, Math.min(1, (guardPressure + cameraPressure) * 1.15));
  } else {
    alarm.quietFor += dt;
    if (alarm.quietFor > ALARM.decayDelay) {
      const rate = shadow < 0.6 ? ALARM.decayInShadow : ALARM.decay;
      alarm.value = Math.max(0, alarm.value - rate * dt);
    }
  }

  alarm.spotted = Math.max(0, alarm.spotted - dt / ALARM.spottedFlash);

  if (alarm.getaway !== null) {
    alarm.getaway -= dt;
    // The open vault keeps radiating heat: the longer you linger with the Sunstone, the hotter.
    alarm.value = Math.min(alarm.max, alarm.value + GETAWAY.heatPerSecond * dt);
    if (alarm.getaway <= 0) alarm.value = Math.min(alarm.max, alarm.value + GETAWAY.overtimeHeatPerSecond * dt);
  }

  if (alarm.value >= alarm.max && !alarm.blared) {
    alarm.blared = true;
    alarm.value = alarm.max;
  }
  return alarm;
}

/** Start the getaway clock the moment the Sunstone comes out of its case. */
export function startGetaway(alarm) {
  alarm.getaway = GETAWAY.seconds;
  alarm.value = Math.min(alarm.max - 1, alarm.value + 12);
}

/** End the run clean: the thief is through the hatch and away. */
export function reachGetaway(alarm) {
  alarm.away = true;
}

/** How full the meter is, 0..1, for the HUD bar. */
export function alarmFraction(alarm) {
  return Math.max(0, Math.min(1, alarm.value / alarm.max));
}

/** The meter band the HUD paints: quiet, uneasy, hot, or blaring. */
export function alarmBand(alarm) {
  const fraction = alarmFraction(alarm);
  if (alarm.blared) return 'blaring';
  if (fraction > 0.72) return 'hot';
  if (fraction > 0.32) return 'uneasy';
  return 'quiet';
}

/** Seconds left on the getaway, or null before the Sunstone is out. */
export function getawayLeft(alarm) {
  return alarm.getaway === null ? null : Math.max(0, alarm.getaway);
}

/**
 * The score at the end of a run: what the Sunstone is worth, what you got out with, and what the
 * calm you kept and the tools you never threw are worth.
 */
export function scoreRun(world) {
  const { alarm, thief } = world;
  const parts = {
    loot: thief.carrying ? SCORE.loot : 0,
    timeLeft: alarm.getaway === null ? 0 : Math.round(getawayLeft(alarm) * SCORE.perSecondLeft),
    calm: Math.round((alarm.max - alarm.value) * SCORE.perAlarmPointClear),
    tools: thief.toolsLeft * SCORE.perToolUnused,
    unseen: alarm.value < alarm.max * 0.35 ? SCORE.unseenBonus : 0,
  };
  const total = parts.loot + parts.timeLeft + parts.calm + parts.tools + parts.unseen;
  return { total, ...parts };
}
