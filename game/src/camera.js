// Wall cameras: the fixed lenses on the gallery walls, their back-and-forth sweep on a timer, and
// what a lens can make of the thief. A camera is simpler than a guard — it never moves and never
// hears — but its cone is narrower, longer and, at the extremes of its sweep, points where a guard
// never will, so it closes routes a guard alone would leave open.
import { CAMERA, ALARM } from './config.js';
import { angleDifference } from './guard.js';
import { isSightBlocked } from './level.js';

const TAU = Math.PI * 2;

/** Build the camera that hangs at `mount`. */
function createCameraFromMount(mount, index) {
  return {
    id: `cam-${index}`,
    tag: mount.tag,
    index,
    x: mount.x,
    y: mount.y,
    baseFacing: mount.facing,
    facing: mount.facing,
    phase: mount.phase,
    sweep: 0,
    range: CAMERA.range,
    halfAngle: CAMERA.halfAngle,
    /** Set when the lens is the thing raising the alarm: the renderer reddens it. */
    live: 0,
  };
}

/** Every camera the level mounts. */
export function createCameras(level) {
  return level.cameraMounts.map((mount, index) => createCameraFromMount(mount, index));
}

/** Swing the lens one step along its back-and-forth arc, and cool its "live" tint. */
export function updateCamera(camera, dt, time) {
  const angularSpeed = (TAU / CAMERA.sweepPeriod) * (CAMERA.sweepAmplitude / CAMERA.halfAngle) * 0.09;
  camera.sweep = Math.sin(time * (TAU / CAMERA.sweepPeriod) + camera.phase);
  camera.facing = camera.baseFacing + camera.sweep * CAMERA.sweepAmplitude;
  camera.live = Math.max(0, camera.live - dt);
  return angularSpeed;
}

/** The wedge a lens is looking down right now. Detection and drawing both read this. */
export function cameraSightCone(camera) {
  return {
    x: camera.x,
    y: camera.y,
    facing: camera.facing,
    halfAngle: camera.halfAngle,
    range: camera.range,
  };
}

/**
 * How hard a lens is on the thief: same falloff as a guard's eye, but crouching does less for you
 * against a lens — it sees the top of you either way — and a shadow still hides you.
 */
export function cameraSeesThief(camera, thief, level, shadow) {
  const cone = cameraSightCone(camera);
  const dx = thief.x - camera.x;
  const dy = thief.y - camera.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > cone.range) return 0;
  if (distance < 1) return 1;
  const offset = Math.abs(angleDifference(Math.atan2(dy, dx), cone.facing));
  if (offset > cone.halfAngle) return 0;
  if (isSightBlocked(level, camera.x, camera.y, thief.x, thief.y)) return 0;
  const near = 1 - 0.45 * (distance / cone.range);
  const centred = 1 - 0.3 * (offset / cone.halfAngle);
  // The stance floor is what a lens cannot help: crouching inside its cone only helps so much.
  const stance = ALARM.cameraCrouchFloor + (1 - ALARM.cameraCrouchFloor) * thief.exposure;
  return Math.max(0, Math.min(1, near * centred * stance * Math.max(shadow, 0.5)));
}

/** Whether a lens marks the thief as seen this frame (for the HUD's "eyes on you" line). */
export function cameraTracks(camera, thief, level, shadow) {
  return cameraSeesThief(camera, thief, level, shadow) > 0;
}
