// Every tunable number and colour in one place: body speeds, cone angles, alarm rates, patrol
// timings, tool costs and the palette the whole game draws from. Nothing in this file touches the
// DOM, so the simulation can also run headless (the screenshot scenes and the tuning harness import
// it directly).
//
// The playfield is a fixed 1280x720 logical area; the renderer scales it to the window, so no rule
// below depends on the screen size.

export const FIELD = { width: 1280, height: 720, hudHeight: 96 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** The room's outer footprint and wall thickness, in playfield pixels. */
export const ROOM = { left: 24, top: 104, right: 1256, bottom: 700, wall: 22 };

export const THIEF = {
  radius: 11,
  accel: 1500,
  /** How near the loot case the thief has to stand, centre to centre, to reach in. */
  reach: 54,
  /** Seconds of holding E beside the case before the Sunstone is out. */
  grabSeconds: 0.85,
};

/** The three stances: speed, the noise each makes (0..1) and how visible it leaves you. */
export const STANCE = {
  walk: { speed: 176, noise: 0.4, exposure: 1 },
  sprint: { speed: 292, noise: 1, exposure: 1.25 },
  crouch: { speed: 94, noise: 0.1, exposure: 0.5 },
};

/** How far a stance's noise carries to a guard's ear, in pixels. */
export const HEARING = { base: 34, perNoise: 132 };

export const GUARD = {
  radius: 11,
  patrolSpeed: 74,
  investigateSpeed: 134,
  coneRange: 214,
  coneHalfAngle: 0.42,
  alertHalfAngle: 0.56,
  sweepAmplitude: 0.48,
  sweepPeriod: 4.6,
  /** Radians per second the body swings round to face the way it is walking. */
  turnRate: 3.4,
  waitAtWaypoint: 0.75,
  investigateSeconds: 6.5,
  /** How close counts as arrived at a waypoint or an investigated noise. */
  arriveRadius: 12,
  /** Awareness (0..1) at which the "!" bubble appears over the guard. */
  noticeThreshold: 0.35,
};

export const CAMERA = {
  radius: 9,
  range: 300,
  halfAngle: 0.14,
  sweepAmplitude: 0.62,
  sweepPeriod: 6.4,
};

export const ALARM = {
  max: 100,
  /** Percentage points per second with a guard's cone fully on you (before stance and shadow). */
  guardRate: 34,
  cameraRate: 26,
  /** Percentage points shed per second once nothing is looking, after a short grace. */
  decay: 15,
  decayInShadow: 26,
  decayDelay: 0.85,
  /** Exposure multiplier while standing in a dark patch of floor. */
  shadowExposure: 0.32,
  /** Crouching helps less against a lens than against an eye. */
  cameraCrouchFloor: 0.72,
  /** Seconds the SPOTTED flash stays on screen after a fresh sighting. */
  spottedFlash: 1.5,
};

export const TOOLS = {
  /** Noisemakers carried per run; each one is spent when it leaves your hand. */
  noisemakers: 2,
  throwSpeed: 640,
  /** Seconds a landed noisemaker keeps rattling. */
  pingSeconds: 1.9,
  /** How far the rattle reaches a guard's ear. */
  pingRadius: 250,
  /** The rattle fades out over the last part of its life. */
  flightTime: 0.24,
};

export const GETAWAY = {
  /** Seconds between taking the Sunstone and the getaway closing. */
  seconds: 42,
  /** Alarm points per second the opened vault adds while you are still inside. */
  heatPerSecond: 1.5,
  /** Heat after the window closes: the guards know the vault is open. */
  overtimeHeatPerSecond: 4,
  /** Seconds under which the getaway counts as clean. */
  cleanBelow: 999,
};

export const SCORE = {
  loot: 500,
  perSecondLeft: 12,
  perAlarmPointClear: 8,
  perToolUnused: 40,
  unseenBonus: 150,
};

/** Base colours. Danger hues are stored as bare rgb triples so alpha can be built on the fly. */
export const PALETTE = {
  page: '#05080d',
  floor: '#0d1622',
  floorDeep: '#0a121c',
  floorLine: 'rgba(126,170,210,0.055)',
  floorLineMajor: 'rgba(126,170,210,0.10)',
  shadowFloor: '#05090f',
  wall: '#16212c',
  wallFace: '#1f2d3a',
  wallEdge: 'rgba(147,193,229,0.20)',
  wallStripe: '#0e1720',
  duct: '#060b11',
  ductGrate: 'rgba(126,170,210,0.18)',
  cover: '#1d2b38',
  coverTop: '#243544',
  coverEdge: 'rgba(147,193,229,0.30)',
  danger: '255,74,92',
  dangerBright: '255,38,64',
  cameraDanger: '255,84,138',
  loot: '#ffcb63',
  lootPale: '#ffe6a8',
  lootDeep: '#9d6a24',
  thief: '#63e6cd',
  thiefDeep: '#0a3b3a',
  guardBody: '#3b1d25',
  guardRim: '#ff6b73',
  hud: 'rgba(6,10,16,0.93)',
  hudLine: 'rgba(126,170,210,0.16)',
  text: '#e9f1f8',
  muted: '#7d92a8',
  goldText: '#ffd782',
  panel: 'rgba(9,15,22,0.90)',
};

export const FONT = 'ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif';

/** Where the best getaway is kept between visits (this browser only). */
export const BEST_KEY = 'aurum-gallery.best';
