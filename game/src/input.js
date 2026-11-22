// Keyboard and mouse: held keys become one movement intent, one-shot presses become queued
// actions, and the pointer becomes an aim angle in the room's own coordinates. A press between two
// frames is never lost and never counted twice.
//
// WASD or the arrow keys steer. Shift sprints, Ctrl or C crouches. E works the case. Q or right
// click throws a noisemaker at the pointer. P pauses, R restarts, Space/Enter confirms a screen.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RESTART = 4;
export const ACTION_THROW = 8;
export const ACTION_GRAB = 16;

const UP = new Set(['KeyW', 'ArrowUp']);
const DOWN = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);
const CROUCH = new Set(['ControlLeft', 'ControlRight', 'KeyC']);
const GRAB = new Set(['KeyE']);
const THROW = new Set(['KeyQ']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const RESTART = new Set(['KeyR']);

/**
 * Read input from `target` (the canvas, for the pointer) and the window (for the keys). Returns a
 * reader the loop calls once a frame.
 */
export function createInput(target, toRoomPoint) {
  const held = new Set();
  let actions = 0;
  let pointer = null;
  let pointerDown = false;

  window.addEventListener('keydown', (event) => {
    held.add(event.code);
    if (event.repeat) {
      if (CONFIRM.has(event.code) || PAUSE.has(event.code) || RESTART.has(event.code)) event.preventDefault();
      return;
    }
    if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
    if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    if (RESTART.has(event.code)) actions |= ACTION_RESTART;
    if (GRAB.has(event.code)) actions |= ACTION_GRAB;
    if (THROW.has(event.code)) actions |= ACTION_THROW;
    if (CONFIRM.has(event.code) || PAUSE.has(event.code) || GRAB.has(event.code) || THROW.has(event.code) || CROUCH.has(event.code) || SPRINT.has(event.code)) {
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => held.delete(event.code));
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.clear();
    pointerDown = false;
  });

  function readPointer(event) {
    const rect = target.getBoundingClientRect();
    pointer = toRoomPoint(event.clientX - rect.left, event.clientY - rect.top);
  }

  target.addEventListener('pointermove', readPointer);
  target.addEventListener('pointerdown', (event) => {
    readPointer(event);
    if (event.button === 2) actions |= ACTION_THROW;
    else {
      pointerDown = true;
      actions |= ACTION_CONFIRM;
    }
  });
  target.addEventListener('pointerup', () => {
    pointerDown = false;
  });
  target.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    /** The held movement and stance keys, as one intent with no one-shot action in it. */
    heldIntent() {
      const up = held.has('KeyW') || held.has('ArrowUp');
      const down = held.has('KeyS') || held.has('ArrowDown');
      const left = held.has('KeyA') || held.has('ArrowLeft');
      const right = held.has('KeyD') || held.has('ArrowRight');
      const crouch = [...CROUCH].some((code) => held.has(code));
      const sprint = [...SPRINT].some((code) => held.has(code));
      const moveX = (right ? 1 : 0) - (left ? 1 : 0);
      const moveY = (down ? 1 : 0) - (up ? 1 : 0);
      return {
        moveX,
        moveY,
        sprint: sprint && (moveX !== 0 || moveY !== 0),
        crouch,
        grab: [...GRAB].some((code) => held.has(code)),
        aim: pointer,
      };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Where the pointer last was, in room coordinates. */
    aim() {
      return pointer;
    },
    pointerDown() {
      return pointerDown;
    },
  };
}
