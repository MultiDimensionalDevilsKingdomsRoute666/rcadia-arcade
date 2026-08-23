import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadGLB } from './cabinet.js';
import { radialTexture } from './xrp.js';

/**
 * The lounge furniture — pool table and beer pong.
 *
 * Both arrive as untextured flat-colour models, which is the same gift the
 * cabinets were: every material slot is a channel to re-theme rather than baked
 * art to fight. Neither is standing at a size the room can use as downloaded, so
 * both get normalised by height — a table is recognisable by standing at table
 * height far more than by being exactly eight feet long, and the beer pong model
 * in particular has proportions that no amount of uniform scaling will make
 * dimensionally correct.
 */

const RECIPES = {
  /** Pool: keep the ball colours, they are the only saturated thing in the model. */
  pool: {
    // K05 is the flat magenta that covers the playing surface — the felt, not a
    // ball, despite reading like one in the material list.
    felt: { match: /k05|g17/i, color: 0x3a1d6e, rough: 0.96, metal: 0.0, glow: 0x25123f, glowI: 0.55 },
    rails: [
      { match: /l21|m09|009/i, color: 0x14101f, rough: 0.42, metal: 0.35 },
      { match: /m00|front|000/i, color: 0xcfc8e4, rough: 0.28, metal: 0.1 },
    ],
    keep: /a06|b01|d01|i01|j16/i,         // the numbered balls
  },
  /** Beer pong: red cups stay red, everything else goes dark and neon-edged. */
  beerpong: {
    felt: { match: /mat11/i, color: 0x1a1230, rough: 0.6, metal: 0.2, glow: 0x2a1c55, glowI: 0.5 },
    rails: [
      { match: /mat23/i, color: 0x0d0b14, rough: 0.55, metal: 0.2 },
      { match: /mat21/i, color: 0xf2eefc, rough: 0.35, metal: 0.05 },
    ],
    keep: /mat8/i,
  },
};

/**
 * Load, normalise, re-theme and light one prop.
 *
 * `height` is what actually gets matched, not length — see the note above.
 */
export async function rigProp(url, kind, { height = 0.80, pos = [0, 0, 0], yaw = 0, glow = '#00c7fe' } = {}) {
  const gltf = await loadGLB(url);
  const root = gltf.scene.clone(true);
  const recipe = RECIPES[kind] || RECIPES.pool;

  root.updateWorldMatrix(true, true);
  let box = new THREE.Box3().setFromObject(root);
  root.scale.multiplyScalar(height / (box.max.y - box.min.y));
  root.updateWorldMatrix(true, true);
  box = new THREE.Box3().setFromObject(root);
  root.position.x -= (box.max.x + box.min.x) / 2;
  root.position.z -= (box.max.z + box.min.z) / 2;
  root.position.y -= box.min.y;

  const cache = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const swap = mats.map((m) => {
      if (!m) return m;
      const name = m.name || '';
      if (recipe.keep && recipe.keep.test(name)) {
        // A ball keeps its hue but gains a little sheen, so it catches the neon.
        if (!cache.has(name)) {
          cache.set(name, new THREE.MeshStandardMaterial({
            name, color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
            roughness: 0.24, metalness: 0.06,
          }));
        }
        return cache.get(name);
      }
      const rule = [recipe.felt, ...recipe.rails].find((r) => r.match.test(name));
      const key = rule ? rule.match.source : '__body';
      if (!cache.has(key)) {
        cache.set(key, new THREE.MeshStandardMaterial({
          name: key,
          color: rule ? rule.color : 0x191426,
          roughness: rule ? rule.rough : 0.5,
          metalness: rule ? rule.metal : 0.3,
          emissive: new THREE.Color(rule && rule.glow ? rule.glow : 0x000000),
          emissiveIntensity: rule && rule.glow ? rule.glowI : 0,
        }));
      }
      return cache.get(key);
    });
    o.material = Array.isArray(o.material) ? swap : swap[0];
  });

  const group = new THREE.Group();
  group.name = `prop-${kind}`;
  group.add(root);

  root.updateWorldMatrix(true, true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());

  // ---- under-glow: a neon outline at the base plus a pool on the floor -----
  // Tuck the tube just under the top edge so it reads as under-rail lighting.
  // Down at shin height it drew a rectangle on the carpet with the legs poking
  // through it, which looked like a floor marking rather than part of the table.
  const c = new THREE.Color(glow);
  const hw = size.x / 2 - 0.012, hd = size.z / 2 - 0.012, y = height - 0.085;
  const rail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-hw, y, -hd), new THREE.Vector3(hw, y, -hd),
    new THREE.Vector3(hw, y, hd), new THREE.Vector3(-hw, y, hd),
  ], true, 'catmullrom', 0);
  group.add(new THREE.Mesh(
    new THREE.TubeGeometry(rail, 64, 0.016, 5, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(c.r * 1.9, c.g * 1.9, c.b * 1.9), toneMapped: false })
  ));

  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 2.2, size.z * 2.6),
    new THREE.MeshBasicMaterial({
      map: radialTexture(glow, { power: 2.4 }), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.24, toneMapped: false,
    })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.016;
  pool.renderOrder = 2;
  group.add(pool);

  group.position.set(pos[0], pos[1], pos[2]);
  group.rotation.y = yaw;
  group.userData.size = size;
  group.userData.blocker = {
    cx: pos[0], cz: pos[2],
    hw: (size.x / 2) * Math.abs(Math.cos(yaw)) + (size.z / 2) * Math.abs(Math.sin(yaw)) + 0.1,
    hd: (size.z / 2) * Math.abs(Math.cos(yaw)) + (size.x / 2) * Math.abs(Math.sin(yaw)) + 0.1,
  };
  return group;
}

/**
 * A few crates to break up the lounge floor. Cheap, merged, and they stop the
 * corner reading as two tables floating in an empty box.
 */
export function loungeDressing() {
  const g = new THREE.Group();
  g.name = 'dressing';
  const spots = [
    [-12.2, 0, 7.4, 0.55, 0.3], [-11.6, 0, 6.2, 0.42, -0.4],
    [-12.4, 0, 4.4, 0.5, 0.15], [-4.4, 0, 8.9, 0.46, 0.6],
  ];
  const boxes = spots.map(([x, , z, s, r]) => {
    const geo = new THREE.BoxGeometry(s, s, s);
    geo.rotateY(r);
    geo.translate(x, s / 2, z);
    return geo;
  });
  const crates = new THREE.Mesh(mergeGeometries(boxes, false),
    new THREE.MeshStandardMaterial({ color: 0x1c1630, roughness: 0.72, metalness: 0.15 }));
  g.add(crates);

  // A square torus does not line up with a box — its corners sit at the radius
  // and its edges pull inward, so the outline floated as a diamond above the
  // crate. Four thin bars laid on the top face land where the edges actually are.
  const edges = [];
  spots.forEach(([x, , z, s, r]) => {
    const t = 0.014, half = s / 2;
    [[0, -half], [0, half]].forEach(([dx, dz]) => {
      const b = new THREE.BoxGeometry(s, t, t);
      b.translate(dx, 0, dz);
      b.rotateY(r);
      b.translate(x, s + t / 2, z);
      edges.push(b);
    });
    [[-half, 0], [half, 0]].forEach(([dx, dz]) => {
      const b = new THREE.BoxGeometry(t, t, s);
      b.translate(dx, 0, dz);
      b.rotateY(r);
      b.translate(x, s + t / 2, z);
      edges.push(b);
    });
  });
  g.userData.blockers = spots.map(([x, , z, s]) => ({ cx: x, cz: z, hw: s * 0.8, hd: s * 0.8 }));
  return g;
}
