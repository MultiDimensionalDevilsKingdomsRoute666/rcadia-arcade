import * as THREE from 'three';

/**
 * A grid of canvas cells behind one texture.
 *
 * Twenty-three cabinets want twenty-three attract screens, twenty-three marquees
 * and forty-six side panels. Given a texture each that is ninety-two textures and
 * ninety-two draw calls; packed into three atlases it is three of each, and the
 * quads that sample them merge into single meshes.
 *
 * Cells are addressed by index. `uv(i)` hands back the offset/scale pair that maps
 * a quad's local 0..1 UV into its cell, which is baked into merged geometry as a
 * vec4 attribute rather than a uniform — that is what lets one mesh carry many
 * different pictures.
 */
export class Atlas {
  constructor(cellW, cellH, count, { max = 2048, name = 'atlas' } = {}) {
    this.cellW = cellW;
    this.cellH = cellH;
    this.count = count;
    this.name = name;

    this.cols = Math.max(1, Math.floor(max / cellW));
    this.rows = Math.ceil(count / this.cols);
    if (this.rows * cellH > max) {
      throw new Error(`${name}: ${count} cells of ${cellW}x${cellH} exceed ${max}px`);
    }

    this.w = pot(this.cols * cellW);
    this.h = pot(this.rows * cellH);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.w, this.h);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    // Cells butt directly against each other, so bilinear filtering at a cell
    // edge would bleed the neighbour in. Clamp + no mipmaps on the atlases that
    // matter most; the small waste is worth never seeing another game's art
    // smeared along a bezel.
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
  }

  /** Pixel rect of cell `i` in the atlas canvas. */
  rect(i) {
    const col = i % this.cols;
    const row = (i / this.cols) | 0;
    return { x: col * this.cellW, y: row * this.cellH, w: this.cellW, h: this.cellH };
  }

  /**
   * Draw into cell `i` with the origin moved to its top-left and a clip applied,
   * so a drawing routine can work in plain 0..cellW coordinates and cannot spill
   * into its neighbours.
   */
  draw(i, fn) {
    const r = this.rect(i);
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.translate(r.x, r.y);
    fn(ctx, r.w, r.h);
    ctx.restore();
    this.dirty = true;
  }

  /**
   * offset/scale mapping a 0..1 quad UV into cell `i`.
   *
   * Textures upload flipped (flipY), so canvas row 0 is at v=1 — hence the
   * inverted V. Getting this wrong shows up as art from the wrong game, upside
   * down, which is at least an unmistakable symptom.
   */
  uv(i) {
    const r = this.rect(i);
    return [r.x / this.w, 1 - (r.y + r.h) / this.h, r.w / this.w, r.h / this.h];
  }

  flush() {
    if (this.dirty) { this.texture.needsUpdate = true; this.dirty = false; }
  }
}

function pot(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Fit an image to fill a cell, cropping the overflow.
 *
 * RCADIA's game art is whatever each submitter uploaded — 1895x1063 next to
 * 667x666 next to nothing at all — so nothing here may assume an aspect ratio.
 */
export function coverFit(ctx, img, x, y, w, h) {
  if (!img) return false;
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s, ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  return true;
}

/** Same, but letterboxed — nothing cropped, gaps left empty. */
export function containFit(ctx, img, x, y, w, h) {
  if (!img) return false;
  const s = Math.min(w / img.width, h / img.height);
  const iw = img.width * s, ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  return true;
}
