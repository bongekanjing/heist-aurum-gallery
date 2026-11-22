// A small seeded random number generator (mulberry32) and the few draws the game needs, so a
// frame is reproducible from its seed alone: the same seed always paints the same room, the same
// sweep phases and the same patrol timings.

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random float in [low, high). */
export function randomRange(random, low, high) {
  return low + random() * (high - low);
}

/** A random integer in [low, high]. */
export function randomInt(random, low, high) {
  return low + Math.floor(random() * (high - low + 1));
}

/** One entry of `list`, chosen by the generator. */
export function randomPick(random, list) {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/** A small phase offset in [-spread, spread], used to desynchronise the sweep timers. */
export function randomPhase(random, spread) {
  return randomRange(random, -spread, spread);
}
