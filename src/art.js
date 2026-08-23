import * as THREE from 'three';

const PINK = '#ff17c3';
const BLUE = '#00c7fe';
const PURPLE = '#736eb0';
const ORANGE = '#f37e3e';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

export function loadTexture(url) {
  return new Promise((res, rej) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      res(t);
    }, undefined, rej);
  });
}

function neonText(ctx, text, x, y, size, color, glow = 18) {
  ctx.font = `900 ${size}px Orbitron, "Arial Black", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = glow * 2.2;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

/** Backlit marquee: the strip of art above the screen with the game name. */
export function makeMarquee(title, { accent = PINK, accent2 = BLUE } = {}) {
  const W = 2048, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1a0b2e');
  g.addColorStop(0.5, '#2b0f47');
  g.addColorStop(1, '#0d0c1c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // perspective grid, because it is 1986 forever
  ctx.strokeStyle = accent2;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 2;
  for (let i = -12; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * 26, H);
    ctx.lineTo(W / 2 + i * 210, 0);
    ctx.stroke();
  }
  for (let y = 0; y < 6; y++) {
    const yy = H - Math.pow(y / 6, 2.1) * H;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const t = (title || 'RCADIA').toUpperCase();
  const size = Math.min(150, (W * 0.86) / Math.max(6, t.length) * 1.55);
  neonText(ctx, t, W / 2, H / 2 + 6, size, accent, 26);

  ctx.strokeStyle = accent2;
  ctx.lineWidth = 10;
  ctx.shadowColor = accent2; ctx.shadowBlur = 24;
  ctx.strokeRect(14, 14, W - 28, H - 28);
  ctx.shadowBlur = 0;

  return tex(c);
}

/** Side art: the big painted flank panel. */
export function makeSideArt(title, image, { accent = PINK, accent2 = BLUE } = {}) {
  const W = 768, H = 1024;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#150a24');
  g.addColorStop(0.45, '#2a0d3f');
  g.addColorStop(1, '#07060d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // sunburst
  ctx.save();
  ctx.translate(W / 2, H * 0.42);
  for (let i = 0; i < 24; i++) {
    ctx.rotate((Math.PI * 2) / 24);
    ctx.globalAlpha = i % 2 ? 0.06 : 0.12;
    ctx.fillStyle = i % 2 ? accent : accent2;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(900, -70); ctx.lineTo(900, 70); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  if (image) {
    const iw = W * 0.78;
    const ih = iw * (image.height / image.width);
    ctx.save();
    ctx.shadowColor = accent; ctx.shadowBlur = 40;
    ctx.drawImage(image, (W - iw) / 2, H * 0.30 - ih / 2, iw, ih);
    ctx.restore();
  }

  const t = (title || '').toUpperCase();
  neonText(ctx, t, W / 2, H * 0.66, Math.min(96, (W * 0.9) / Math.max(5, t.length) * 1.6), accent2, 22);
  neonText(ctx, 'RCADIA', W / 2, H * 0.88, 62, accent, 18);

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 8;
  ctx.strokeRect(18, 18, W - 36, H - 36);

  return tex(c);
}

/**
 * Attract mode. A live canvas the CRT shader samples — this is what a cabinet
 * shows before anyone walks up to it. Cheap enough to run 20+ at once because
 * it only repaints a few times a second.
 */
export function makeAttract(title, image, { accent = PINK, accent2 = BLUE, scores = [] } = {}) {
  const W = 512, H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const t = tex(c);
  let frame = 0;

  const rows = scores.length ? scores : [
    ['1ST', 'rN7f…8kQ', '128,400'],
    ['2ND', 'rPZy…Yj8j', ' 96,120'],
    ['3RD', 'r9QG…VLPW', ' 74,880'],
  ];

  function draw(time) {
    frame++;
    ctx.fillStyle = '#05040a';
    ctx.fillRect(0, 0, W, H);

    // starfield drift
    for (let i = 0; i < 70; i++) {
      const x = (i * 97.31) % W;
      const y = ((i * 53.7) + time * (18 + (i % 5) * 12)) % H;
      ctx.globalAlpha = 0.25 + 0.5 * ((i % 7) / 7);
      ctx.fillStyle = i % 3 ? accent2 : '#fff';
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;

    if (image) {
      const iw = W * 0.62;
      const ih = iw * (image.height / image.width);
      ctx.globalAlpha = 0.92;
      ctx.drawImage(image, (W - iw) / 2, H * 0.20 - ih / 2, iw, ih);
      ctx.globalAlpha = 1;
    }

    const name = (title || 'RCADIA').toUpperCase();
    neonText(ctx, name, W / 2, H * 0.40, Math.min(52, (W * 0.86) / Math.max(5, name.length) * 1.5), accent, 14);

    ctx.font = '700 20px Rajdhani, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = accent2;
    ctx.fillText('HIGH SCORES', W / 2, H * 0.52);

    ctx.font = '600 19px monospace';
    rows.slice(0, 3).forEach((r, i) => {
      ctx.fillStyle = i === 0 ? '#ffd84d' : '#cfd4ff';
      ctx.textAlign = 'left';
      ctx.fillText(r[0], W * 0.16, H * 0.585 + i * 30);
      ctx.fillText(r[1], W * 0.30, H * 0.585 + i * 30);
      ctx.textAlign = 'right';
      ctx.fillText(r[2], W * 0.84, H * 0.585 + i * 30);
    });

    // the blink
    if (Math.floor(time * 1.6) % 2 === 0) {
      ctx.textAlign = 'center';
      neonText(ctx, 'INSERT COIN', W / 2, H * 0.83, 34, '#ffd84d', 16);
    }
    ctx.font = '600 15px Rajdhani, monospace';
    ctx.fillStyle = accent2;
    ctx.globalAlpha = 0.75;
    ctx.textAlign = 'center';
    ctx.fillText('XRPL · RCADIA.XYZ', W / 2, H * 0.93);
    ctx.globalAlpha = 1;

    t.needsUpdate = true;
  }

  draw(0);
  return { texture: t, draw, get frame() { return frame; } };
}

export const PALETTE = { PINK, BLUE, PURPLE, ORANGE };

/* ------------------------------------------------------------------------- *
 * Atlas cell painters
 *
 * The room shares one canvas per art type, so these draw into an already
 * translated + clipped context in plain 0..w/0..h coordinates and never touch
 * the atlas's own geometry. Same artwork as the single-cabinet versions above,
 * parameterised by cell size instead of a fixed canvas.
 * ------------------------------------------------------------------------- */

/**
 * Something to show for a game with no usable art.
 *
 * RCADIA's OgImages are whatever each submitter uploaded, and at least one game
 * has none at all, so an empty bezel is a case that will happen. A generated
 * glyph tile beats a black hole in the middle of the row.
 */
export function paintFallback(ctx, w, h, { title = '', accent = PINK, accent2 = BLUE } = {}) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#180a2c');
  g.addColorStop(1, '#0a0716');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = accent2;
  ctx.globalAlpha = 0.30;
  ctx.lineWidth = Math.max(1, w / 340);
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(w / 2 + i * w * 0.03, h);
    ctx.lineTo(w / 2 + i * w * 0.30, h * 0.34);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const initials = (title || '??').split(/\s+/).map((s) => s[0]).join('').slice(0, 3).toUpperCase();
  neonText(ctx, initials, w / 2, h * 0.46, h * 0.30, accent, w / 26);
}

/** One attract screen cell. */
export function paintAttract(ctx, w, h, { title, image, accent = PINK, accent2 = BLUE, scores, time = 0 } = {}) {
  ctx.fillStyle = '#05040a';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 54; i++) {
    const x = (i * 97.31) % w;
    const y = ((i * 53.7) + time * (14 + (i % 5) * 10)) % h;
    ctx.globalAlpha = 0.22 + 0.5 * ((i % 7) / 7);
    ctx.fillStyle = i % 3 ? accent2 : '#fff';
    ctx.fillRect(x, y, Math.max(1, w / 220), Math.max(1, w / 220));
  }
  ctx.globalAlpha = 1;

  if (image) {
    const iw = w * 0.66;
    const ih = iw * (image.height / image.width);
    ctx.globalAlpha = 0.94;
    ctx.drawImage(image, (w - iw) / 2, h * 0.22 - ih / 2, iw, ih);
    ctx.globalAlpha = 1;
  } else {
    const initials = (title || '?').split(/\s+/).map((s) => s[0]).join('').slice(0, 3).toUpperCase();
    neonText(ctx, initials, w / 2, h * 0.20, h * 0.19, accent2, w / 30);
  }

  const name = (title || 'RCADIA').toUpperCase();
  neonText(ctx, name, w / 2, h * 0.42, Math.min(h * 0.10, (w * 0.88) / Math.max(5, name.length) * 1.5),
    accent, w / 34);

  ctx.font = `700 ${Math.round(h * 0.043)}px Rajdhani, monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = accent2;
  ctx.fillText('HIGH SCORES', w / 2, h * 0.535);

  const rows = (scores && scores.length ? scores : [
    ['1ST', 'rN7f…8kQ', '128,400'],
    ['2ND', 'rPZy…Yj8j', '96,120'],
    ['3RD', 'r9QG…VLPW', '74,880'],
  ]).slice(0, 3);
  ctx.font = `600 ${Math.round(h * 0.040)}px monospace`;
  rows.forEach((r, i) => {
    const y = h * 0.60 + i * h * 0.062;
    ctx.fillStyle = i === 0 ? '#ffd84d' : '#cfd4ff';
    ctx.textAlign = 'left';
    ctx.fillText(r[0], w * 0.14, y);
    ctx.fillText(r[1], w * 0.30, y);
    ctx.textAlign = 'right';
    ctx.fillText(r[2], w * 0.86, y);
  });

  if (Math.floor(time * 1.6) % 2 === 0) {
    ctx.textAlign = 'center';
    neonText(ctx, 'INSERT COIN', w / 2, h * 0.84, h * 0.072, '#ffd84d', w / 32);
  }
  ctx.font = `600 ${Math.round(h * 0.032)}px Rajdhani, monospace`;
  ctx.fillStyle = accent2;
  ctx.globalAlpha = 0.75;
  ctx.textAlign = 'center';
  ctx.fillText('XRPL · RCADIA.XYZ', w / 2, h * 0.935);
  ctx.globalAlpha = 1;
}

/** One marquee cell — the lit strip above the screen. */
export function paintMarquee(ctx, w, h, { title, accent = PINK, accent2 = BLUE } = {}) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1a0b2e');
  g.addColorStop(0.5, '#2b0f47');
  g.addColorStop(1, '#0d0c1c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = accent2;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = Math.max(1, w / 500);
  for (let i = -12; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(w / 2 + i * w * 0.013, h);
    ctx.lineTo(w / 2 + i * w * 0.102, 0);
    ctx.stroke();
  }
  for (let y = 0; y < 6; y++) {
    const yy = h - Math.pow(y / 6, 2.1) * h;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const t = (title || 'RCADIA').toUpperCase();
  neonText(ctx, t, w / 2, h * 0.53, Math.min(h * 0.62, (w * 0.88) / Math.max(6, t.length) * 1.55),
    accent, w / 70);

  ctx.strokeStyle = accent2;
  ctx.lineWidth = Math.max(2, w / 190);
  ctx.shadowColor = accent2; ctx.shadowBlur = w / 80;
  ctx.strokeRect(w * 0.008, h * 0.05, w * 0.984, h * 0.90);
  ctx.shadowBlur = 0;
}

/** One side-art cell — the painted flank panel. */
export function paintSide(ctx, w, h, { title, image, accent = PINK, accent2 = BLUE } = {}) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#150a24');
  g.addColorStop(0.45, '#2a0d3f');
  g.addColorStop(1, '#07060d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h * 0.40);
  for (let i = 0; i < 24; i++) {
    ctx.rotate((Math.PI * 2) / 24);
    ctx.globalAlpha = i % 2 ? 0.06 : 0.13;
    ctx.fillStyle = i % 2 ? accent : accent2;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(w * 1.6, -h * 0.07); ctx.lineTo(w * 1.6, h * 0.07);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  if (image) {
    const iw = w * 0.80;
    const ih = iw * (image.height / image.width);
    ctx.save();
    ctx.shadowColor = accent; ctx.shadowBlur = w / 18;
    ctx.drawImage(image, (w - iw) / 2, h * 0.30 - ih / 2, iw, ih);
    ctx.restore();
  }

  const t = (title || '').toUpperCase();
  neonText(ctx, t, w / 2, h * 0.66, Math.min(h * 0.095, (w * 0.90) / Math.max(5, t.length) * 1.6),
    accent2, w / 34);
  neonText(ctx, 'RCADIA', w / 2, h * 0.875, h * 0.058, accent, w / 42);

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = Math.max(2, w / 96);
  ctx.strokeRect(w * 0.024, h * 0.018, w * 0.952, h * 0.964);
  ctx.globalAlpha = 1;
}
