// The room: its walls, the cover you can hide behind, the dead floor that hides you, the crawl
// ducts that shortcut it, where the Sunstone sits, where the getaway hatch is, and the fixed
// patrol routes and camera mounts the rest of the game reads. Pure geometry and data.
//
// The gallery is laid out in three bands, so a guard's beat belongs to one band and the thief can
// read the room as a plan rather than a scramble:
//
//        x=46        x=358        x=520      x=960      x=1234
//   y=126  +-----------+  NORTH GALLERY  +------+--THE VAULT--+
//          | STORE     |   (walker,      | duct |  case  lens |
//          | ROOM      |    lens)        |  |   |             |
//   y=250  +-----+-----+                 |  +---+             |
//          |           GREAT HALL        | side door           |
//          |  (hall walker, colonnade)   +------+ door         |
//   y=440  |                                 |  +--+----+------+
//          |  service pocket  |  SOUTH AISLE  |  (aisle watch)  |
//   y=470  +--duct--+---------+                              |
//          |  DARK + HATCH   |   (south lens sweeps the hall) |
//   y=678  +-----------------+--------------------------------+
//
// Three ways into the vault (side door, floor door, crawl duct), two into the pocket (duct, or
// round the end of its wall), and the long north gallery: several routes, each with a price.
import { ROOM, THIEF } from './config.js';
import { randomRange } from './random.js';

/** One solid rectangle: what you cannot walk through and cannot see through. */
function box(x, y, w, h, kind) {
  return { x, y, w, h, kind };
}

/** The four outer walls of the room. */
function roomWalls() {
  const { left, top, right, bottom, wall } = ROOM;
  return [
    box(left, top, right - left, wall, 'wall'),
    box(left, bottom - wall, right - left, wall, 'wall'),
    box(left, top, wall, bottom - top, 'wall'),
    box(right - wall, top, wall, bottom - top, 'wall'),
  ];
}

/**
 * The interior masonry. Every gap is a doorway or a crawl duct, and each is wide enough for the
 * thief's body: the vault has three ways in, the store room two, the pocket two.
 */
function interiorWalls() {
  return [
    // The vault's west wall: a side door at y 250..330 and a crawl duct at y 352..388.
    box(960, 126, 20, 124, 'vault-wall'),
    box(960, 330, 20, 22, 'vault-wall'),
    box(960, 388, 20, 52, 'vault-wall'),
    // The vault's floor wall, with its main door at x 1082..1154.
    box(960, 440, 122, 18, 'vault-wall'),
    box(1154, 440, 80, 18, 'vault-wall'),
    // The store room's east wall, with a doorway into the north gallery at y 250..314.
    box(340, 126, 18, 124, 'store-wall'),
    box(340, 314, 18, 16, 'store-wall'),
    // The store room's floor wall, with a doorway at x 196..272.
    box(46, 330, 150, 18, 'store-wall'),
    box(272, 330, 68, 18, 'store-wall'),
    // The pocket's north wall: a crawl duct at x 132..172, then masonry round to x 360.
    box(46, 470, 86, 18, 'pocket-wall'),
    box(172, 470, 188, 18, 'pocket-wall'),
  ];
}

/**
 * The Sunstone's display plinth. It is solid like any other cover: you stand at its edge and reach
 * across, rather than walking through a case of twelfth-century glass.
 */
function lootCase() {
  return box(1146, 176, 74, 58, 'case');
}

/** Crates, vitrines and pillars: they stop you and they stop a guard's line of sight. */
function coverPieces() {
  return [
    // The hall's colonnade: three pillars that break the hall into a west walk and a centre.
    box(508, 300, 46, 46, 'pillar'),
    box(508, 400, 46, 46, 'pillar'),
    box(508, 500, 46, 46, 'pillar'),
    // Two display vitrines in the middle of the hall: the hall walker passes between them, and
    // they are the only hard cover on the crossing the thief has to time. The gap between them is
    // a real corridor, wide enough to walk through at a run.
    box(676, 300, 140, 52, 'vitrine'),
    box(676, 436, 140, 52, 'vitrine'),
    // The south aisle's long vitrine, and the north gallery's plinth pair.
    box(700, 566, 150, 52, 'vitrine'),
    box(700, 210, 40, 40, 'plinth'),
    box(764, 210, 40, 40, 'plinth'),
    // The store room: a desk and two stacked crates, the clutter of a room nobody watches.
    box(84, 176, 56, 56, 'crate'),
    box(156, 240, 48, 48, 'crate'),
    box(240, 168, 74, 42, 'desk'),
    // A crate stack in the vault's north-west corner, so the vault is not a bare box.
    box(990, 136, 52, 52, 'crate'),
    // A desk on the pocket's approach, the only cover between the hall and the dark.
    box(252, 546, 88, 46, 'desk'),
  ];
}

/**
 * Pools of dead light: standing in one more than halves what a lens or an eye makes of you. The
 * pocket is almost entirely dark, which is what makes the hatch a getaway rather than a walk.
 */
function shadowPools() {
  return [
    { x: 46, y: 488, w: 300, h: 190, name: 'service pocket' },
    { x: 360, y: 340, w: 140, h: 120, name: 'dark parquet' },
    { x: 960, y: 330, w: 92, h: 58, name: 'duct mouth' },
    { x: 596, y: 126, w: 128, h: 42, name: 'burnt sconce' },
    { x: 1180, y: 300, w: 52, h: 120, name: 'vault shadow' },
  ];
}

/** The crawl ducts: openings in the masonry that slow you to a crawl. */
function ventDucts() {
  return [
    { x: 132, y: 470, w: 40, h: 18, axis: 'x', name: 'west duct' },
    { x: 960, y: 352, w: 20, h: 36, axis: 'y', name: 'vault duct' },
  ];
}

/**
 * Where a guard walks: a loop of waypoints, and how long it stands at each. Each beat owns one
 * band of the room, so the player can learn a band at a time and plan across all three.
 */
function patrolRoutes() {
  return [
    // The great hall, north to south, between the vitrines. The fast way through, and watched.
    {
      id: 'hall',
      name: 'Hall walker',
      colour: '255,74,92',
      waypoints: [
        { x: 640, y: 276, wait: 1.0 },
        { x: 640, y: 520, wait: 1.6 },
      ],
      speed: 74,
    },
    // The north gallery: the store room door and the vault's side door are both on its beat.
    {
      id: 'gallery',
      name: 'Gallery walker',
      colour: '255,110,120',
      waypoints: [
        { x: 424, y: 176, wait: 1.2 },
        { x: 926, y: 176, wait: 1.8 },
      ],
      speed: 78,
    },
    // The south aisle, past the vault's floor door: whoever holds the Sunstone has to get by it.
    {
      id: 'aisle',
      name: 'Aisle watch',
      colour: '255,92,110',
      waypoints: [
        { x: 900, y: 556, wait: 1.1 },
        { x: 1186, y: 556, wait: 2.0 },
      ],
      speed: 76,
    },
  ];
}

/**
 * Camera mounts: a point on a wall, the way it faces at rest, and where its sweep starts. Each lens
 * owns a band, and sweeps across it, so the safe window is something you learn to read. The west
 * lens watches the colonnade, the gallery lens the north gallery, the south lens the hall's south,
 * and the vault lens the case itself.
 */
function cameraMounts() {
  return [
    { x: 700, y: 126, facing: Math.PI / 2, phase: 0.0, tag: 'gallery lens' },
    { x: 46, y: 400, facing: 0, phase: 2.2, tag: 'west lens' },
    { x: 1150, y: 126, facing: Math.PI / 2, phase: 1.4, tag: 'vault lens' },
    { x: 780, y: 676, facing: -Math.PI / 2, phase: 4.1, tag: 'south lens' },
  ];
}

/**
 * Build the room. `random` only jitters the sweep phases a little, so two runs of one seed are
 * identical frames and a different seed is a different night shift.
 */
export function createLevel(random) {
  const casePiece = lootCase();
  const walls = [...roomWalls(), ...interiorWalls()];
  const cover = coverPieces();
  const solids = [...walls, ...cover, casePiece];

  return {
    walls,
    cover,
    solids,
    shadows: shadowPools(),
    ducts: ventDucts(),
    patrolRoutes: patrolRoutes(),
    cameraMounts: cameraMounts().map((mount) => ({
      ...mount,
      phase: mount.phase + randomRange(random, -0.3, 0.3),
    })),
    /** The vault's inner room, for its warmer floor and its safe door. */
    vault: { x: 980, y: 126, w: 254, h: 314 },
    /** The display plinth the Sunstone sits in, and the stone's own centre. */
    case: casePiece,
    loot: { x: casePiece.x + casePiece.w / 2, y: casePiece.y + casePiece.h / 2, name: 'the Sunstone' },
    /** The getaway hatch: a lit hatch in the dark pocket, bottom left. */
    exit: { x: 74, y: 578, w: 96, h: 84, name: 'service hatch' },
    /** Where the thief comes in from: the hall's south door. */
    entry: { x: 520, y: 640 },
    /** Paintings hung on the walls: drawn only, nothing collides with them. */
    paintings: [
      { x: 376, y: 104, w: 78, h: 22, tint: 'locke' },
      { x: 484, y: 104, w: 56, h: 22, tint: 'vale' },
      { x: 826, y: 104, w: 66, h: 22, tint: 'ash' },
      { x: 24, y: 168, w: 22, h: 76, tint: 'vale' },
      { x: 24, y: 280, w: 22, h: 58, tint: 'locke' },
      { x: 1234, y: 470, w: 22, h: 70, tint: 'ash' },
      { x: 1234, y: 176, w: 22, h: 60, tint: 'vale' },
      { x: 860, y: 678, w: 60, h: 18, tint: 'locke' },
      { x: 560, y: 678, w: 64, h: 18, tint: 'ash' },
    ],
  };
}

/** True when a circle of `radius` at (x, y) overlaps the rectangle. */
export function circleTouchesRect(x, y, radius, rect) {
  const nearX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const nearY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - nearX;
  const dy = y - nearY;
  return dx * dx + dy * dy <= radius * radius;
}

/** True when (x, y) is inside any solid of the room, grown by `radius`. */
export function isSolidAt(level, x, y, radius) {
  for (let index = 0; index < level.solids.length; index += 1) {
    if (circleTouchesRect(x, y, radius, level.solids[index])) return true;
  }
  return false;
}

/**
 * Push a body of `radius` at (x, y) out of the masonry along its shallowest axis, so sliding along
 * a wall stays smooth.
 */
export function resolveAgainstSolids(level, x, y, radius) {
  let px = x;
  let py = y;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < level.solids.length; index += 1) {
      const rect = level.solids[index];
      if (!circleTouchesRect(px, py, radius, rect)) continue;
      const left = px + radius - rect.x;
      const right = rect.x + rect.w - (px - radius);
      const top = py + radius - rect.y;
      const bottom = rect.y + rect.h - (py - radius);
      const smallest = Math.min(left, right, top, bottom);
      if (smallest === left) px -= left;
      else if (smallest === right) px += right;
      else if (smallest === top) py -= top;
      else py += bottom;
    }
  }
  return { x: px, y: py };
}

/** How dark the floor is at (x, y): 1 in the open, 0.34 in a pool of dead light. */
export function shadowAt(level, x, y) {
  for (let index = 0; index < level.shadows.length; index += 1) {
    const pool = level.shadows[index];
    if (x >= pool.x && x <= pool.x + pool.w && y >= pool.y && y <= pool.y + pool.h) return 0.34;
  }
  return 1;
}

/** Whether the straight line from (x1, y1) to (x2, y2) is interrupted by masonry or cover. */
export function isSightBlocked(level, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  for (let index = 0; index < level.solids.length; index += 1) {
    const rect = level.solids[index];
    // Liang-Barsky clip of the segment against the rectangle.
    let t0 = 0;
    let t1 = 1;
    let rejected = false;
    for (let axis = 0; axis < 2; axis += 1) {
      const origin = axis === 0 ? x1 : y1;
      const delta = axis === 0 ? dx : dy;
      const low = axis === 0 ? rect.x : rect.y;
      const high = low + (axis === 0 ? rect.w : rect.h);
      if (Math.abs(delta) < 1e-9) {
        if (origin < low || origin > high) rejected = true;
        continue;
      }
      let near = (low - origin) / delta;
      let far = (high - origin) / delta;
      if (near > far) {
        const swap = near;
        near = far;
        far = swap;
      }
      if (near > t0) t0 = near;
      if (far < t1) t1 = far;
      if (t0 > t1) rejected = true;
    }
    if (!rejected) return true;
  }
  return false;
}

/** Whether a body at (x, y) is within arm's reach of the Sunstone's plinth. */
export function isWithinReachOfCase(level, x, y) {
  const rect = level.case;
  const nearX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const nearY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  return Math.hypot(x - nearX, y - nearY) <= THIEF.reach;
}

/** Whether a body at (x, y) has its feet on the getaway hatch. */
export function isOnExit(level, x, y) {
  const hatch = level.exit;
  return x >= hatch.x && x <= hatch.x + hatch.w && y >= hatch.y && y <= hatch.y + hatch.h;
}
