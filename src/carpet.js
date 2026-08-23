import * as THREE from 'three';
import { drawXrpMark } from './xrp.js';

/**
 * Every surface texture in the room, generated at load time. Nothing here is a
 * file on disk: an arcade's look is scatter, noise and neon, all of which a
 * canvas produces more cheaply than a download — and it means the palette is a
 * parameter rather than something baked into an image.
 */

export const NEON = ['#ff17c3', '#00c7fe', '#736eb0', '#f37e3e', '#ffd84d', '#5cff9d'];

/** Deterministic PRNG, so a rebuild renders the identical room and screenshots diff cleanly. */
export function rng(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = true, repeat = [1, 1], aniso = 16 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}

/**
 * Derive a normal map from a texture's own luminance.
 *
 * A Sobel gradient is not physically the same thing as a real height field, but
 * for carpet pile and panel grain the eye only wants *some* break-up under
 * grazing light, and this gets it for free from artwork that already exists.
 */
function normalFrom(src, strength = 2.0) {
  const w = src.width, h = src.height;
  const s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = (s[i * 4] * 0.299 + s[i * 4 + 1] * 0.587 + s[i * 4 + 2] * 0.114) / 255;
  }
  const at = (x, y) => lum[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
               - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
               - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      const nx = dx * strength, ny = dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      img.data[i]     = (nx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Fine grain over the whole canvas. Kills the flat-CG look on large surfaces. */
function grain(ctx, w, h, rand, amount = 0.05) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 255 * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Draw once, then again for every edge the shape overlaps, so the tile is
 * seamless. Without this every confetti mark gets guillotined at the seam and
 * the repeat becomes visible from across the room.
 */
function wrapped(ctx, w, h, x, y, r, draw) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const px = x + ox * w, py = y + oy * h;
      if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue;
      draw(px, py);
    }
  }
}

/**
 * The arcade carpet. Black ground, chaotic neon confetti — the exact visual
 * language of every mall arcade floor since about 1988 — with small XRP marks
 * hidden among the shapes.
 */
export function makeCarpet({ size = 1024, repeat = [9, 7], seed = 7 } = {}) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rand = rng(seed);

  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#0a0616');
  bg.addColorStop(0.5, '#120a24');
  bg.addColorStop(1, '#080513');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const pick = () => NEON[(rand() * NEON.length) | 0];
  const S = size / 1024;

  // long confetti dashes, the base layer of the pattern
  for (let i = 0; i < 260; i++) {
    const x = rand() * size, y = rand() * size;
    const len = (18 + rand() * 60) * S, ang = rand() * Math.PI * 2;
    const col = pick();
    wrapped(ctx, size, size, x, y, len, (px, py) => {
      ctx.save();
      ctx.translate(px, py); ctx.rotate(ang);
      ctx.globalAlpha = 0.40 + rand() * 0.34;
      ctx.strokeStyle = col;
      ctx.lineWidth = (3 + rand() * 6) * S;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
      ctx.restore();
    });
  }

  // triangles and chevrons
  for (let i = 0; i < 90; i++) {
    const x = rand() * size, y = rand() * size;
    const r = (10 + rand() * 26) * S, ang = rand() * Math.PI * 2;
    const col = pick(), filled = rand() > 0.45;
    wrapped(ctx, size, size, x, y, r * 1.5, (px, py) => {
      ctx.save();
      ctx.translate(px, py); ctx.rotate(ang);
      ctx.globalAlpha = 0.42 + rand() * 0.30;
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(r * 0.9, r * 0.7); ctx.lineTo(-r * 0.9, r * 0.7);
      ctx.closePath();
      if (filled) { ctx.fillStyle = col; ctx.fill(); }
      else { ctx.strokeStyle = col; ctx.lineWidth = 4 * S; ctx.stroke(); }
      ctx.restore();
    });
  }

  // rings and dots
  for (let i = 0; i < 150; i++) {
    const x = rand() * size, y = rand() * size;
    const r = (4 + rand() * 20) * S;
    const col = pick(), ring = rand() > 0.5;
    wrapped(ctx, size, size, x, y, r * 1.6, (px, py) => {
      ctx.save();
      ctx.globalAlpha = 0.40 + rand() * 0.32;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
      if (ring) { ctx.strokeStyle = col; ctx.lineWidth = 4 * S; ctx.stroke(); }
      else { ctx.fillStyle = col; ctx.fill(); }
      ctx.restore();
    });
  }

  // squiggles — the signature arcade-carpet element
  for (let i = 0; i < 55; i++) {
    const x = rand() * size, y = rand() * size;
    const w = (40 + rand() * 90) * S, ang = rand() * Math.PI * 2, col = pick();
    wrapped(ctx, size, size, x, y, w, (px, py) => {
      ctx.save();
      ctx.translate(px, py); ctx.rotate(ang);
      ctx.globalAlpha = 0.44 + rand() * 0.30;
      ctx.strokeStyle = col;
      ctx.lineWidth = (4 + rand() * 4) * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      for (let k = 0; k <= 4; k++) {
        ctx.quadraticCurveTo(
          -w / 2 + (k + 0.5) * (w / 5), (k % 2 ? -1 : 1) * w * 0.16,
          -w / 2 + (k + 1) * (w / 5), 0
        );
      }
      ctx.stroke();
      ctx.restore();
    });
  }

  // the easter egg: XRP marks scattered in with everything else
  for (let i = 0; i < 26; i++) {
    const x = rand() * size, y = rand() * size;
    const r = (16 + rand() * 22) * S, ang = rand() * Math.PI * 2;
    const col = rand() > 0.5 ? '#00c7fe' : '#ff17c3';
    wrapped(ctx, size, size, x, y, r, (px, py) =>
      drawXrpMark(ctx, px, py, r * 2, col, { rotate: ang, alpha: 0.38 + rand() * 0.22 }));
  }

  grain(ctx, size, size, rand, 0.09);

  const map = tex(c, { repeat });
  const normalMap = tex(normalFrom(c, 1.4), { srgb: false, repeat });
  return { map, normalMap, canvas: c };
}

/** Dark ribbed wall panelling. Vertical ribs give the neon strips something to rake across. */
export function makeWall({ size = 1024, repeat = [6, 1], seed = 21,
  bands = [[0.093, '#ff17c3', 0.55], [0.965, '#00c7fe', 0.5]] } = {}) {
  const c = canvas(size, size / 2);
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  const h = c.height;

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#07060e');
  g.addColorStop(0.55, '#151022');
  g.addColorStop(1, '#0b0813');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, h);

  const ribs = 32;
  for (let i = 0; i < ribs; i++) {
    const x = (i / ribs) * size;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#1d1730';
    ctx.fillRect(x, 0, size / ribs * 0.16, h);
    ctx.fillStyle = '#050409';
    ctx.fillRect(x + size / ribs * 0.16, 0, size / ribs * 0.06, h);
  }
  ctx.globalAlpha = 1;

  // horizontal seam where panels meet
  ctx.fillStyle = '#04030a';
  ctx.fillRect(0, h * 0.62, size, 3);

  grain(ctx, size, h, rand, 0.12);

  // Where the tube runs sit, the wall behind them should carry a bloom of their
  // colour. The tubes are MeshBasicMaterial and emit no actual light, so the
  // wash is painted into an emissive map at the heights the runs occupy —
  // `bands` are fractions of wall height, matching buildNeon().
  const e = canvas(size, h);
  const ectx = e.getContext('2d');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, size, h);
  bands.forEach(([frac, color, strength]) => {
    const y = (1 - frac) * h;
    const g2 = ectx.createLinearGradient(0, y - h * 0.16, 0, y + h * 0.16);
    g2.addColorStop(0, 'transparent');
    g2.addColorStop(0.5, color);
    g2.addColorStop(1, 'transparent');
    ectx.globalAlpha = strength;
    ectx.fillStyle = g2;
    ectx.fillRect(0, y - h * 0.16, size, h * 0.32);
  });
  ectx.globalAlpha = 1;

  const map = tex(c, { repeat });
  const normalMap = tex(normalFrom(c, 1.1), { srgb: false, repeat });
  const emissiveMap = tex(e, { repeat });
  return { map, normalMap, emissiveMap };
}

/**
 * The atrium's polished terrazzo, with the XRP mark inlaid at its centre.
 * Rendered as one disc-sized texture rather than a tile, so the inlay lands
 * exactly once and exactly centred.
 */
export function makeTerrazzo({ size = 1024, seed = 99, inlay = 0.5 } = {}) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rand = rng(seed);

  ctx.fillStyle = '#0c0a16';
  ctx.fillRect(0, 0, size, size);

  // speckle
  for (let i = 0; i < 5200; i++) {
    const x = rand() * size, y = rand() * size, r = 1 + rand() * 3.4;
    ctx.globalAlpha = 0.10 + rand() * 0.30;
    ctx.fillStyle = rand() > 0.72 ? NEON[(rand() * NEON.length) | 0] : '#3a3352';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // concentric rings converging on the mark
  for (let i = 1; i <= 5; i++) {
    ctx.strokeStyle = i % 2 ? '#00c7fe' : '#ff17c3';
    ctx.globalAlpha = 0.10 + i * 0.03;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size * (0.20 + i * 0.055), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  drawXrpMark(ctx, size / 2, size / 2, size * inlay, '#bfe9ff', { alpha: 0.95 });

  grain(ctx, size, size, rand, 0.05);

  // A second copy holding only the inlay drives the emissive channel, so the
  // mark glows out of the floor while the terrazzo around it stays unlit.
  const e = canvas(size);
  const ectx = e.getContext('2d');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, size, size);
  drawXrpMark(ectx, size / 2, size / 2, size * inlay, '#7fd4ff');
  for (let i = 1; i <= 5; i++) {
    ectx.strokeStyle = i % 2 ? '#00c7fe' : '#ff17c3';
    ectx.globalAlpha = 0.5;
    ectx.lineWidth = 3;
    ectx.beginPath(); ectx.arc(size / 2, size / 2, size * (0.20 + i * 0.055), 0, Math.PI * 2); ectx.stroke();
  }

  return { map: tex(c), emissiveMap: tex(e) };
}

/**
 * A tiny equirectangular sky standing in for the room's own light.
 *
 * Fed through PMREMGenerator it becomes scene.environment, which is what stops
 * every metal edge and glossy floor reading as flat black in a room lit almost
 * entirely by emissive surfaces.
 */
export function makeEnvCanvas({ w = 512, h = 256 } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.00, '#0a0818');   // ceiling
  g.addColorStop(0.42, '#1a1430');
  g.addColorStop(0.52, '#241a3d');   // the neon band at eye level
  g.addColorStop(1.00, '#050409');   // floor
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // smeared colour where the room's big emitters live
  const blobs = [
    [0.50, 0.50, '#00c7fe', 0.55], [0.16, 0.52, '#ff17c3', 0.45],
    [0.84, 0.52, '#ff17c3', 0.40], [0.34, 0.46, '#736eb0', 0.35],
    [0.68, 0.55, '#f37e3e', 0.28], [0.50, 0.18, '#3a2f66', 0.40],
  ];
  blobs.forEach(([x, y, col, a]) => {
    const r = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, w * 0.22);
    r.addColorStop(0, col); r.addColorStop(1, 'transparent');
    ctx.globalAlpha = a;
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, w, h);
  });
  ctx.globalAlpha = 1;
  return c;
}
