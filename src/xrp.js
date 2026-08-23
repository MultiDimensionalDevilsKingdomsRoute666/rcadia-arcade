import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

/**
 * The XRP mark, in the two forms the room needs it: extruded 3D geometry for the
 * hero sign, and a Path2D for stamping into canvas textures (floor inlay, carpet
 * confetti, cabinet coin doors).
 *
 * The source SVG is a black `<circle>` backdrop plus one white `<path>` holding
 * the X. We only ever want the X, and relying on SVGLoader's partial CSS support
 * to work out that `.st0` means white is a needless gamble — so the circle is
 * stripped from the markup before parsing and the fill is forced.
 */

const VIEWBOX = 2500;   // the source SVG's coordinate space, square

let cache = null;

function stripBackdrop(svgText) {
  return svgText.replace(/<circle\b[^>]*\/?>(?:<\/circle>)?/gi, '');
}

/** Every `d` string in the file, for Path2D use. */
function pathData(svgText) {
  return [...svgText.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
}

export async function loadXrp(url) {
  if (cache) return cache;
  const text = stripBackdrop(await (await fetch(url)).text());
  const data = new SVGLoader().parse(text);
  const shapes = [];
  data.paths.forEach((p) => shapes.push(...p.toShapes(true)));
  cache = { shapes, dStrings: pathData(text), viewBox: VIEWBOX };
  return cache;
}

/**
 * Extruded logo geometry, `height` metres tall, centred on the origin.
 *
 * SVG's Y axis points down. Mirroring to fix that would invert triangle winding
 * and turn the mesh inside out, so we rotate a half turn about X instead — same
 * visual result, handedness intact.
 */
export function xrpGeometry({ height = 3.4, depth = 0.14, bevel = 0.02 } = {}) {
  if (!cache) throw new Error('xrp: loadXrp() first');
  const geo = new THREE.ExtrudeGeometry(cache.shapes, {
    depth: depth / (height / VIEWBOX),      // extrude in SVG units, scaled later
    bevelEnabled: bevel > 0,
    bevelThickness: bevel / (height / VIEWBOX),
    bevelSize: bevel / (height / VIEWBOX),
    bevelSegments: 2,
    curveSegments: 12,
  });
  geo.rotateX(Math.PI);
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const s = height / (b.max.y - b.min.y);
  geo.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2);
  geo.scale(s, s, s);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

/**
 * Stamp the mark into a 2D canvas, `size` px wide, centred on (x, y).
 * Path2D speaks SVG path syntax natively, so the same `d` strings that drive the
 * 3D extrusion drive the textures — no second, drifting copy of the artwork.
 */
export function drawXrpMark(ctx, x, y, size, style, { rotate = 0, alpha = 1 } = {}) {
  if (!cache) return;
  const k = size / VIEWBOX;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  if (rotate) ctx.rotate(rotate);
  ctx.scale(k, k);
  ctx.translate(-VIEWBOX / 2, -VIEWBOX / 2);
  ctx.fillStyle = style;
  cache.dStrings.forEach((d) => ctx.fill(new Path2D(d)));
  ctx.restore();
}

/** The hero sign: emissive white core plus an additive halo card behind it. */
export function xrpHero({ height = 3.4, color = 0xdfefff, glow = 0x5fc4ff, intensity = 1.15 } = {}) {
  const group = new THREE.Group();

  const mesh = new THREE.Mesh(
    xrpGeometry({ height }),
    new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(glow),
      emissiveIntensity: intensity,
      roughness: 0.22,
      metalness: 0.55,
    })
  );
  mesh.name = 'xrp-hero';
  group.add(mesh);

  // A soft additive card sitting behind the mark. Bloom alone spreads light from
  // the glyph's edges; this puts an actual pool of colour in the air around it,
  // which is what makes a neon sign read as a light source and not a lit object.
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(height * 2.4, height * 2.4),
    new THREE.MeshBasicMaterial({
      map: radialTexture(glow),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.30,
      toneMapped: false,
    })
  );
  halo.position.z = -0.22;
  halo.renderOrder = -1;
  group.add(halo);

  group.userData.mesh = mesh;
  group.userData.halo = halo;
  return group;
}

/** Soft radial falloff sprite, reused for halos and floor light pools. */
export function radialTexture(color = 0xffffff, { size = 256, power = 2.2 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(color);
  const img = ctx.createImageData(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - half, y - half) / half;
      const a = Math.max(0, 1 - d) ** power;
      const i = (y * size + x) * 4;
      img.data[i] = col.r * 255;
      img.data[i + 1] = col.g * 255;
      img.data[i + 2] = col.b * 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
