// A working best-game-01 entry (Node 22, standard library only): the game is this directory's
// game/ folder, plain static files a desktop browser loads offline (game/index.html and its ES
// modules, no library and no network request), and the program hands it in. It copies game/ and
// screenshots/ from beside this file to /output and writes /output/dossier.json, the summary the
// judge reads, with the vendored make.fun library. A starting point, not a winner: Block Dodger, a
// plain 2D canvas game where a paddle dodges falling blocks and catches coins, with a title screen,
// score, lives and levels, game over and restart, flat colours and no sound. Build your own game
// (any genre, any library you vendor under game/, or none), put your 3 or 4 PNG or JPEG screenshots
// in screenshots/ (the first by name is the cover) and run it.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// ---------------------------------------------------------------- preflight
//
// Everything from here to checkEntry() runs before a single byte is copied into the output directory.
// A half-written output directory is worse than none: the scorer reads whatever is there, so a run that
// dies in the middle leaves a game/ with no dossier.json beside it, or a screenshots/ holding only the
// first two shots, and both read as a finished entry that happens to be broken rather than as a run that
// never finished. So every rule the harness enforces is checked here, where a failure can still stop the
// copy, and the reason goes to stderr naming the path that broke it.

/** The competition's cap: 256 KiB per shot, and the harness refuses the whole entry over one. */
const SHOT_CAP_BYTES = 262144;
/** One shot is enough to hand in and four is the most a dossier holds; the first by name is the cover. */
const SHOT_MAX = 4;

/**
 * A check that failed. It is thrown rather than reported where it is found, so the reporting (stderr,
 * exit code) lives in exactly one place at the bottom of the preflight and every check reads as a plain
 * assertion. Nothing has been copied yet at that point, which is the whole reason this runs first.
 */
class PreflightError extends Error {}

/** Stop the run before anything is copied, naming the path that broke a rule. */
function stop(problem: string): never {
  throw new PreflightError(problem);
}

/** One short line per check that passed, so a green run says what it actually looked at. */
function passed(summary: string): void {
  console.log(`preflight ok:   ${summary}`);
}

/** Name order as the dossier sorts it: by UTF-16 code unit, never by locale. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The screenshots: each one a readable .jpg or .png, non-empty and under the cap, and one to four of
 * them with the first name the cover. This is the check whose failure costs most, because a shot over
 * the cap gets the entry refused outright rather than merely looking wrong.
 */
function checkScreenshots(dir: string): void {
  const shotsDir = join(dir, 'screenshots');
  let names: string[];
  try {
    names = readdirSync(shotsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort(byCodeUnit);
  } catch (err) {
    stop(`screenshots/: cannot be read (${(err as Error).message}), and the entry hands in its renders from there`);
  }
  if (names.length === 0) stop('screenshots/: holds no image, so the dossier would have no cover');
  if (names.length > SHOT_MAX) {
    stop(`screenshots/: holds ${names.length} files, over the ${SHOT_MAX} a dossier keeps (${names.join(', ')})`);
  }

  let totalBytes = 0;
  let largestName = names[0]!;
  let largestBytes = 0;
  for (const name of names) {
    const path = join(shotsDir, name);
    if (!/\.(jpe?g|png)$/i.test(name)) {
      stop(`screenshots/${name}: not a .jpg or .png, and the dossier holds only those two`);
    }
    let size: number;
    try {
      size = statSync(path).size;
    } catch (err) {
      stop(`screenshots/${name}: cannot be read (${(err as Error).message})`);
    }
    if (size === 0) stop(`screenshots/${name}: 0 bytes, and an empty file is not a render of the game`);
    if (size > SHOT_CAP_BYTES) {
      stop(`screenshots/${name}: ${size} bytes, over the ${SHOT_CAP_BYTES}-byte cap (256 KiB), so the entry would be refused`);
    }
    totalBytes += size;
    if (size > largestBytes) {
      largestBytes = size;
      largestName = name;
    }
  }

  // The dossier lists images in name order and points its cover at index 0, so the first name is the
  // frame the judge sees large. Find the first name a second time rather than trusting the sort above,
  // and say which shot the cover will be, so a mis-sorted list is a failure here and not a surprise later.
  const cover = names.reduce((low, name) => (byCodeUnit(name, low) < 0 ? name : low), names[0]!);
  if (cover !== names[0]) stop(`screenshots/: ${cover} sorts before ${names[0]}, so the cover would not be the first name`);
  passed(`screenshots/  ${names.length} file(s), ${totalBytes} bytes, largest ${largestName} at ${largestBytes} (cap ${SHOT_CAP_BYTES})`);
  passed(`cover          screenshots/${cover}  (first by name)`);
}

/** The files the harness reads beside the shots: the game it serves, then this program and its licence. */
function checkEntryFiles(dir: string): void {
  const required = ['game/index.html', 'main.ts', 'serve.ts', 'LICENSE'];
  for (const relative of required) {
    const path = join(dir, relative);
    if (!existsSync(path)) stop(`${relative}: missing, and the harness needs it in the entry`);
  }
  passed(`entry files    ${required.join(', ')}`);
}

// Report here, once. A failed check throws, so a run that is not going to succeed writes nothing at all
// into the output directory and leaves no half-copied game/ behind for the scorer to read.
try {
  checkEntryFiles(here);
  checkScreenshots(here);
} catch (err) {
  if (err instanceof PreflightError) {
    process.stderr.write(`preflight failed: ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
