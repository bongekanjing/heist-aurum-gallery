// Drawing only: world state in, pixels out. The 1280x720 playfield is scaled to fit the window and
// centred, so the composition is identical at any size and the screenshots are frames of the same
// picture. Nothing here decides a rule: every wedge drawn is the wedge detection reads.
//
// The look is a night gallery seen from above: deep blue-grey stone, faint parquet grid, pools of
// dead light, gold only where the loot is, cold red only where danger is. Cover is teal-slate and
// edges catch a light from the north, so "safe", "seen" and "worth it" read at a glance.
import { FIELD, PALETTE, FONT, GUARD, CAMERA, STANCE, GETAWAY, TOOLS } from './config.js';
import { guardSightCone } from './guard.js';
import { cameraSightCone } from './camera.js';
import { alarmFraction, getawayLeft } from './alarm.js';
import { isSolidAt } from './level.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_CAUGHT = 'caught';
export const SCREEN_GETAWAY = 'getaway';

const TAU = Math.PI * 2;
const HUD = FIELD.hudHeight;
/** How finely a cone's silhouette is sampled. Enough to hug a crate corner, few enough to stay cheap. */
const CONE_SEGMENTS = 34;

/** A rounded-rectangle path. */
function roundRect(context, x, y, w, h, r) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

/** A cached font string per size, so a frame does not rebuild it. */
function makeTypesetter(context) {
  const fonts = new Map();
  return function type(value, x, y, size, colour, align = 'left', weight = 500, baseline = 'middle') {
    const key = `${weight}:${size}`;
    if (!fonts.has(key)) fonts.set(key, `${weight} ${size}px ${FONT}`);
    context.font = fonts.get(key);
    context.fillStyle = colour;
    context.textAlign = align;
    context.textBaseline = baseline;
    context.fillText(value, x, y);
  };
}

/** Letter-spaced capitals, which is most of the game's typographic voice. */
function spacedText(context, type, value, x, y, size, colour, tracking, align = 'left', weight = 600) {
  const key = `track:${weight}:${size}:${tracking}`;
  const font = `${weight} ${size}px ${FONT}`;
  context.font = font;
  const width = context.measureText(value).width + tracking * Math.max(0, value.length - 1);
  let start = x;
  if (align === 'center') start = x - width / 2;
  else if (align === 'right') start = x - width;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = colour;
  let cursor = start;
  for (const character of value) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + tracking;
  }
  return key;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const type = makeTypesetter(context);
  const view = { scale: 1, x: 0, y: 0 };
  let unit = 1;

  function resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
    unit = ratio;
  }

  /** Screen pixels to room coordinates, for the pointer's aim. */
  function toRoomPoint(px, py) {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    return {
      x: (px * ratio - view.x) / view.scale,
      y: (py * ratio - view.y) / view.scale,
    };
  }

  // ---------------------------------------------------------------- floor and masonry

  function drawFloor(level) {
    context.fillStyle = PALETTE.page;
    context.fillRect(0, 0, FIELD.width, FIELD.height);

    // The room's stone floor, lit from the north.
    const floorGradient = context.createLinearGradient(0, 100, 0, 700);
    floorGradient.addColorStop(0, '#101c2a');
    floorGradient.addColorStop(0.55, PALETTE.floor);
    floorGradient.addColorStop(1, PALETTE.floorDeep);
    context.fillStyle = floorGradient;
    context.fillRect(24, 104, 1232, 596);

    // Parquet: a faint grid with a stronger line every fifth course.
    context.lineWidth = 1;
    for (let x = 24; x <= 1256; x += 32) {
      context.strokeStyle = (x - 24) % 160 === 0 ? PALETTE.floorLineMajor : PALETTE.floorLine;
      context.beginPath();
      context.moveTo(x + 0.5, 104);
      context.lineTo(x + 0.5, 700);
      context.stroke();
    }
    for (let y = 104; y <= 700; y += 32) {
      context.strokeStyle = (y - 104) % 160 === 0 ? PALETTE.floorLineMajor : PALETTE.floorLine;
      context.beginPath();
      context.moveTo(24, y + 0.5);
      context.lineTo(1256, y + 0.5);
      context.stroke();
    }

    // A brass inlay ring in the middle of the hall: the gallery's one flourish.
    context.strokeStyle = 'rgba(255,203,99,0.11)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(664, 392, 150, 0, TAU);
    context.stroke();
    context.strokeStyle = 'rgba(255,203,99,0.06)';
    context.beginPath();
    context.arc(664, 392, 196, 0, TAU);
    context.stroke();
  }

  function drawShadowPools(level, time) {
    // Dead light, drawn as a soft pool that fades out well inside its own rectangle. A hard-edged
    // patch reads as missing floor, so every pool is feathered to nothing at its border.
    for (const pool of level.shadows) {
      const cx = pool.x + pool.w / 2;
      const cy = pool.y + pool.h / 2;
      const radius = Math.hypot(pool.w, pool.h) * 0.5;
      const gradient = context.createRadialGradient(cx, cy, radius * 0.06, cx, cy, radius);
      gradient.addColorStop(0, 'rgba(3,6,11,0.66)');
      gradient.addColorStop(0.45, 'rgba(3,6,11,0.46)');
      gradient.addColorStop(0.78, 'rgba(3,6,11,0.20)');
      gradient.addColorStop(1, 'rgba(3,6,11,0)');
      context.fillStyle = gradient;
      context.beginPath();
      context.ellipse(cx, cy, radius, radius * 0.86, 0, 0, TAU);
      context.fill();

      // A few slow motes in the dark so the pools read as air, not paint.
      context.fillStyle = 'rgba(120,160,200,0.10)';
      for (let index = 0; index < 5; index += 1) {
        const phase = time * 0.14 + index * 1.7 + pool.x * 0.01;
        const mx = pool.x + ((Math.sin(phase) * 0.5 + 0.5) * pool.w);
        const my = pool.y + ((Math.cos(phase * 0.7) * 0.5 + 0.5) * pool.h);
        context.fillRect(mx, my, 2, 2);
      }
    }
  }

  function drawDucts(level) {
    for (const duct of level.ducts) {
      context.fillStyle = PALETTE.duct;
      context.fillRect(duct.x, duct.y, duct.w, duct.h);
      context.strokeStyle = PALETTE.ductGrate;
      context.lineWidth = 1;
      context.beginPath();
      if (duct.axis === 'x') {
        for (let y = duct.y + 4; y < duct.y + duct.h; y += 5) {
          context.moveTo(duct.x, y);
          context.lineTo(duct.x + duct.w, y);
        }
      } else {
        for (let x = duct.x + 4; x < duct.x + duct.w; x += 5) {
          context.moveTo(x, duct.y);
          context.lineTo(x, duct.y + duct.h);
        }
      }
      context.stroke();
    }
  }

  function drawWalls(level) {
    for (const wall of level.walls) {
      // The body of the masonry.
      context.fillStyle = PALETTE.wall;
      context.fillRect(wall.x, wall.y, wall.w, wall.h);
      // Panelled courses, so a long wall is not a blank bar.
      context.strokeStyle = PALETTE.wallStripe;
      context.lineWidth = 1;
      context.beginPath();
      if (wall.w > wall.h) {
        for (let x = wall.x + 44; x < wall.x + wall.w; x += 44) {
          context.moveTo(x + 0.5, wall.y + 2);
          context.lineTo(x + 0.5, wall.y + wall.h - 2);
        }
      } else {
        for (let y = wall.y + 44; y < wall.y + wall.h; y += 44) {
          context.moveTo(wall.x + 2, y + 0.5);
          context.lineTo(wall.x + wall.w - 2, y + 0.5);
        }
      }
      context.stroke();
      // Light from the north: a bright top lip and a dull bottom shadow.
      context.fillStyle = PALETTE.wallFace;
      context.fillRect(wall.x, wall.y, wall.w, 3);
      context.fillStyle = PALETTE.wallEdge;
      context.fillRect(wall.x, wall.y, wall.w, 1);
      context.fillStyle = 'rgba(0,0,0,0.38)';
      context.fillRect(wall.x, wall.y + wall.h - 2, wall.w, 2);
    }
  }

  function drawCover(level) {
    for (const piece of level.cover) {
      const { x, y, w, h, kind } = piece;
      context.save();
      // Drop shadow toward the south-east.
      context.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(context, x + 5, y + 6, w, h, kind === 'pillar' ? 10 : 5);
      context.fill();

      const body = context.createLinearGradient(x, y, x, y + h);
      body.addColorStop(0, PALETTE.coverTop);
      body.addColorStop(1, PALETTE.cover);
      context.fillStyle = body;
      if (kind === 'pillar') {
        context.beginPath();
        context.arc(x + w / 2, y + h / 2, w / 2, 0, TAU);
        context.fill();
        context.strokeStyle = PALETTE.coverEdge;
        context.lineWidth = 1.5;
        context.stroke();
        context.strokeStyle = 'rgba(147,193,229,0.10)';
        context.beginPath();
        context.arc(x + w / 2, y + h / 2, w / 2 - 7, 0, TAU);
        context.stroke();
      } else {
        roundRect(context, x, y, w, h, kind === 'desk' ? 3 : 5);
        context.fill();
        context.strokeStyle = PALETTE.coverEdge;
        context.lineWidth = 1;
        context.stroke();
        // Top face and an inner bevel.
        context.fillStyle = 'rgba(147,193,229,0.10)';
        context.fillRect(x + 3, y + 3, w - 6, 3);
        context.strokeStyle = 'rgba(0,0,0,0.30)';
        context.beginPath();
        context.moveTo(x + 5, y + h - 5);
        context.lineTo(x + w - 5, y + h - 5);
        context.stroke();
      }

      if (kind === 'crate') {
        // Banded crate slats.
        context.strokeStyle = 'rgba(147,193,229,0.16)';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x + 8, y + 8);
        context.lineTo(x + w - 8, y + h - 8);
        context.moveTo(x + w - 8, y + 8);
        context.lineTo(x + 8, y + h - 8);
        context.stroke();
      } else if (kind === 'vitrine') {
        // A glass case: gold glint in the corner, thin sheen across the top.
        const sheen = context.createLinearGradient(x, y, x + w, y + h);
        sheen.addColorStop(0, 'rgba(190,225,255,0.16)');
        sheen.addColorStop(0.45, 'rgba(190,225,255,0.03)');
        sheen.addColorStop(1, 'rgba(255,203,99,0.07)');
        context.fillStyle = sheen;
        roundRect(context, x + 2, y + 2, w - 4, h - 4, 4);
        context.fill();
        context.fillStyle = 'rgba(255,203,99,0.35)';
        context.fillRect(x + w - 12, y + 6, 4, 4);
      } else if (kind === 'desk') {
        context.fillStyle = 'rgba(255,203,99,0.22)';
        context.fillRect(x + 8, y + 8, 14, 6);
        context.fillStyle = 'rgba(200,225,250,0.14)';
        context.fillRect(x + 8, y + h - 14, 26, 3);
      }
      context.restore();
    }
  }

  function drawPaintings(level) {
    for (const painting of level.paintings) {
      const tint = painting.tint === 'locke' ? '#4a6b86' : painting.tint === 'vale' ? '#5d5568' : '#3f6157';
      context.fillStyle = 'rgba(255,203,99,0.30)';
      context.fillRect(painting.x - 2, painting.y - 2, painting.w + 4, painting.h + 4);
      context.fillStyle = tint;
      context.fillRect(painting.x, painting.y, painting.w, painting.h);
      context.fillStyle = 'rgba(0,0,0,0.30)';
      if (painting.w > painting.h) {
        context.fillRect(painting.x + 4, painting.y + painting.h * 0.55, painting.w - 8, 3);
      } else {
        context.fillRect(painting.x + painting.w * 0.55, painting.y + 4, 3, painting.h - 8);
      }
    }
  }

  // ---------------------------------------------------------------- the vault and the way out

  function drawVault(level, time, carrying) {
    const vault = level.vault;
    // The vault floor is warmer and its wall is a thick safe door.
    const gradient = context.createLinearGradient(vault.x, vault.y, vault.x, vault.y + vault.h);
    gradient.addColorStop(0, '#17202b');
    gradient.addColorStop(1, '#101822');
    context.fillStyle = gradient;
    context.fillRect(vault.x, vault.y, vault.w, vault.h);
    context.strokeStyle = 'rgba(255,203,99,0.16)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(vault.x + 10, vault.y + 10);
    context.lineTo(vault.x + vault.w - 10, vault.y + 10);
    context.lineTo(vault.x + vault.w - 10, vault.y + vault.h - 14);
    context.stroke();

    const box = level.case;
    // Plinth under the case.
    context.fillStyle = 'rgba(0,0,0,0.45)';
    context.fillRect(box.x - 6, box.y + box.h - 4, box.w + 12, 10);
    context.fillStyle = '#1b2733';
    context.fillRect(box.x - 8, box.y - 8, box.w + 16, box.h + 16);
    context.strokeStyle = 'rgba(255,203,99,0.38)';
    context.lineWidth = 1.5;
    context.strokeRect(box.x - 8, box.y - 8, box.w + 16, box.h + 16);

    // The Sunstone, unless it has been taken.
    if (!carrying) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const pulse = 0.62 + 0.38 * Math.sin(time * 2.1);
      const halo = context.createRadialGradient(cx, cy, 4, cx, cy, 96);
      halo.addColorStop(0, `rgba(255,214,130,${0.34 * pulse})`);
      halo.addColorStop(0.5, `rgba(255,180,70,${0.13 * pulse})`);
      halo.addColorStop(1, 'rgba(255,180,70,0)');
      context.fillStyle = halo;
      context.fillRect(cx - 96, cy - 96, 192, 192);

      context.save();
      context.translate(cx, cy);
      context.rotate(time * 0.35);
      context.beginPath();
      const r = 17;
      context.moveTo(0, -r);
      context.lineTo(r * 0.72, 0);
      context.lineTo(0, r);
      context.lineTo(-r * 0.72, 0);
      context.closePath();
      context.fillStyle = PALETTE.loot;
      context.fill();
      context.strokeStyle = PALETTE.lootPale;
      context.lineWidth = 1.5;
      context.stroke();
      context.beginPath();
      context.moveTo(-r * 0.72, 0);
      context.lineTo(r * 0.72, 0);
      context.strokeStyle = 'rgba(255,255,255,0.55)';
      context.stroke();
      context.restore();

      // Glass over the top: a diagonal sheen.
      context.save();
      context.beginPath();
      context.rect(box.x, box.y, box.w, box.h);
      context.clip();
      const glass = context.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
      glass.addColorStop(0, 'rgba(200,230,255,0.18)');
      glass.addColorStop(0.4, 'rgba(200,230,255,0.05)');
      glass.addColorStop(1, 'rgba(200,230,255,0.12)');
      context.fillStyle = glass;
      context.fillRect(box.x, box.y, box.w, box.h);
      context.restore();
      context.strokeStyle = 'rgba(200,230,255,0.42)';
      context.lineWidth = 1;
      context.strokeRect(box.x, box.y, box.w, box.h);
    }

    // The vault door in the floor wall, swinging as the getaway clock runs.
    const doorOpen = Boolean(carrying);
    context.save();
    context.fillStyle = doorOpen ? 'rgba(255,203,99,0.22)' : '#26333f';
    context.fillRect(1032, 440, 72, 18);
    if (doorOpen) {
      context.strokeStyle = 'rgba(255,203,99,0.5)';
      context.setLineDash([4, 4]);
      context.strokeRect(1032, 440, 72, 18);
      context.setLineDash([]);
    }
    context.restore();
  }

  function drawExit(level, alarm, time) {
    const hatch = level.exit;
    const ready = Boolean(alarm.getaway !== null);
    const pulse = 0.5 + 0.5 * Math.sin(time * (ready ? 4.2 : 1.6));
    const cx = hatch.x + hatch.w / 2;
    const cy = hatch.y + hatch.h / 2;

    const glow = context.createRadialGradient(cx, cy, 6, cx, cy, hatch.w * 1.15);
    glow.addColorStop(0, `rgba(99,230,205,${ready ? 0.30 + 0.24 * pulse : 0.13})`);
    glow.addColorStop(1, 'rgba(99,230,205,0)');
    context.fillStyle = glow;
    context.fillRect(cx - hatch.w * 1.2, cy - hatch.w * 1.2, hatch.w * 2.4, hatch.w * 2.4);

    context.fillStyle = '#07181a';
    roundRect(context, hatch.x, hatch.y, hatch.w, hatch.h, 6);
    context.fill();
    context.strokeStyle = ready ? `rgba(99,230,205,${0.6 + 0.4 * pulse})` : 'rgba(99,230,205,0.34)';
    context.lineWidth = 2.5;
    roundRect(context, hatch.x, hatch.y, hatch.w, hatch.h, 6);
    context.stroke();

    // Chevrons opening outward: the way a hatch door rolls back.
    for (let index = 0; index < 3; index += 1) {
      const inset = 12 + index * 13;
      context.strokeStyle = `rgba(99,230,205,${(ready ? 0.72 : 0.28) - index * 0.16})`;
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(hatch.x + inset, cy);
      context.lineTo(cx, hatch.y + inset + 4);
      context.lineTo(hatch.x + hatch.w - inset, cy);
      context.stroke();
    }
    spacedText(context, type, ready ? 'EXIT OPEN' : 'HATCH', cx, hatch.y + hatch.h - 13, 9, ready ? 'rgba(99,230,205,0.95)' : 'rgba(140,190,200,0.66)', 1.6, 'center');
  }

  // ---------------------------------------------------------------- cones

  /**
   * How far a cone reaches along one ray before masonry or cover stops it. The cone you see is the
   * cone that catches you, so this is the same geometry detection uses, just sampled.
   */
  function rayReach(level, x, y, angle, maxRange) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let nearest = maxRange;
    for (let index = 0; index < level.solids.length; index += 1) {
      const rect = level.solids[index];
      // A lens is bolted to the masonry it watches from: the wall it sits in must not clip its own
      // cone, or every camera would be blind. Skip any solid that already contains the origin.
      if (x >= rect.x - 1 && x <= rect.x + rect.w + 1 && y >= rect.y - 1 && y <= rect.y + rect.h + 1) continue;
      // Slab test against the rectangle, in the ray's own parameter.
      let t0 = 0;
      let t1 = Infinity;
      let miss = false;
      for (let axis = 0; axis < 2; axis += 1) {
        const origin = axis === 0 ? x : y;
        const delta = axis === 0 ? dx : dy;
        const low = axis === 0 ? rect.x : rect.y;
        const high = low + (axis === 0 ? rect.w : rect.h);
        if (Math.abs(delta) < 1e-9) {
          if (origin < low || origin > high) miss = true;
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
        if (t0 > t1) miss = true;
      }
      if (!miss && t0 > 0 && t0 < nearest) nearest = t0;
    }
    return nearest;
  }

  /** The polygon of a cone clipped by everything it cannot see through. */
  function conePolygon(level, cone, segments) {
    const points = [{ x: cone.x, y: cone.y }];
    for (let index = 0; index <= segments; index += 1) {
      const angle = cone.facing - cone.halfAngle + (cone.halfAngle * 2 * index) / segments;
      const reach = rayReach(level, cone.x, cone.y, angle, cone.range);
      points.push({ x: cone.x + Math.cos(angle) * reach, y: cone.y + Math.sin(angle) * reach });
    }
    return points;
  }

  function tracePolygon(points) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
    context.closePath();
  }

  /** A translucent wedge clipped to line of sight, with edges you can read exactly. */
  function drawWedge(points, rgb, strength, phase, options = {}) {
    const hot = options.hot ? 1 : 0;
    const base = 0.10 + strength * 0.22 + hot * 0.16;
    const origin = points[0];
    let reach = 0;
    for (let index = 1; index < points.length; index += 1) {
      reach = Math.max(reach, Math.hypot(points[index].x - origin.x, points[index].y - origin.y));
    }

    // Filled body, built as a radial gradient so it dies out at the tip instead of ending flat.
    const gradient = context.createRadialGradient(origin.x, origin.y, 8, origin.x, origin.y, Math.max(24, reach));
    gradient.addColorStop(0, `rgba(${rgb},${base + 0.11})`);
    gradient.addColorStop(0.55, `rgba(${rgb},${base})`);
    gradient.addColorStop(0.92, `rgba(${rgb},${base * 0.55})`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    context.fillStyle = gradient;
    tracePolygon(points);
    context.fill();

    // The hard outline: the line your body must not cross.
    context.strokeStyle = `rgba(${rgb},${0.24 + strength * 0.45 + hot * 0.2})`;
    context.lineWidth = 1.3 + hot;
    tracePolygon(points);
    context.stroke();

    // A scan line travelling out along the wedge, which is what makes a sweep feel alive.
    const scan = ((phase * 0.55) % 1);
    if (scan > 0.04) {
      const inner = [];
      for (let index = 1; index < points.length; index += 1) {
        inner.push({
          x: origin.x + (points[index].x - origin.x) * (0.25 + scan * 0.72),
          y: origin.y + (points[index].y - origin.y) * (0.25 + scan * 0.72),
        });
      }
      context.strokeStyle = `rgba(${rgb},${0.34 * (1 - scan)})`;
      context.lineWidth = 1.6;
      context.beginPath();
      for (let index = 0; index < inner.length; index += 1) {
        if (index === 0) context.moveTo(inner[index].x, inner[index].y);
        else context.lineTo(inner[index].x, inner[index].y);
      }
      context.stroke();
    }
  }

  /** The arc a cone can reach: dotted, so the player can plan against the full sweep, not just now. */
  function drawSweepLimits(level, x, y, range, facing, halfAngle, amplitude, rgb) {
    context.save();
    context.setLineDash([3, 9]);
    context.strokeStyle = `rgba(${rgb},0.18)`;
    context.lineWidth = 1;
    const points = [];
    for (let index = 0; index <= 34; index += 1) {
      const angle = facing - amplitude - halfAngle + ((amplitude + halfAngle) * 2 * index) / 34;
      const reach = rayReach(level, x, y, angle, range);
      points.push({ x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach });
    }
    context.beginPath();
    for (let index = 0; index < points.length; index += 1) {
      if (index === 0) context.moveTo(points[index].x, points[index].y);
      else context.lineTo(points[index].x, points[index].y);
    }
    context.stroke();
    context.restore();
  }

  function drawGuardCone(guard, strength, time, level) {
    const cone = guardSightCone(guard);
    drawSweepLimits(level, guard.x, guard.y, cone.range, guard.heading, cone.halfAngle, GUARD.sweepAmplitude * 1.7, guard.colour);
    const points = conePolygon(level, cone, CONE_SEGMENTS);
    drawWedge(points, guard.colour, strength, time * 0.9 + guard.index * 0.31, { hot: strength > 0.02 });
    // A hot core where the guard is actually looking hard.
    if (strength > 0.02) {
      const glow = context.createRadialGradient(guard.x, guard.y, 6, guard.x, guard.y, cone.range * 0.6);
      glow.addColorStop(0, `rgba(${PALETTE.dangerBright},${0.20 * strength})`);
      glow.addColorStop(1, `rgba(${PALETTE.dangerBright},0)`);
      context.fillStyle = glow;
      tracePolygon(points);
      context.fill();
    }
  }

  function drawCameraCone(camera, strength, time, level) {
    const cone = cameraSightCone(camera);
    drawSweepLimits(level, camera.x, camera.y, cone.range, camera.baseFacing, cone.halfAngle, CAMERA.sweepAmplitude, PALETTE.cameraDanger);
    drawWedge(conePolygon(level, cone, 26), PALETTE.cameraDanger, strength, time * 1.2 + camera.index * 0.5, { hot: camera.live > 0 });
  }

  // ---------------------------------------------------------------- actors
  //
  // Every actor is a figure seen from directly above, not a marker: at this size the silhouette
  // carries the read, so each body is a dark mass with one cool rim on its leading edge and one
  // bright accent (the thief's scarf, a guard's torch) that also says which way it faces. A guard
  // is broad and square-shouldered in oxblood; the thief is narrower, hooded and cyan. You can
  // tell them apart by shape and hue at a glance, which is the point.

  /** One rounded limb: a thick line with round caps, from (ax,ay) to (bx,by). */
  function limb(ax, ay, bx, by, width, fill) {
    context.strokeStyle = fill;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(ax, ay);
    context.lineTo(bx, by);
    context.stroke();
    context.lineCap = 'butt';
  }

  /**
   * A guard from above: two heavy legs swinging under a broad slab of a body, epaulettes catching
   * the light, and a helmet with a cap peak. The body turns to face the way it walks while the
   * head and torch turn to where it looks, so the sweep of the head is visible as a sweep.
   *
   * The uniform is lit oxblood, not the near-black silhouette the floor already is: the figure has
   * to sit *lighter* than the stone to read as a body, with a hot rim on its leading shoulder and a
   * dark outline to hold the silhouette against the display cases too. The torch sits on the cone's
   * own axis, just ahead of the chest, which is why the wedge reads as leaving the guard.
   */
  function drawGuard(guard, seesThief, time) {
    const { x, y } = guard;
    const stride = Math.sin(time * 6.2 + guard.index * 1.7);
    const alert = guard.notice > GUARD.noticeThreshold;
    const accent = seesThief ? 1 : alert ? 0.9 : 0.74;

    context.save();
    context.translate(x, y);

    // Contact shadow, thrown the way the gallery light falls.
    context.fillStyle = 'rgba(0,0,0,0.62)';
    context.beginPath();
    context.ellipse(3, 7, 19, 13, 0, 0, TAU);
    context.fill();

    // ---- body, squared up with the direction of travel
    context.rotate(guard.heading);

    // A dark outline behind the whole figure, thick enough to hold the silhouette on pale cover.
    context.strokeStyle = 'rgba(3,6,10,0.9)';
    context.lineWidth = 13;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(-3, -6.5);
    context.lineTo(-15, -8.5);
    context.moveTo(-3, 6.5);
    context.lineTo(-15, 8.5);
    context.moveTo(0, -10);
    context.lineTo(8, -9);
    context.moveTo(0, 10);
    context.lineTo(8, 9);
    context.stroke();
    context.lineCap = 'butt';

    // Legs, swinging out behind the hips. Lit enough to be legs, not a smudge.
    limb(-3, -6.2, -15 + stride * 3, -8.4, 7.5, '#8f4657');
    limb(-3, 6.2, -15 - stride * 3, 8.4, 7.5, '#8f4657');
    // Boots, a darker note at the end of each leg.
    context.fillStyle = '#3a1a24';
    for (const side of [-1, 1]) {
      context.beginPath();
      context.ellipse(-15 + stride * 3 * side, 8.4 * side, 3.6, 3.1, 0, 0, TAU);
      context.fill();
    }
    // Arms, held wide and heavy.
    limb(0, -10.8, 8, -9.2, 6.5, '#a3535f');
    limb(0, 10.8, 8, 9.2, 6.5, '#a3535f');

    // The slab of a torso: twenty-four pixels across the shoulders, much wider than the thief, and
    // lit well above the stone so the body is a body and not a hole in the floor.
    const uniform = context.createLinearGradient(-11, -12, 9, 12);
    uniform.addColorStop(0, '#c06a72');
    uniform.addColorStop(0.45, '#9b4b5a');
    uniform.addColorStop(1, '#5d2a36');
    context.fillStyle = uniform;
    roundRect(context, -11, -12, 21, 24, 5.5);
    context.fill();
    context.strokeStyle = `rgba(${guard.colour},${0.6 + accent * 0.4})`;
    context.lineWidth = seesThief ? 2.6 : 1.8;
    roundRect(context, -11, -12, 21, 24, 5.5);
    context.stroke();
    // A rim of hot light down the leading shoulder, so the mass lifts off the floor.
    context.strokeStyle = `rgba(255,224,214,${0.5 + accent * 0.3})`;
    context.lineWidth = 1.9;
    context.beginPath();
    context.moveTo(-8, -11.6);
    context.lineTo(7, -11.6);
    context.stroke();
    // A belt across the back, which is what makes a torso read as a torso from overhead.
    context.strokeStyle = 'rgba(38,14,20,0.6)';
    context.lineWidth = 2.6;
    context.beginPath();
    context.moveTo(-2, -10);
    context.lineTo(-2, 10);
    context.stroke();
    // Epaulettes: the brightest marks on the uniform, so the shoulders read even at a glance.
    context.fillStyle = `rgba(${guard.colour},0.98)`;
    roundRect(context, -2, -14.6, 9, 4.4, 2.2);
    context.fill();
    roundRect(context, -2, 10.2, 9, 4.4, 2.2);
    context.fill();
    context.restore();

    // ---- head and torch, turned to where the cone points
    context.save();
    context.translate(x, y);
    context.rotate(guard.facing);
    // Cap peak: a hard wedge that gives the head an unmistakable front.
    context.fillStyle = `rgba(${guard.colour},0.98)`;
    context.beginPath();
    context.moveTo(19, 0);
    context.lineTo(10.4, -8);
    context.lineTo(10.4, 8);
    context.closePath();
    context.fill();
    // Helmet, dark with a bright crown rim.
    context.fillStyle = '#2a1119';
    context.beginPath();
    context.arc(10.6, 0, 7.1, 0, TAU);
    context.fill();
    context.strokeStyle = `rgba(${guard.colour},${0.55 + accent * 0.4})`;
    context.lineWidth = 1.9;
    context.stroke();
    context.strokeStyle = 'rgba(255,220,215,0.55)';
    context.lineWidth = 1.3;
    context.beginPath();
    context.arc(10.6, 0, 5.3, Math.PI * 1.06, Math.PI * 1.94);
    context.stroke();
    // The visor: a pale notch at the front, so the head has a face.
    context.fillStyle = 'rgba(255,240,236,0.62)';
    context.beginPath();
    context.ellipse(15.4, 0, 2, 2.9, 0, 0, TAU);
    context.fill();
    // The torch: a hot nub on the cone's own axis. This is where the wedge comes from.
    const torch = context.createRadialGradient(16, 0, 0.5, 16, 0, 13);
    torch.addColorStop(0, 'rgba(255,246,240,0.98)');
    torch.addColorStop(0.26, `rgba(${guard.colour},0.78)`);
    torch.addColorStop(1, `rgba(${guard.colour},0)`);
    context.fillStyle = torch;
    context.beginPath();
    context.arc(16, 0, 13, 0, TAU);
    context.fill();
    context.fillStyle = '#fff2ec';
    context.beginPath();
    context.arc(16, 0, 2.7, 0, TAU);
    context.fill();
    context.restore();

    // A "?" while it is walking to a noise, a "!" when it has eyes on you.
    if (guard.notice > GUARD.noticeThreshold) {
      const bounce = 1 + 0.16 * Math.sin(time * 14);
      context.save();
      context.translate(x, y - 30);
      context.scale(bounce, bounce);
      context.fillStyle = PALETTE.dangerBright;
      context.beginPath();
      roundRect(context, -8, -10, 16, 15, 3);
      context.fill();
      context.beginPath();
      context.moveTo(-2, 5);
      context.lineTo(2, 5);
      context.lineTo(0, 10);
      context.closePath();
      context.fill();
      type('!', 0, -2, 12, '#fff6f6', 'center', 800);
      context.restore();
    } else if (guard.state === 'investigate') {
      type('?', x, y - 30, 17, 'rgba(255,203,99,0.9)', 'center', 800);
    }
  }

  /**
   * A wall lens as hardware: a bolted base plate, an arm out of the wall, a boxy housing and a
   * barrel with a glass lens at the end of it. The whole assembly turns on the mount, so the lens
   * and the wedge it throws always point the same way, and the mounting bracket stays put against
   * the wall, which is what makes it read as a fixture rather than a creature.
   */
  function drawCamera(camera, time) {
    const { x, y } = camera;
    const live = camera.live > 0;
    const blink = Math.sin(time * 2.4 + camera.index * 2.1) * 0.5 + 0.5;

    // ---- the bolted base plate, fixed to the wall and never rotating
    context.save();
    context.translate(x, y);
    context.fillStyle = '#101c26';
    roundRect(context, -12, -12, 24, 24, 3.5);
    context.fill();
    context.strokeStyle = 'rgba(186,216,240,0.55)';
    context.lineWidth = 1.5;
    roundRect(context, -12, -12, 24, 24, 3.5);
    context.stroke();
    // Two bolts, so the plate is a plate and not a circle.
    context.fillStyle = 'rgba(214,234,250,0.72)';
    for (const bolt of [[-8.5, -8.5], [-8.5, 8.5]]) {
      context.beginPath();
      context.arc(bolt[0], bolt[1], 1.7, 0, TAU);
      context.fill();
    }
    context.restore();

    // ---- the arm, housing and barrel, all turning together on the mount
    context.save();
    context.translate(x, y);
    context.rotate(camera.facing);

    // Arm out of the plate.
    context.strokeStyle = '#40566c';
    context.lineWidth = 6;
    context.lineCap = 'square';
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(8, 0);
    context.stroke();
    context.lineCap = 'butt';

    // Housing: a hard-edged box, taller than it is deep — a camera body, not a dot. Lit steel, so
    // it reads as hardware against the dark stone rather than as another shadow.
    const housing = context.createLinearGradient(0, -11, 0, 11);
    housing.addColorStop(0, '#9fb6c9');
    housing.addColorStop(0.42, '#6c8399');
    housing.addColorStop(1, '#33475c');
    context.fillStyle = housing;
    roundRect(context, 6, -11, 15, 22, 2.5);
    context.fill();
    context.strokeStyle = live ? 'rgba(255,84,138,0.95)' : 'rgba(206,232,250,0.72)';
    context.lineWidth = 1.7;
    roundRect(context, 6, -11, 15, 22, 2.5);
    context.stroke();

    // A seam and a status lamp on the side of the body.
    context.strokeStyle = 'rgba(16,28,40,0.55)';
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(8, -3.5);
    context.lineTo(19, -3.5);
    context.stroke();
    context.fillStyle = live ? '#ff2f52' : '#ff7f9e';
    context.beginPath();
    context.arc(9.6, 6.2, 1.9, 0, TAU);
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.55)';
    context.lineWidth = 0.8;
    context.stroke();

    // Barrel: a stubby cylinder sticking out of the front, with a hood over the glass.
    const barrel = context.createLinearGradient(0, -7, 0, 7);
    barrel.addColorStop(0, '#c3d6e4');
    barrel.addColorStop(0.45, '#738a9e');
    barrel.addColorStop(1, '#2b3d50');
    context.fillStyle = barrel;
    roundRect(context, 19, -7, 10, 14, 2);
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.42)';
    context.lineWidth = 1.2;
    roundRect(context, 19, -7, 10, 14, 2);
    context.stroke();
    // The hood lip, which is what makes a barrel read as a barrel.
    context.strokeStyle = 'rgba(224,242,255,0.72)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(28.5, -8);
    context.lineTo(28.5, 8);
    context.stroke();

    // Glass: the red pupil, brighter when the lens has the thief.
    const lensGlow = context.createRadialGradient(28, 0, 0.4, 28, 0, 12);
    lensGlow.addColorStop(0, live ? 'rgba(255,248,250,1)' : 'rgba(255,214,228,0.95)');
    lensGlow.addColorStop(0.2, live ? 'rgba(255,34,78,0.98)' : 'rgba(255,84,138,0.85)');
    lensGlow.addColorStop(1, 'rgba(255,84,138,0)');
    context.fillStyle = lensGlow;
    context.beginPath();
    context.arc(28, 0, 12, 0, TAU);
    context.fill();
    // A hard glass ring, so the lens has an edge.
    context.strokeStyle = live ? 'rgba(255,60,96,1)' : 'rgba(255,140,176,0.85)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(28, 0, 3.9, 0, TAU);
    context.stroke();
    context.restore();

    // The halo of a live lens, outside the rotation so it stays round.
    context.fillStyle = `rgba(255,84,138,${live ? 0.12 + 0.16 * blink : 0.06 + 0.07 * blink})`;
    context.beginPath();
    context.arc(x, y, 20 + blink * 3, 0, TAU);
    context.fill();
  }

  /**
   * The thief from above: a hood over a narrow pair of shoulders, two arms and two legs, with a cool
   * white rim along the crown and shoulders so the whole figure lifts off the dark floor. The hood
   * leads the heading and a pale scarf across the front of it is the facing mark.
   *
   * His palette is deliberately the brightest thing that is not loot: lit teal with a bone-white rim,
   * where a guard is lit oxblood with a hot pink rim. Shape says thief-or-guard too — narrow
   * shouldered and hooded against broad and helmeted — so the two never have to be told apart by
   * colour alone. Crouched, the figure compresses and dims; sprinting, the legs over-extend and
   * leave ghost trails.
   */
  function drawThief(thief, alarm, time) {
    const { x, y } = thief;
    const r = thief.radius;
    const crouching = thief.stance === 'crouch';
    const sprinting = thief.stance === 'sprint';
    // Crouched he is lower and smaller; sprinting he is stretched out along his line of travel.
    const squash = crouching ? 0.86 : sprinting ? 1.06 : 1;
    const stride = Math.sin(time * 9.5) * (sprinting ? 1 : 0.55);
    // Crouching reads as lower and tighter, not as invisible: he stays bright enough to be the
    // clearest thing in the frame, because the thief is the one thing every screenshot must show.
    const lit = crouching ? 0.88 : 1;

    // Shadow.
    context.fillStyle = 'rgba(0,0,0,0.58)';
    context.beginPath();
    context.ellipse(x + 2, y + 6, (r + 6) * squash, (r + 3.5) * squash, 0, 0, TAU);
    context.fill();

    // The Sunstone in hand glows through the coat.
    if (thief.carrying) {
      const halo = context.createRadialGradient(x, y, 2, x, y, 54);
      halo.addColorStop(0, 'rgba(255,203,99,0.48)');
      halo.addColorStop(1, 'rgba(255,203,99,0)');
      context.fillStyle = halo;
      context.fillRect(x - 54, y - 54, 108, 108);
    }

    // ---- motion trails, behind a sprint
    if (sprinting) {
      for (let ghost = 1; ghost <= 3; ghost += 1) {
        const back = ghost * 8;
        context.fillStyle = `rgba(99,230,205,${0.20 / ghost})`;
        context.beginPath();
        context.ellipse(
          x - Math.cos(thief.heading) * back,
          y - Math.sin(thief.heading) * back,
          (r - ghost) * squash,
          (r - ghost * 1.4) * squash,
          thief.heading, 0, TAU,
        );
        context.fill();
      }
    }

    context.save();
    context.translate(x, y);
    context.rotate(thief.heading);
    // The figure is drawn at ~26 px and lifted a little, so its long axis lands near the 30 px the
    // brief asks for and it stays the first thing the eye finds in a 1280x720 frame.
    const SCALE = 1.14;
    context.scale(SCALE, squash * SCALE);

    // A dark keyline around the whole body, so the pale figure still holds on a pale display case.
    context.strokeStyle = 'rgba(2,10,10,0.82)';
    context.lineWidth = 9;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(-4, -4.4);
    context.lineTo(-16, -7.8);
    context.moveTo(-4, 4.4);
    context.lineTo(-16, 7.8);
    context.moveTo(2, -8.4);
    context.lineTo(10, -6.6);
    context.moveTo(2, 8.4);
    context.lineTo(10, 6.6);
    context.stroke();
    context.lineCap = 'butt';

    // Legs, reaching out behind the hips. They are drawn past the edge of the coat on purpose: a
    // leg that ends inside the torso silhouette is not a leg, it is a bump, and the brief's test is
    // that this reads as a person and not a dot.
    const legSwing = sprinting ? 7.5 : 4.5;
    limb(-4, -4.4, -16 - stride * legSwing, -7.8, 6, `rgba(30,150,142,${lit})`);
    limb(-4, 4.4, -16 + stride * legSwing, 7.8, 6, `rgba(30,150,142,${lit})`);
    // Arms: the leading arm reaches forward past the shoulder, the trailing one is tucked.
    limb(2, -8.4, 10 + stride * 1.4, -6.6, 5, `rgba(58,186,172,${lit})`);
    limb(2, 8.4, 10 - stride * 1.4, 6.6, 5, `rgba(58,186,172,${lit})`);

    // The coat: a rounded mass, narrower than a guard's, lit from the north-west.
    const coat = context.createLinearGradient(-6, -9, 5, 9);
    coat.addColorStop(0, `rgba(150,255,238,${lit})`);
    coat.addColorStop(0.45, `rgba(74,215,199,${lit})`);
    coat.addColorStop(1, `rgba(26,146,138,${lit})`);
    context.fillStyle = coat;
    context.beginPath();
    context.ellipse(-0.5, 0, 8, 9.2, 0, 0, TAU);
    context.fill();
    context.strokeStyle = `rgba(196,255,246,${0.55 * lit})`;
    context.lineWidth = 1.4;
    context.stroke();
    // The rim light along the crown of the shoulders: the brightest line on the figure.
    context.strokeStyle = `rgba(232,255,252,${0.85 * lit})`;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(-0.5, 0, 7.7, Math.PI * 1.12, Math.PI * 1.88);
    context.stroke();
    // A seam down the back of the coat, so the torso reads as a back and not a ball.
    context.strokeStyle = `rgba(9,66,63,${0.55 * lit})`;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-4.5, -5.5);
    context.lineTo(-4.5, 5.5);
    context.stroke();

    // The hood: a smaller, darker dome that leads the body, so the figure has a clear front.
    const hood = context.createLinearGradient(1, -6, 8, 6);
    hood.addColorStop(0, `rgba(52,186,174,${lit})`);
    hood.addColorStop(1, `rgba(14,104,100,${lit})`);
    context.fillStyle = hood;
    context.beginPath();
    context.ellipse(5, 0, 5.6, 6, 0, 0, TAU);
    context.fill();
    context.strokeStyle = `rgba(210,255,248,${0.7 * lit})`;
    context.lineWidth = 1.3;
    context.stroke();
    // The hood's crown rim, echoing the shoulder rim.
    context.strokeStyle = `rgba(240,255,254,${0.8 * lit})`;
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(5, 0, 4.6, Math.PI * 1.2, Math.PI * 1.8);
    context.stroke();
    // The scarf: a pale band across the front of the hood. This is the facing mark.
    context.fillStyle = `rgba(238,255,252,${0.95 * lit})`;
    context.beginPath();
    context.ellipse(8.2, 0, 2, 3.4, 0, 0, TAU);
    context.fill();

    // The scarf tail, which flutters with speed.
    const flutter = Math.sin(time * 12) * (sprinting ? 4 : 2.2);
    context.strokeStyle = `rgba(160,255,240,${0.7 * lit})`;
    context.lineWidth = 2.6;
    context.beginPath();
    context.moveTo(-6, 0);
    context.quadraticCurveTo(-13, flutter, -19 - (sprinting ? 7 : 0), flutter * 0.4);
    context.stroke();
    context.restore();

    // A stance ring: dashed when crouched, a bright arc when sprinting.
    if (crouching) {
      context.save();
      context.setLineDash([3, 4]);
      context.strokeStyle = 'rgba(99,230,205,0.40)';
      context.lineWidth = 1.2;
      context.beginPath();
      context.arc(x, y, r + 6, 0, TAU);
      context.stroke();
      context.restore();
    } else if (sprinting) {
      context.strokeStyle = 'rgba(255,203,99,0.38)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, r + 10, thief.heading + 2.2, thief.heading + 4.1);
      context.stroke();
    }

    // The reach ring while working the case.
    if (thief.grabProgress > 0.01) {
      context.strokeStyle = 'rgba(255,203,99,0.9)';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(x, y, r + 14, -Math.PI / 2, -Math.PI / 2 + TAU * thief.grabProgress);
      context.stroke();
    }
  }

  function drawNoisemakers(world, time) {
    for (const ping of world.noisemakers.list) {
      const loud = Math.max(0, ping.life / TOOLS.pingSeconds);
      if (!ping.landed) {
        // In flight: a small spinning spark.
        context.save();
        context.translate(ping.x, ping.y);
        context.rotate(ping.phase);
        context.fillStyle = '#d8e8f4';
        context.fillRect(-3, -3, 6, 6);
        context.strokeStyle = 'rgba(216,232,244,0.8)';
        context.strokeRect(-3, -3, 6, 6);
        context.restore();
      } else {
        // On the floor: rings of sound that reach the guard's ear radius.
        for (let ring = 0; ring < 3; ring += 1) {
          const life = ((ping.age * 1.5 + ring / 3) % 1);
          const radius = 8 + life * TOOLS.pingRadius * 0.7;
          context.strokeStyle = `rgba(255,203,99,${0.42 * loud * (1 - life)})`;
          context.lineWidth = 1.6;
          context.beginPath();
          context.arc(ping.x, ping.y, radius, 0, TAU);
          context.stroke();
        }
        context.fillStyle = `rgba(255,203,99,${0.35 + 0.4 * loud})`;
        context.beginPath();
        context.arc(ping.x, ping.y, 4, 0, TAU);
        context.fill();
        context.strokeStyle = 'rgba(255,240,200,0.85)';
        context.lineWidth = 1;
        context.stroke();
      }
    }
  }

  function drawFootSteps(thief) {
    if (thief.stepPulse <= 0 || thief.stance === 'crouch') return;
    const radius = 14 + (1 - thief.stepPulse) * 46 * thief.noise;
    context.strokeStyle = `rgba(200,225,245,${0.16 * thief.stepPulse})`;
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(thief.x, thief.y, radius, 0, TAU);
    context.stroke();
  }

  function drawAim(world, aim) {
    if (!aim) return;
    const thief = world.thief;
    const angle = Math.atan2(aim.y - thief.y, aim.x - thief.x);
    const distance = Math.min(190, Math.hypot(aim.x - thief.x, aim.y - thief.y));
    const tipX = thief.x + Math.cos(angle) * distance;
    const tipY = thief.y + Math.sin(angle) * distance;
    context.save();
    context.setLineDash([2, 7]);
    context.strokeStyle = 'rgba(255,203,99,0.34)';
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(thief.x + Math.cos(angle) * 18, thief.y + Math.sin(angle) * 18);
    context.lineTo(tipX, tipY);
    context.stroke();
    context.setLineDash([]);
    context.strokeStyle = 'rgba(255,203,99,0.7)';
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(tipX, tipY, 7, 0, TAU);
    context.moveTo(tipX - 11, tipY);
    context.lineTo(tipX - 4, tipY);
    context.moveTo(tipX + 4, tipY);
    context.lineTo(tipX + 11, tipY);
    context.moveTo(tipX, tipY - 11);
    context.lineTo(tipX, tipY - 4);
    context.moveTo(tipX, tipY + 4);
    context.lineTo(tipX, tipY + 11);
    context.stroke();
    context.restore();
  }

  // ---------------------------------------------------------------- overlays

  /** A thin line from each eye to the thief, plus a bracket round the body while you are seen. */
  function drawSightLines(world) {
    const { thief, sightings } = world;
    for (const sighting of sightings) {
      const source = sighting.source;
      const alpha = 0.12 + sighting.pressure * 0.5;
      const rgb = sighting.kind === 'camera' ? PALETTE.cameraDanger : PALETTE.dangerBright;
      context.strokeStyle = `rgba(${rgb},${alpha})`;
      context.lineWidth = 1 + sighting.pressure * 1.4;
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(thief.x, thief.y);
      context.stroke();
    }
    if (sightings.length > 0) {
      const pressure = Math.max(...sightings.map((sighting) => sighting.pressure));
      const r = thief.radius + 13;
      context.strokeStyle = `rgba(${PALETTE.dangerBright},${0.45 + pressure * 0.5})`;
      context.lineWidth = 2;
      const corner = 7;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        context.beginPath();
        context.moveTo(thief.x + sx * r, thief.y + sy * r - sy * corner);
        context.lineTo(thief.x + sx * r, thief.y + sy * r);
        context.lineTo(thief.x + sx * r - sx * corner, thief.y + sy * r);
        context.stroke();
      }
    }
  }

  function drawVignette(alarm, time) {
    const fraction = alarmFraction(alarm);
    const gradient = context.createRadialGradient(640, 400, 240, 640, 400, 780);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(2,4,8,${0.55 + fraction * 0.2})`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, FIELD.width, FIELD.height);

    // The alarm in your face: a pulsing red edge once the meter is hot.
    if (fraction > 0.35) {
      const pulse = 0.5 + 0.5 * Math.sin(time * (6 + fraction * 12));
      const heat = (fraction - 0.35) / 0.65;
      const edge = context.createRadialGradient(640, 400, 300, 640, 400, 760);
      edge.addColorStop(0, 'rgba(255,40,60,0)');
      edge.addColorStop(1, `rgba(255,30,52,${0.16 * heat + 0.12 * heat * pulse})`);
      context.fillStyle = edge;
      context.fillRect(0, 0, FIELD.width, FIELD.height);
    }
  }

  /**
   * The spotted callout: a 26-pixel strip pinned under the alarm meter, on the wall band above the
   * room, centred on the meter that is filling. It cannot cover a cone, a guard or the thief —
   * they are all below it and to the right — and it reads as the meter's own caption rather than
   * as a curtain over the play area.
   */
  function drawSpottedFlash(world, time) {
    const alarm = world.alarm;
    if (alarm.spotted <= 0.02) return;
    const alpha = Math.min(1, alarm.spotted);
    const grow = 1 + (1 - alpha) * 0.06;
    // Centred under the alarm meter, whose track runs x 28..480 at y 66..
    const centreX = 254;
    context.save();
    context.globalAlpha = alpha;
    context.translate(centreX, HUD + 15);
    context.scale(grow, grow);
    const plate = context.createLinearGradient(-150, 0, 150, 0);
    plate.addColorStop(0, 'rgba(255,30,52,0)');
    plate.addColorStop(0.5, 'rgba(255,30,52,0.38)');
    plate.addColorStop(1, 'rgba(255,30,52,0)');
    context.fillStyle = plate;
    context.fillRect(-160, -13, 320, 26);
    spacedText(context, type, 'SPOTTED', 0, -1, 15, '#fff0f2', 4.4, 'center', 800);
    const seenBy = world.sightings.length > 0
      ? world.sightings.map((sighting) => (sighting.kind === 'camera' ? sighting.source.tag : sighting.source.name)).join('  ·  ')
      : 'a patrol';
    type(seenBy.toUpperCase(), 0, 11, 7, 'rgba(255,224,228,0.85)', 'center', 600);
    context.restore();
  }

  // ---------------------------------------------------------------- HUD

  /**
   * The alarm's word, picked from the same percentage the meter is showing. A bar at 52% reading
   * "EASY" is incoherent, so this scale only ever rises with the number: QUIET, UNEASY, ALERT,
   * SEEN, and the top state once it has actually blared. The thresholds are the meter's own.
   */
  function alarmLabel(alarm) {
    const percent = Math.round(alarmFraction(alarm) * 100);
    if (alarm.blared || percent >= 100) return 'SPOTTED';
    if (percent >= 72) return 'SEEN';
    if (percent >= 46) return 'ALERT';
    if (percent >= 22) return 'UNEASY';
    return 'QUIET';
  }

  function drawAlarmMeter(alarm, x, y, w, h) {
    const fraction = alarmFraction(alarm);
    const percent = Math.round(fraction * 100);
    const label = alarmLabel(alarm);
    // The colour rises with the word, so the bar and the text can never disagree.
    const colour = percent >= 100 ? '#ff2f4a' : percent >= 72 ? '#ff5a52' : percent >= 46 ? '#ff7a4a' : percent >= 22 ? '#ffcb63' : '#3ee0a5';
    const rgb = percent >= 100 ? '255,47,74' : percent >= 72 ? '255,90,82' : percent >= 46 ? '255,122,74' : percent >= 22 ? '255,203,99' : '62,224,165';

    spacedText(context, type, 'ALARM', x, y - 12, 10, PALETTE.muted, 2.4, 'left', 700);

    const track = context.createLinearGradient(x, y, x + w, y);
    track.addColorStop(0, 'rgba(255,255,255,0.055)');
    track.addColorStop(1, 'rgba(255,255,255,0.10)');
    context.fillStyle = track;
    roundRect(context, x, y, w, h, h / 2);
    context.fill();

    if (fraction > 0.001) {
      const fill = context.createLinearGradient(x, y, x + w * Math.max(0.08, fraction), y);
      fill.addColorStop(0, `rgba(${rgb},0.55)`);
      fill.addColorStop(1, `rgba(${rgb},0.95)`);
      context.save();
      roundRect(context, x, y, w, h, h / 2);
      context.clip();
      context.fillStyle = fill;
      context.fillRect(x, y, w * fraction, h);
      // Hazard hatching inside the fill, which makes a rising meter easy to read at a glance.
      context.strokeStyle = 'rgba(0,0,0,0.20)';
      context.lineWidth = 3;
      context.beginPath();
      for (let sx = x - h; sx < x + w + h; sx += 10) {
        context.moveTo(sx, y + h);
        context.lineTo(sx + h, y);
      }
      context.stroke();
      context.restore();

      if (fraction > 0.55) {
        const glow = context.createLinearGradient(x, y - 8, x, y + h + 8);
        glow.addColorStop(0, `rgba(${rgb},0)`);
        glow.addColorStop(0.5, `rgba(${rgb},${0.25 + 0.2 * Math.sin(alarm.value)})`);
        glow.addColorStop(1, `rgba(${rgb},0)`);
        context.fillStyle = glow;
        context.fillRect(x - 4, y - 8, w * fraction + 8, h + 16);
      }
    }

    // Quarter ticks, so "partly filled" is a number you can read.
    context.strokeStyle = 'rgba(6,10,16,0.55)';
    context.lineWidth = 1;
    context.beginPath();
    for (let index = 1; index < 4; index += 1) {
      const tx = x + (w * index) / 4;
      context.moveTo(tx, y + 2);
      context.lineTo(tx, y + h - 2);
    }
    context.stroke();

    context.strokeStyle = 'rgba(126,170,210,0.26)';
    roundRect(context, x, y, w, h, h / 2);
    context.stroke();

    type(`${percent}%`, x + w + 12, y + h / 2, 15, colour, 'left', 800);
    // The band word sits beside the number at a size the contact sheet can still resolve: the
    // number and the word must agree, so neither may be the faint one.
    spacedText(context, type, label, x + w + 66, y + h / 2, 12, colour, 2.4, 'left', 800);
  }

  function drawLootChip(world, x, y) {
    const carried = world.thief.carrying;
    const w = 186;
    const h = 42;
    context.fillStyle = carried ? 'rgba(255,203,99,0.14)' : 'rgba(255,255,255,0.035)';
    roundRect(context, x, y, w, h, 8);
    context.fill();
    context.strokeStyle = carried ? 'rgba(255,203,99,0.75)' : 'rgba(126,170,210,0.22)';
    context.lineWidth = 1.2;
    context.stroke();

    // A tiny diamond, gold when it is still in the building, dim when it is in your coat.
    context.save();
    context.translate(x + 24, y + h / 2);
    context.beginPath();
    context.moveTo(0, -9);
    context.lineTo(7, 0);
    context.lineTo(0, 9);
    context.lineTo(-7, 0);
    context.closePath();
    context.fillStyle = carried ? 'rgba(255,203,99,0.45)' : PALETTE.loot;
    context.fill();
    context.strokeStyle = carried ? 'rgba(255,203,99,0.6)' : PALETTE.lootPale;
    context.lineWidth = 1.2;
    context.stroke();
    context.restore();

    spacedText(context, type, 'SUNSTONE', x + 42, y + 14, 9, 'rgba(255,203,99,0.75)', 1.8, 'left', 700);
    type(carried ? 'IN THE COAT' : 'IN THE CASE', x + 42, y + 30, 13, carried ? PALETTE.goldText : PALETTE.muted, 'left', 600);
  }

  function drawToolPips(thief, x, y) {
    spacedText(context, type, 'NOISEMAKERS', x, y - 12, 9, PALETTE.muted, 1.8, 'left', 700);
    for (let index = 0; index < TOOLS.noisemakers; index += 1) {
      const px = x + index * 26;
      const armed = index < thief.toolsLeft;
      context.fillStyle = armed ? 'rgba(216,232,244,0.9)' : 'rgba(216,232,244,0.10)';
      roundRect(context, px, y - 4, 20, 20, 5);
      context.fill();
      context.strokeStyle = armed ? 'rgba(255,255,255,0.7)' : 'rgba(126,170,210,0.22)';
      context.lineWidth = 1.1;
      roundRect(context, px, y - 4, 20, 20, 5);
      context.stroke();
      if (armed) {
        context.strokeStyle = 'rgba(20,30,40,0.65)';
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(px + 5, y + 6);
        context.lineTo(px + 15, y + 6);
        context.moveTo(px + 8, y + 2);
        context.lineTo(px + 12, y + 10);
        context.stroke();
      }
    }
    type('Q / right click', x + 64, y + 6, 11, PALETTE.muted, 'left', 500);
  }

  function drawGetawayClock(alarm, x, y) {
    const left = getawayLeft(alarm);
    spacedText(context, type, 'GETAWAY', x, y - 12, 9, PALETTE.muted, 1.8, 'left', 700);
    if (left === null) {
      type('arm the hatch', x, y + 8, 14, PALETTE.muted, 'left', 500);
      return;
    }
    const urgent = left < 10;
    const colour = urgent ? '#ff5d63' : left < 22 ? PALETTE.goldText : '#bfe6f5';
    type(`${left.toFixed(1)}s`, x, y + 6, 20, colour, 'left', 700);
    const barW = 150;
    context.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(context, x + 62, y - 1, barW, 8, 4);
    context.fill();
    context.fillStyle = urgent ? 'rgba(255,93,99,0.9)' : 'rgba(191,230,245,0.65)';
    roundRect(context, x + 62, y - 1, barW * Math.max(0, Math.min(1, left / GETAWAY.seconds)), 8, 4);
    context.fill();
  }

  function drawObjective(world) {
    const { thief, alarm } = world;
    let line = 'Slip in, take the Sunstone, get out through the service hatch';
    if (thief.carrying) line = 'Sunstone in the coat — run for the service hatch in the dark pocket';
    else if (alarm.getaway !== null) line = 'The vault is open — take the Sunstone and run';
    else if (alarm.value > alarm.max * 0.55) line = 'They are looking hard — break line of sight, crouch, use the dark';
    spacedText(context, type, line, 28, HUD - 8, 11, PALETTE.muted, 0.2, 'left', 500);
  }

  function drawHud(world, aim) {
    context.save();
    // The HUD plate, with a hairline of light along its bottom edge.
    const plate = context.createLinearGradient(0, 0, 0, HUD);
    plate.addColorStop(0, 'rgba(7,11,17,0.98)');
    plate.addColorStop(1, 'rgba(9,14,21,0.90)');
    context.fillStyle = plate;
    context.fillRect(0, 0, FIELD.width, HUD);
    context.fillStyle = PALETTE.hudLine;
    context.fillRect(0, HUD - 1, FIELD.width, 1);
    context.fillStyle = 'rgba(255,203,99,0.30)';
    context.fillRect(0, HUD - 1, 210, 1);

    // Title block.
    spacedText(context, type, 'THE AURUM GALLERY', 28, 26, 19, PALETTE.text, 3.4, 'left', 700);
    spacedText(context, type, 'NIGHT SHIFT  ·  ONE STONE', 28, 44, 9, 'rgba(255,203,99,0.62)', 2.2, 'left', 600);

    drawAlarmMeter(world.alarm, 28, 66, 452, 14);
    drawObjective(world);
    drawLootChip(world, 520, 22);

    drawToolPips(world.thief, 742, 44);
    drawGetawayClock(world.alarm, 990, 46);

    // A stance readout, because the stance is a cost the player must feel.
    const stance = STANCE[world.thief.stance];
    const stanceName = world.thief.stance.toUpperCase();
    const noisePips = Math.round(stance.noise * 5);
    spacedText(context, type, 'STANCE', 742, 16, 9, PALETTE.muted, 1.8, 'left', 700);
    type(stanceName, 800, 16, 12, WORLD_STANCE_COLOUR(world.thief.stance), 'left', 700);
    for (let index = 0; index < 5; index += 1) {
      context.fillStyle = index < noisePips ? 'rgba(200,225,245,0.75)' : 'rgba(200,225,245,0.14)';
      context.fillRect(858 + index * 7, 12, 4, 8);
    }
    context.restore();
  }

  function WORLD_STANCE_COLOUR(stance) {
    if (stance === 'sprint') return '#ffcb63';
    if (stance === 'crouch') return '#63e6cd';
    return '#c6d8e6';
  }

  /** The thin footer: controls and the seed, in the 20 pixels under the room. */
  function drawFooter(world) {
    context.fillStyle = 'rgba(7,11,17,0.98)';
    context.fillRect(0, 700, FIELD.width, 20);
    spacedText(context, type, 'WASD MOVE   ·   SHIFT SPRINT   ·   CTRL CROUCH   ·   E TAKE   ·   Q THROW   ·   P PAUSE   ·   R RESTART', 28, 710, 9, 'rgba(125,146,168,0.75)', 1.6, 'left', 600);
    spacedText(context, type, `SEED ${world.seed}`, 1252, 710, 9, 'rgba(125,146,168,0.5)', 1.6, 'right', 600);
  }

  // ---------------------------------------------------------------- screens

  function drawTitle(world) {
    context.fillStyle = 'rgba(4,7,12,0.72)';
    context.fillRect(0, HUD, FIELD.width, FIELD.height - HUD);
    const panelW = 700;
    const panelH = 330;
    const px = (FIELD.width - panelW) / 2;
    const py = 190;
    context.fillStyle = PALETTE.panel;
    roundRect(context, px, py, panelW, panelH, 4);
    context.fill();
    context.strokeStyle = 'rgba(255,203,99,0.34)';
    context.lineWidth = 1.2;
    roundRect(context, px, py, panelW, panelH, 4);
    context.stroke();

    spacedText(context, type, 'THE AURUM GALLERY', FIELD.width / 2, py + 74, 44, PALETTE.text, 7, 'center', 800);
    spacedText(context, type, 'A ONE-STONE NIGHT JOB', FIELD.width / 2, py + 112, 11, 'rgba(255,203,99,0.75)', 4.2, 'center', 600);
    type('The Sunstone sits in a case behind three ways in.', FIELD.width / 2, py + 156, 15, PALETTE.muted, 'center', 500);
    type('Two noisemakers, one dark pocket, and forty-two seconds to the hatch.', FIELD.width / 2, py + 180, 15, PALETTE.muted, 'center', 500);
    type('WASD walk  ·  Shift sprint  ·  Ctrl crouch  ·  E take  ·  Q throw', FIELD.width / 2, py + 224, 13, 'rgba(200,225,245,0.72)', 'center', 500);
    spacedText(context, type, 'PRESS SPACE OR CLICK TO BEGIN', FIELD.width / 2, py + 282, 15, PALETTE.goldText, 3.2, 'center', 700);
  }

  function drawCaughtPanel() {
    // A compact card in the bottom right: the room, its cones and where you were caught all stay
    // on screen, because the fair "caught" moment is one you should be able to read afterwards.
    const panelW = 348;
    const panelH = 176;
    const px = FIELD.width - panelW - 24;
    const py = FIELD.height - panelH - 30;
    context.fillStyle = 'rgba(28,6,10,0.93)';
    roundRect(context, px, py, panelW, panelH, 5);
    context.fill();
    context.strokeStyle = 'rgba(255,47,74,0.62)';
    context.lineWidth = 1.4;
    roundRect(context, px, py, panelW, panelH, 5);
    context.stroke();
    context.fillStyle = 'rgba(255,47,74,0.85)';
    context.fillRect(px, py, 3, panelH);

    spacedText(context, type, 'THE ALARM BITES', px + 24, py + 38, 20, '#ffe3e7', 3, 'left', 800);
    type('A cone found you and held.', px + 24, py + 66, 12, 'rgba(255,200,208,0.82)', 'left', 500);
    type('Crouch in the dark, break the line, and', px + 24, py + 86, 12, 'rgba(255,200,208,0.82)', 'left', 500);
    type('throw a noisemaker to pull a patrol off.', px + 24, py + 106, 12, 'rgba(255,200,208,0.82)', 'left', 500);
    spacedText(context, type, 'R  TRY THE NIGHT AGAIN', px + 24, py + 148, 10, '#ffcb63', 2, 'left', 700);
  }

  function drawGetawayPanel(world, score) {
    // The same compact card, so the hatch, the room and the clock that earned the escape stay in
    // frame behind it. `world` is kept for the panel's own footline hint.
    const panelW = 386;
    const panelH = 246;
    const px = FIELD.width - panelW - 24;
    const py = FIELD.height - panelH - 30;
    context.fillStyle = 'rgba(6,22,22,0.93)';
    roundRect(context, px, py, panelW, panelH, 5);
    context.fill();
    context.strokeStyle = 'rgba(99,230,205,0.55)';
    context.lineWidth = 1.4;
    roundRect(context, px, py, panelW, panelH, 5);
    context.stroke();
    context.fillStyle = 'rgba(99,230,205,0.85)';
    context.fillRect(px, py, 3, panelH);

    spacedText(context, type, 'CLEAN GETAWAY', px + 24, py + 36, 21, '#d8fff8', 3.4, 'left', 800);
    type('The hatch shuts behind you.', px + 24, py + 62, 12, 'rgba(200,240,244,0.72)', 'left', 500);

    const rows = [
      ['Sunstone', score.loot],
      ['Seconds to spare', score.timeLeft],
      ['Alarm left on the meter', score.calm],
      ['Noisemakers unthrown', score.tools],
      ['Never spotted', score.unseen],
    ];
    rows.forEach(([label, value], index) => {
      const y = py + 96 + index * 20;
      type(label, px + 24, y, 12, 'rgba(206,232,240,0.72)', 'left', 500);
      type(String(value), px + panelW - 24, y, 12, '#ffe0a4', 'right', 700);
    });
    context.fillStyle = 'rgba(99,230,205,0.22)';
    context.fillRect(px + 24, py + 196, panelW - 48, 1);
    type('TOTAL', px + 24, py + 218, 12, 'rgba(206,232,240,0.8)', 'left', 700);
    type(String(score.total), px + panelW - 24, py + 216, 22, PALETTE.goldText, 'right', 800);
  }

  function drawPausedPanel() {
    context.fillStyle = 'rgba(4,7,12,0.55)';
    context.fillRect(0, HUD, FIELD.width, FIELD.height - HUD);
    spacedText(context, type, 'PAUSED', FIELD.width / 2, 380, 34, PALETTE.text, 6, 'center', 800);
    type('Press P to go back in.', FIELD.width / 2, 420, 14, PALETTE.muted, 'center', 500);
  }

  // ---------------------------------------------------------------- the frame

  /**
   * Paint one frame: the room, the cones, the actors, the overlays and the HUD, then a panel for
   * whichever screen the game is on.
   */
  function draw(scene) {
    const { world, screen, aim, score } = scene;
    const level = world.level;
    const time = world.time;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.page;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    context.save();
    context.beginPath();
    context.rect(0, 0, FIELD.width, FIELD.height);
    context.clip();

    drawFloor(level);
    drawShadowPools(level, time);
    drawVault(level, time, world.thief.carrying);
    drawDucts(level);
    drawExit(level, world.alarm, time);
    drawPaintings(level);
    drawWalls(level);
    drawCover(level);

    // Cones under the actors so a body always reads on top of its own light.
    for (const camera of world.cameras) {
      const sighting = world.sightings.find((entry) => entry.source === camera);
      drawCameraCone(camera, sighting ? sighting.pressure : 0, time, level);
    }
    for (const guard of world.guards) {
      const sighting = world.sightings.find((entry) => entry.source === guard);
      drawGuardCone(guard, sighting ? sighting.pressure : 0, time, level);
    }

    drawFootSteps(world.thief);
    drawNoisemakers(world, time);
    if (screen === SCREEN_PLAY) drawAim(world, aim);
    for (const camera of world.cameras) drawCamera(camera, time);
    for (const guard of world.guards) {
      const sees = world.sightings.some((entry) => entry.source === guard);
      drawGuard(guard, sees, time);
    }
    drawThief(world.thief, world.alarm, time);
    drawSightLines(world);

    drawVignette(world.alarm, time);
    drawSpottedFlash(world, time);

    context.restore();
    drawHud(world, aim);
    drawFooter(world);

    if (screen === SCREEN_TITLE) drawTitle(world);
    else if (screen === SCREEN_PAUSED) drawPausedPanel();
    else if (screen === SCREEN_CAUGHT) drawCaughtPanel(world);
    else if (screen === SCREEN_GETAWAY) drawGetawayPanel(world, score ?? { total: 0, loot: 0, timeLeft: 0, calm: 0, tools: 0, unseen: 0 });
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, resize, toRoomPoint };
}
