import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeCrtMaterial } from './crt.js';

const loader = new GLTFLoader();
const DEG = Math.PI / 180;

/** Names/materials that mean "this is the screen" across the models we've tried. */
const SCREEN_HINTS = ['gamescreen', 'screen', 'videogame', 'monitor', 'display'];

export function loadGLB(url) {
  return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}

/**
 * Which way a mesh actually faces, in world space.
 *
 * Vertex normals lie: this cabinet pair alone includes one model whose screen
 * quad carries a normal pointing straight up. Taking the cross product of a real
 * triangle's edges gives the true plane, and `awayFrom` resolves the sign by
 * requiring the face to point out of the cabinet rather than into it.
 */
function worldNormal(mesh, awayFrom) {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const n = new THREE.Vector3();

  if (pos && pos.count >= 3) {
    // widest-spread triangle in the first few, so a degenerate one can't win
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();
    const tris = idx ? idx.count / 3 : pos.count / 3;
    let bestArea = 0;
    for (let t = 0; t < Math.min(tris, 8); t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      ab.subVectors(b, a); ac.subVectors(c, a);
      cross.crossVectors(ab, ac);
      const area = cross.lengthSq();
      if (area > bestArea) { bestArea = area; n.copy(cross); }
    }
  }
  if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
  n.normalize();

  // a screen points out of the cabinet, never into it
  if (awayFrom) {
    const centre = new THREE.Vector3();
    new THREE.Box3().setFromObject(mesh).getCenter(centre);
    if (n.dot(centre.sub(awayFrom)) < 0) n.negate();
  }
  return n;
}

function findScreen(root) {
  let best = null;
  root.traverse((o) => {
    if (!o.isMesh || best) return;
    const name = (o.name || '').toLowerCase();
    const mat = (o.material && o.material.name || '').toLowerCase();
    if (SCREEN_HINTS.some((h) => name.includes(h) || mat.includes(h))) best = o;
  });
  return best;
}

/**
 * Rewrite a screen quad's UVs from its own geometry.
 *
 * Downloaded cabinets carry whatever UVs their exporter felt like — this one
 * came out of obj2gltf with V inverted, and the next model will be wrong in
 * some other way. Projecting each vertex onto the screen's own right/up basis
 * gives a canonical full-quad mapping regardless, so art always lands upright
 * and unmirrored.
 */
function normalizeScreenUVs(mesh, normal) {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  if (!pos) return;

  mesh.updateWorldMatrix(true, false);
  const n = normal.clone().normalize();
  const worldUp = Math.abs(n.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  // (right, up, n) right-handed, with n pointing at the viewer
  const right = new THREE.Vector3().crossVectors(worldUp, n).normalize();
  const up = new THREE.Vector3().crossVectors(n, right).normalize();

  const v = new THREE.Vector3();
  const r = [], u = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    r.push(v.dot(right));
    u.push(v.dot(up));
  }
  const rmin = Math.min(...r), rmax = Math.max(...r);
  const umin = Math.min(...u), umax = Math.max(...u);
  const rd = rmax - rmin || 1, ud = umax - umin || 1;

  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (r[i] - rmin) / rd;          // u: 0 at viewer-left
    uv[i * 2 + 1] = (u[i] - umin) / ud;      // v: 1 at top (textures are flipY)
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.attributes.uv.needsUpdate = true;
}

/**
 * Fire a ray at the chassis and hand back where it lands, so decals can be
 * placed on any cabinet model without knowing its UVs or its proportions.
 * `from` is a world point, `dir` the direction to look in.
 */
function surfaceHit(targets, from, dir) {
  const rc = new THREE.Raycaster(from, dir.clone().normalize(), 0, 20);
  const hits = rc.intersectObjects(targets, true);
  return hits.length ? hits[0] : null;
}

/**
 * Build a lit, themed, art-bearing cabinet from a raw GLB scene.
 *
 * Returns handles the harness (and later the arcade floor) needs:
 *   group    – normalised: 1.8m tall, base on y=0, screen facing +Z
 *   screen   – the mesh whose material is the CRT
 *   dock     – world transform of the screen face, for parking a CSS3D iframe on it
 */
export function rigCabinet(gltfScene, opts = {}) {
  const {
    height = 1.8,
    accent = 0xff17c3,       // rcadia neon pink
    accent2 = 0x00c7fe,      // rcadia neon blue
    body = 0x241f31,
    screenTexture = null,
    screenAspect = 1,
    marqueeTexture = null,
    sideTexture = null,
    marqueeGlow = 1.6,
    emissive = { accentGlow: 2.0, trimGlow: 0.25 },
    screenLight = 8,
    marqueeLight = 10,
  } = opts;

  const group = new THREE.Group();
  const root = gltfScene.clone(true);
  group.add(root);

  const screen = findScreen(root);

  // ---- normalise orientation: screen must face +Z -------------------------
  if (screen) {
    root.updateWorldMatrix(true, true);
    const centre = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    const n = worldNormal(screen, centre);
    const yaw = Math.atan2(n.x, n.z);     // angle from +Z
    root.rotation.y -= yaw;
  }

  // ---- normalise scale + sit it on the floor, centred --------------------
  root.updateWorldMatrix(true, true);
  let box = new THREE.Box3().setFromObject(root);
  const s = height / (box.max.y - box.min.y);
  root.scale.multiplyScalar(s);
  root.updateWorldMatrix(true, true);
  box = new THREE.Box3().setFromObject(root);
  root.position.x -= (box.max.x + box.min.x) / 2;
  root.position.z -= (box.max.z + box.min.z) / 2;
  root.position.y -= box.min.y;
  root.updateWorldMatrix(true, true);
  box = new THREE.Box3().setFromObject(root);

  const size = box.getSize(new THREE.Vector3());

  // ---- re-theme the flat colour slots ------------------------------------
  // These models ship untextured flat materials, which is a gift: every
  // colour slot is a themable channel instead of baked-in art to fight.
  const slots = {};
  const chassis = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (o === screen) return;
    chassis.push(o);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => { if (m && m.name) slots[m.name] = m; });
  });

  // Colour-slot recipes, keyed by the lowercased material name the model ships
  // with. Anything unrecognised falls through to the dark body colour, so a new
  // cabinet drops in looking plausible before anyone hand-tunes it.
  const recipe = (accentCol, accent2Col) => ({
    darkergray: { color: body },
    darkgray:   { color: 0x2f2940 },
    gray:       { color: 0x2f2940 },
    black:      { color: 0x0d0b12 },
    white:      { color: 0x4a4560 },
    metal:      { color: 0x6e7b85, rough: 0.3, metal: 0.8 },
    blue:       { color: accent2Col, glow: accent2Col, intensity: emissive.trimGlow },
    red:        { color: accentCol,  glow: accentCol,  intensity: emissive.accentGlow },
    orange:     { color: accentCol,  glow: accentCol,  intensity: emissive.accentGlow },
    yellow:     { color: 0xffd84d,   glow: 0xffd84d,   intensity: emissive.accentGlow },
  });
  const RECIPES = recipe(accent, accent2);

  const themed = new Map();
  const themeFor = (mat) => {
    const key = (mat.name || '').toLowerCase();
    if (themed.has(key)) return themed.get(key);
    const r = RECIPES[key] || { color: body };
    const next = new THREE.MeshStandardMaterial({
      name: mat.name || 'body',
      color: r.color,
      roughness: r.rough ?? (r.glow ? 0.35 : 0.52),
      metalness: r.metal ?? (r.glow ? 0.0 : 0.15),
      emissive: new THREE.Color(r.glow || 0x000000),
      emissiveIntensity: r.glow ? (r.intensity ?? 1) : 0,
    });
    themed.set(key, next);
    return next;
  };

  chassis.forEach((o) => {
    o.material = Array.isArray(o.material)
      ? o.material.map((m) => (m ? themeFor(m) : m))
      : (o.material ? themeFor(o.material) : o.material);
  });

  // ---- the CRT ------------------------------------------------------------
  let crt = null;
  let dock = null;
  if (screen) {
    // the clone shares geometry with the cached gltf scene — give this cabinet
    // its own copy before rewriting UVs on it
    screen.geometry = screen.geometry.clone();
    normalizeScreenUVs(screen, worldNormal(screen, box.getCenter(new THREE.Vector3())));
    crt = makeCrtMaterial(screenTexture, { aspect: screenAspect, bright: opts.crtBright ?? 1.45 });
    screen.material = crt;
    screen.castShadow = false;

    // where the glass actually is, in world space — this is the anchor a
    // CSS3D iframe gets parked on when a player walks up and hits START.
    const sbox = new THREE.Box3().setFromObject(screen);
    const c = sbox.getCenter(new THREE.Vector3());
    const chassisCentre = box.getCenter(new THREE.Vector3());
    const ssize = sbox.getSize(new THREE.Vector3());
    dock = {
      position: c,
      normal: worldNormal(screen, chassisCentre),
      width: ssize.x,
      height: ssize.y,
      // tilt of the glass, derived from how far the face leans over its height
      tilt: Math.atan2(ssize.z, ssize.y),
    };

    // phosphor spill into the room
    const glow = new THREE.PointLight(0x8fd8ff, screenLight, 3.0, 1.9);
    glow.position.copy(c).add(dock.normal.clone().multiplyScalar(0.25));
    group.add(glow);
    group.userData.screenLight = glow;
  }

  // ---- decals: marquee + side art ----------------------------------------
  // Raycast onto the chassis so this works on any model, whatever its UVs.
  const decals = {};
  const addDecal = (key, from, dir, w, h, texture, emissiveArt, fallback) => {
    const hit = surfaceHit(chassis, from, dir);
    const point = hit ? hit.point : fallback;
    if (!point) return null;
    const mat = new THREE.MeshStandardMaterial({
      map: texture || null,
      color: texture ? 0xffffff : 0x101018,
      emissive: new THREE.Color(emissiveArt ? 0xffffff : 0x000000),
      emissiveMap: emissiveArt ? texture : null,
      emissiveIntensity: emissiveArt ? marqueeGlow : 0,
      roughness: 0.6,
      metalness: 0.0,
      transparent: true,
      toneMapped: !emissiveArt,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    plane.position.copy(point).add(dir.clone().normalize().multiplyScalar(-0.004));
    plane.lookAt(plane.position.clone().add(dir.clone().normalize().multiplyScalar(-1)));
    plane.name = key;
    group.add(plane);
    decals[key] = plane;
    return plane;
  };

  const front = box.max.z + 1;
  const topY = box.max.y;

  // marquee sits in the band above the screen
  const marqueeY = screen
    ? (new THREE.Box3().setFromObject(screen).max.y + topY) / 2
    : topY - size.y * 0.08;
  const marquee = addDecal(
    'marquee',
    new THREE.Vector3(0, marqueeY, front),
    new THREE.Vector3(0, 0, -1),
    size.x * 0.72, size.y * 0.085,
    marqueeTexture, true,
    new THREE.Vector3(0, marqueeY, box.max.z)
  );
  if (marquee) {
    const bar = new THREE.RectAreaLight(0xffffff, marqueeLight, size.x * 0.7, 0.06);
    bar.position.copy(marquee.position).add(new THREE.Vector3(0, -0.02, 0.06));
    bar.lookAt(marquee.position.x, marquee.position.y - 0.6, marquee.position.z + 0.4);
    group.add(bar);
    group.userData.marqueeLight = bar;
  }

  // side art, both flanks
  [1, -1].forEach((sgn) => {
    addDecal(
      sgn > 0 ? 'sideL' : 'sideR',
      new THREE.Vector3(sgn * (box.max.x + 1), size.y * 0.62, 0),
      new THREE.Vector3(-sgn, 0, 0),
      size.z * 0.52, size.y * 0.34,
      sideTexture, false,
      new THREE.Vector3(sgn * box.max.x, size.y * 0.62, 0)
    );
  });

  group.userData = {
    ...group.userData,
    screen, crt, dock, decals, size, box, themed, chassis,
  };
  return group;
}

/* ------------------------------------------------------------------------- *
 * Arcade-floor path
 *
 * `rigCabinet` above builds one cabinet as a live scene graph, which is right
 * for the tuning lab but wrong for a room: twenty-three of them is a few hundred
 * draw calls and forty-six lights.
 *
 * `chassisTemplate` instead returns raw geometry in cabinet-local space, already
 * normalised and sorted into the handful of roles the arcade cares about. The
 * floor builder bakes each slot's transform into a copy and merges the lot, so
 * every cabinet in the room costs six draws between them. They never move, so
 * merging beats instancing outright — and per-cabinet colour rides in as a
 * vertex attribute, which sidesteps the fact that three will not drive
 * `emissive` from `instanceColor`.
 * ------------------------------------------------------------------------- */

/**
 * Which visual role a material slot plays. Anything unrecognised is body, so an
 * unfamiliar chassis still lands looking like dark plastic rather than vanishing.
 *
 *   body    lit, dark, fixed colour
 *   panel   lit, lighter plastic — control decks and bezels
 *   metal   lit, glossy — coin doors, bolts, joystick shafts
 *   accent  unlit neon, takes the cabinet's primary colour
 *   accent2 unlit neon, takes the secondary
 */
const ROLES = {
  darkergray: 'body',   darkgray: 'body',   gray: 'body',   black: 'body',
  white: 'panel',       metal: 'metal',
  red: 'accent',        orange: 'accent',   yellow: 'accent',
  blue: 'accent2',      cyan: 'accent2',    green: 'accent2',
};

const ROLE_COLOR = {
  body:  0x241f31,
  panel: 0x4a4560,
  metal: 0x6e7b85,
};

/** Force a geometry onto the exact attribute set `mergeGeometries` demands. */
function canonical(geo, { color, cell, idx } = {}) {
  const n = geo.getAttribute('position').count;
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  // drop anything an exporter left behind that other geometries in the merge lack
  for (const k of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'uv', 'color', 'aCell', 'aIdx'].includes(k)) geo.deleteAttribute(k);
  }
  if (color) {
    const c = new THREE.Color(color);
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  if (cell) {
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) a.set(cell, i * 4);
    geo.setAttribute('aCell', new THREE.BufferAttribute(a, 4));
  }
  if (idx !== undefined) {
    const a = new Float32Array(n).fill(idx);
    geo.setAttribute('aIdx', new THREE.BufferAttribute(a, 1));
  }
  if (!geo.getIndex()) {
    geo.setIndex([...Array(n).keys()]);
  }
  return geo;
}

/**
 * Flatten a GLB chassis into local-space geometry, sorted by role.
 *
 * Returns everything the floor builder needs to place a copy: the role
 * geometries, the screen quad with 0..1 UVs, marquee and side-art quads found by
 * raycast, and the local dock transform the CSS3D iframe will be parked on.
 */
export function chassisTemplate(gltfScene, { height = 1.8 } = {}) {
  const root = gltfScene.clone(true);
  const screen = findScreen(root);

  // orient: screen faces +Z
  root.updateWorldMatrix(true, true);
  if (screen) {
    const centre = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    root.rotation.y -= Math.atan2(worldNormal(screen, centre).x, worldNormal(screen, centre).z);
  }

  // scale to `height`, base on y=0, centred on x/z
  root.updateWorldMatrix(true, true);
  let box = new THREE.Box3().setFromObject(root);
  root.scale.multiplyScalar(height / (box.max.y - box.min.y));
  root.updateWorldMatrix(true, true);
  box = new THREE.Box3().setFromObject(root);
  root.position.x -= (box.max.x + box.min.x) / 2;
  root.position.z -= (box.max.z + box.min.z) / 2;
  root.position.y -= box.min.y;
  root.updateWorldMatrix(true, true);
  box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());

  // ---- bake every chassis mesh into local space, bucketed by role -----------
  const buckets = { body: [], panel: [], metal: [], accent: [], accent2: [] };
  const chassisMeshes = [];
  root.traverse((o) => {
    if (!o.isMesh || o === screen) return;
    chassisMeshes.push(o);
    o.updateWorldMatrix(true, false);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = o.geometry.groups.length
      ? o.geometry.groups
      : [{ start: 0, count: Infinity, materialIndex: 0 }];
    groups.forEach((g) => {
      const mat = mats[g.materialIndex] || mats[0];
      const role = ROLES[(mat && mat.name || '').toLowerCase()] || 'body';
      const geo = extractGroup(o.geometry, g);
      geo.applyMatrix4(o.matrixWorld);
      buckets[role].push(geo);
    });
  });

  const parts = {};
  for (const [role, geos] of Object.entries(buckets)) {
    if (geos.length) parts[role] = mergeGeometries(geos.map((g) => canonical(g)), false);
    geos.forEach((g) => g.dispose && g.dispose());
  }

  // ---- the screen ----------------------------------------------------------
  let screenGeo = null;
  let dock = null;
  if (screen) {
    screen.updateWorldMatrix(true, false);
    const normal = worldNormal(screen, box.getCenter(new THREE.Vector3()));

    // Bake into cabinet-local space *first*, then rewrite UVs against an
    // identity transform. normalizeScreenUVs calls updateWorldMatrix, which
    // rebuilds matrixWorld from the mesh's own position/rotation — so handing it
    // a bare mesh with the real matrix copied in silently loses that matrix and
    // projects the quad in the wrong frame.
    screenGeo = screen.geometry.clone();
    screenGeo.applyMatrix4(screen.matrixWorld);
    normalizeScreenUVs(new THREE.Mesh(screenGeo), normal);

    const sbox = new THREE.Box3().setFromObject(screen);
    const ssize = sbox.getSize(new THREE.Vector3());
    dock = {
      position: sbox.getCenter(new THREE.Vector3()),
      normal,
      width: ssize.x,
      height: ssize.y,
    };
  }

  // ---- marquee + side art anchors, by raycast against the real chassis ------
  const quads = {};
  const anchor = (from, dir, w, h) => {
    const rc = new THREE.Raycaster(from, dir.clone().normalize(), 0, 20);
    const hit = rc.intersectObjects(chassisMeshes, true)[0];
    const point = hit ? hit.point : from.clone().sub(dir.clone().normalize().multiplyScalar(1));
    const q = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(q);
    m.position.copy(point).add(dir.clone().normalize().multiplyScalar(-0.006));
    m.lookAt(m.position.clone().sub(dir.clone().normalize()));
    m.updateMatrix();
    q.applyMatrix4(m.matrix);
    // Carry the quad's own width/height. Once it has been rotated into place its
    // bounding box is axis-aligned to the room, not to the panel, so one axis
    // collapses to zero and the aspect ratio is no longer recoverable from it.
    q.userData = { w, h };
    return q;
  };

  const marqueeY = screen
    ? (new THREE.Box3().setFromObject(screen).max.y + box.max.y) / 2
    : box.max.y - size.y * 0.08;
  quads.marquee = anchor(
    new THREE.Vector3(0, marqueeY, box.max.z + 1), new THREE.Vector3(0, 0, -1),
    size.x * 0.74, size.y * 0.09
  );
  [1, -1].forEach((sgn, i) => {
    quads[i ? 'sideR' : 'sideL'] = anchor(
      new THREE.Vector3(sgn * (box.max.x + 1), size.y * 0.60, 0), new THREE.Vector3(-sgn, 0, 0),
      size.z * 0.54, size.y * 0.34
    );
  });

  return { parts, screenGeo, dock, quads, size, box, marqueeY };
}

/** Pull one material group out of a geometry as a standalone BufferGeometry. */
function extractGroup(geo, group) {
  const idx = geo.getIndex();
  const total = idx ? idx.count : geo.getAttribute('position').count;
  const start = group.start || 0;
  const count = Math.min(group.count === Infinity ? total : group.count, total - start);
  if (start === 0 && count === total) return geo.clone();
  const out = geo.clone();
  out.setIndex(Array.from({ length: count }, (_, i) => idx.getX(start + i)));
  out.clearGroups();
  return out.toNonIndexed();
}

export { ROLE_COLOR };
