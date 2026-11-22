// The game loop: read input, advance the world in fixed 1/60 s steps (several in a slow frame,
// none in a fast one), paint what is there. The game moves between five screens: title, play,
// paused, caught and getaway.
//
// ?seed=N fixes the room's sweep phases. ?shot=play|chase|win (with &seed=N) stages that scene
// from a fresh world instead of running the loop, paints it, and sets document.body.dataset.painted
// so the screenshot harness knows the frame is the game's own final frame.
import { BEST_KEY, STEP } from './config.js';
import { createWorld, resetWorld, stepWorld, EVENT_CAUGHT, EVENT_ESCAPED, EVENT_LOOT } from './world.js';
import { ACTION_CONFIRM, ACTION_PAUSE, ACTION_RESTART, ACTION_THROW, createInput } from './input.js';
import { createRenderer, SCREEN_CAUGHT, SCREEN_GETAWAY, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { scoreRun } from './alarm.js';
import { stageShot } from './shots.js';
import { aimAngle } from './thief.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(seed);
const renderer = createRenderer(canvas);

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best then lasts this visit only.
  }
}

/**
 * Stage a screenshot scene. `stageShot` plays the real rules forward from a fresh world and returns
 * the screen to draw; we paint it, and once the pixels are on the canvas we raise the painted flag.
 * Two paints: the first lays down the picture, the second is the frame the harness captures, so no
 * partially composited frame is ever photographed.
 */
function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(scene);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else document.body.dataset.painted = '1';
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas, renderer.toRoomPoint);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let score = null;
  let accumulator = 0;
  let last = performance.now();
  let throwQueued = null;
  let grabHeld = false;

  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    resetWorld(world);
    accumulator = 0;
    screen = SCREEN_PLAY;
    score = null;
    announce('Night shift. Take the Sunstone and reach the service hatch.');
  }

  function handleActions() {
    const actions = input.takeActions();
    const restarting = screen === SCREEN_CAUGHT || screen === SCREEN_GETAWAY;
    if (actions & ACTION_RESTART) {
      startGame();
      return;
    }
    if (actions & ACTION_CONFIRM) {
      if (screen === SCREEN_TITLE || restarting) startGame();
    }
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        grabHeld = false;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Back in.');
      }
    }
    if (actions & ACTION_THROW && screen === SCREEN_PLAY) {
      throwQueued = aimAngle(world.thief, input.aim());
    }
    if (actions & ACTION_THROW && world.over) startGame();
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      // The title still shows a live room: the guards walk while you read it.
      stepWorld(world, STEP, { moveX: 0, moveY: 0 });
      return;
    }
    const intent = input.heldIntent();
    grabHeld = intent.grab;
    const events = stepWorld(world, STEP, {
      moveX: intent.moveX,
      moveY: intent.moveY,
      sprint: intent.sprint,
      crouch: intent.crouch,
      grab: grabHeld,
      throw: throwQueued,
    });
    throwQueued = null;
    if (events & EVENT_LOOT) {
      const score = scoreRun(world);
      announce(`The Sunstone is out. ${Math.round(score.total)} in the bag so far.`);
    }
    if (events & EVENT_ESCAPED) {
      score = scoreRun(world);
      screen = SCREEN_GETAWAY;
      if (score.total > best) {
        best = score.total;
        saveBest(best);
      }
      announce(`Clean getaway. Score ${score.total}. Best ${best}.`);
    }
    if (events & EVENT_CAUGHT) {
      score = scoreRun(world);
      screen = SCREEN_CAUGHT;
      announce('The alarm bit. Press R to try again.');
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw({ world, screen, aim: input.aim(), score });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      grabHeld = false;
      announce('Paused.');
    }
  });

  announce('The Aurum Gallery. Press Space or click to begin.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
