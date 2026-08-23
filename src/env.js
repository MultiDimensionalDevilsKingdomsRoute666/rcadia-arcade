import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROOM, islandBases } from './layout.js';
import { makeCarpet, makeWall, makeTerrazzo, makeEnvCanvas, NEON } from './carpet.js';
import { xrpHero, radialTexture, drawXrpMark } from './xrp.js';

/**
 * The room itself: shell, neon, and the very short list of real lights.
 *
 * Almost nothing here is lit in the conventional sense. The arcade is a dark box
 * whose light comes from surfaces that emit — marquees, screens, tube runs, the
 * XRP sign — with five actual lights doing nothing more than keeping geometry
 * legible where the neon does not reach. That is not a compromise for
 * performance; it is how the reference photographs of real arcades look.
 */

/* ------------------------------------------------------------------ shell */

export function buildShell() {
  const g = new THREE.Group();
  g.name = 'shell';
  const { w, d, h, atriumR, atriumRise, coffer } = ROOM;

  const carpet = makeCarpet({ repeat: [10, 7] });
  const wallTex = makeWall({ repeat: [7, 1] });
  const terrazzo = makeTerrazzo();

  // ---- floor -------------------------------------------------------------
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({
      map: carpet.map, normalMap: carpet.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.93, metalness: 0.04,
      color: 0xa9a3bf,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: carpet.map,
      emissiveIntensity: 0.20,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor-carpet';
  g.add(floor);

  // ---- atrium: raised terrazzo disc with the XRP mark inlaid --------------
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(atriumR, 72),
    new THREE.MeshStandardMaterial({
      map: terrazzo.map,
      emissiveMap: terrazzo.emissiveMap,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.72,
      roughness: 0.58, metalness: 0.26,
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = atriumRise + 0.002;
  disc.name = 'atrium-floor';
  g.add(disc);

  const step = new THREE.Mesh(
    new THREE.CylinderGeometry(atriumR, atriumR, atriumRise, 72, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x14101f, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide })
  );
  step.position.y = atriumRise / 2;
  g.add(step);

  // ---- walls -------------------------------------------------------------
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex.map, normalMap: wallTex.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.80, metalness: 0.08, color: 0x767090,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: wallTex.emissiveMap,
    emissiveIntensity: 0.85,
  });
  const wall = (wide, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wide, h), wallMat);
    m.position.set(x, h / 2, z);
    m.rotation.y = ry;
    g.add(m);
    return m;
  };
  wall(w, 0, -d / 2, 0);                 // north
  wall(w, 0,  d / 2, Math.PI);           // south
  wall(d, -w / 2, 0,  Math.PI / 2);      // west
  wall(d,  w / 2, 0, -Math.PI / 2);      // east

  // ---- ceiling -----------------------------------------------------------
  const ceil = new THREE.Mesh(
    new THREE.RingGeometry(atriumR, Math.hypot(w, d), 64, 1),
    new THREE.MeshStandardMaterial({ color: 0x070610, roughness: 0.97, side: THREE.DoubleSide })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = h;
  g.add(ceil);

  // the atrium's coffer: a well the hero sign sits under
  const well = new THREE.Mesh(
    new THREE.CylinderGeometry(atriumR, atriumR, coffer - h, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x0c0916, roughness: 0.9, side: THREE.BackSide })
  );
  well.position.y = h + (coffer - h) / 2;
  g.add(well);

  const wellTop = new THREE.Mesh(
    new THREE.CircleGeometry(atriumR, 64),
    new THREE.MeshStandardMaterial({ color: 0x08060f, roughness: 0.95 })
  );
  wellTop.rotation.x = Math.PI / 2;
  wellTop.position.y = coffer;
  g.add(wellTop);

  // ---- island plinths ----------------------------------------------------
  const plinths = islandBases().map((b) => {
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    geo.translate(b.pos[0], b.h / 2, b.pos[2]);
    return geo;
  });
  if (plinths.length) {
    const m = new THREE.Mesh(mergeGeometries(plinths, false),
      new THREE.MeshStandardMaterial({ color: 0x181327, roughness: 0.55, metalness: 0.3 }));
    m.name = 'island-plinths';
    g.add(m);
  }

  g.userData.textures = { carpet, wallTex, terrazzo };
  return g;
}

/* ------------------------------------------------------------------- neon */

/**
 * Neon tube runs, merged by colour.
 *
 * Each run is a thin emissive tube plus a fatter additive sleeve around it. The
 * sleeve is what makes a tube read as neon rather than a coloured wire: bloom
 * spreads light outward from bright pixels, but only the sleeve puts a visible
 * glow in the air right against the glass.
 */
export function buildNeon() {
  const g = new THREE.Group();
  g.name = 'neon';
  const { w, d, h, atriumR, atriumRise } = ROOM;
  const runs = [];

  const line = (pts, color, closed = false) => runs.push({ pts: pts.map((p) => new THREE.Vector3(...p)), color, closed });

  // perimeter, at chest height and again along the ceiling line
  const inset = 0.08;
  const corners = (y) => [
    [-w / 2 + inset, y, -d / 2 + inset], [w / 2 - inset, y, -d / 2 + inset],
    [w / 2 - inset, y, d / 2 - inset], [-w / 2 + inset, y, d / 2 - inset],
  ];
  // Below screen height on purpose: at 1.1m the run cut straight across every
  // cabinet's marquee from the far side of the room.
  line(corners(0.42), '#ff17c3', true);
  line(corners(h - 0.16), '#00c7fe', true);

  // atrium rim
  const rim = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    rim.push([Math.cos(a) * (atriumR - 0.05), atriumRise + 0.05, Math.sin(a) * (atriumR - 0.05)]);
  }
  line(rim, '#00c7fe', true);

  // a second ring up in the coffer, washing the ceiling well
  const upper = rim.map(([x, , z]) => [x * 0.94, h + 0.35, z * 0.94]);
  line(upper, '#ff17c3', true);

  // island base strips
  islandBases().forEach((b) => {
    const [x, , z] = b.pos;
    const hw = b.w / 2 + 0.02, hd = b.d / 2 + 0.02, y = b.h + 0.015;
    line([[x - hw, y, z - hd], [x + hw, y, z - hd], [x + hw, y, z + hd], [x - hw, y, z + hd]], '#736eb0', true);
  });

  // entrance portal on the south wall
  const pw = 1.7, ph = 2.7, pz = d / 2 - 0.06;
  line([[-pw, 0.02, pz], [-pw, ph, pz], [pw, ph, pz], [pw, 0.02, pz]], '#f37e3e');

  // ---- build ------------------------------------------------------------
  const byColor = new Map();
  runs.forEach(({ pts, color, closed }) => {
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.0);
    const segs = Math.max(24, Math.round(curve.getLength() * 3));
    const core = new THREE.TubeGeometry(curve, segs, 0.018, 6, closed);
    const halo = new THREE.TubeGeometry(curve, segs, 0.065, 6, closed);
    if (!byColor.has(color)) byColor.set(color, { core: [], halo: [] });
    byColor.get(color).core.push(core);
    byColor.get(color).halo.push(halo);
  });

  byColor.forEach(({ core, halo }, color) => {
    const c = new THREE.Color(color);
    const tube = new THREE.Mesh(mergeGeometries(core, false), new THREE.MeshBasicMaterial({
      color: new THREE.Color(c.r * 2.0, c.g * 2.0, c.b * 2.0), toneMapped: false,
    }));
    tube.name = `neon-${color}`;
    g.add(tube);

    const sleeve = new THREE.Mesh(mergeGeometries(halo, false), new THREE.MeshBasicMaterial({
      color: c, toneMapped: false, transparent: true, opacity: 0.13,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sleeve.renderOrder = 3;
    g.add(sleeve);
  });

  return g;
}

/* ------------------------------------------------------------- wall signs */

function signCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function neonWord(ctx, text, x, y, size, color, glow) {
  ctx.font = `900 ${size}px Orbitron, "Arial Black", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = glow * 2.1;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = 0.9;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

/**
 * Signage.
 *
 * Four blank walls is what made the room read as a box with cabinets in it
 * rather than a place. These are unlit planes sitting just proud of the wall, so
 * they cost one draw each and glow on their own.
 */
export function buildSigns() {
  const g = new THREE.Group();
  g.name = 'signs';
  const { w, d, h } = ROOM;

  const sign = (tex, width, height, pos, ry, gain = 1.5) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({
      map: tex, transparent: true, toneMapped: false, depthWrite: false,
      color: new THREE.Color(gain, gain, gain),
      blending: THREE.AdditiveBlending,
    }));
    m.position.set(...pos);
    m.rotation.y = ry;
    g.add(m);
    return m;
  };

  // RCADIA wordmark on both long walls
  const word = signCanvas(1024, 256, (ctx, cw, ch) => {
    neonWord(ctx, 'RCADIA', cw / 2, ch * 0.44, 132, '#ff17c3', 34);
    ctx.font = '600 34px Rajdhani, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#00c7fe';
    ctx.fillText('X R P L   A R C A D E', cw / 2, ch * 0.80);
  });
  sign(word, 6.4, 1.6, [-w / 2 + 0.10, 2.85, -1.5], Math.PI / 2, 1.25);
  sign(word, 6.4, 1.6, [w / 2 - 0.10, 2.85, -1.5], -Math.PI / 2, 1.25);

  // the XRP mark over the hero row
  const mark = signCanvas(512, 512, (ctx, cw) => drawXrpMark(ctx, cw / 2, cw / 2, cw * 0.82, '#7fd0ff'));
  sign(mark, 1.7, 1.7, [0, 3.5, -d / 2 + 0.10], 0, 0.85);

  // "INSERT COIN" over the entrance, because of course
  const coin = signCanvas(768, 192, (ctx, cw, ch) => {
    neonWord(ctx, 'INSERT COIN', cw / 2, ch * 0.55, 92, '#ffd84d', 26);
  });
  sign(coin, 3.4, 0.85, [0, 3.15, d / 2 - 0.10], Math.PI, 1.0);

  return g;
}

/**
 * Ceiling truss. Dark boxes crossing overhead — barely lit, but they give the
 * ceiling a scale and stop it reading as an infinite black lid.
 */
export function buildTruss() {
  const { w, d, h } = ROOM;
  const bars = [];
  for (let x = -w / 2 + 3; x <= w / 2 - 3; x += 4.6) {
    const b = new THREE.BoxGeometry(0.14, 0.20, d - 0.6);
    b.translate(x, h - 0.14, 0);
    bars.push(b);
  }
  for (let z = -d / 2 + 2.6; z <= d / 2 - 2.6; z += 4.4) {
    const b = new THREE.BoxGeometry(w - 0.6, 0.16, 0.12);
    b.translate(0, h - 0.30, z);
    bars.push(b);
  }
  const m = new THREE.Mesh(mergeGeometries(bars, false),
    new THREE.MeshStandardMaterial({ color: 0x16121f, roughness: 0.7, metalness: 0.55 }));
  m.name = 'truss';
  return m;
}

/* --------------------------------------------------------------- fixtures */

const coneGradient = (() => {
  let t = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    // Canvas row 0 ends up at v=1 (textures upload flipped) and ConeGeometry
    // puts v=1 at the apex, so row 0 is the fixture and the last row is the
    // floor. Bright at the lamp, gone by the ground.
    g.addColorStop(0, 'rgba(255,255,255,0.75)');  // v=1, the apex at the fixture
    g.addColorStop(0.30, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.70, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');     // v=0, the wide end at the floor
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 64);
    t = new THREE.CanvasTexture(c);
    return t;
  };
})();

/**
 * A hanging bar fixture and the shaft of light under it.
 *
 * The shaft is a cone with a gradient down its length, additive and depth-write
 * off. It is not volumetric lighting by any honest definition, but in a hazy
 * dark room it is indistinguishable from one at a thousandth of the cost.
 */
export function fixture({ pos, color = '#cfe6ff', len = 2.2, drop = 0.55, cone = 1.5, reach = 3.4 }) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);

  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(len, 0.07, 0.13),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(c.r * 1.5, c.g * 1.5, c.b * 1.5), toneMapped: false })
  );
  bar.position.set(0, -drop, 0);
  g.add(bar);

  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, drop, 5),
    new THREE.MeshStandardMaterial({ color: 0x2a2438, roughness: 0.6, metalness: 0.7 })
  );
  rod.position.set(0, -drop / 2, 0);
  g.add(rod);

  const shaft = new THREE.Mesh(
    new THREE.ConeGeometry(cone, reach, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: c, map: coneGradient(), transparent: true, opacity: 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, toneMapped: false,
    })
  );
  shaft.position.set(0, -drop - reach / 2, 0);
  shaft.renderOrder = 4;
  g.add(shaft);

  g.position.set(pos[0], pos[1], pos[2]);
  return g;
}

export function buildFixtures() {
  const g = new THREE.Group();
  g.name = 'fixtures';
  const y = ROOM.h - 0.05;
  const spots = [
    [-10.4, y, 6.6, '#ff9ad8'], [-10.4, y, -2.0, '#9ad6ff'],
    [10.4, y, 6.6, '#9ad6ff'],  [10.4, y, -2.0, '#ff9ad8'],
    [-4.6, y, -8.2, '#cfe6ff'], [4.6, y, -8.2, '#cfe6ff'],
    [0, y, 9.0, '#ffc79a'],
  ];
  spots.forEach(([x, yy, z, col]) => g.add(fixture({ pos: [x, yy, z], color: col })));
  return g;
}

/* ------------------------------------------------------------------ hero */

export function buildHero() {
  const g = new THREE.Group();
  g.name = 'hero';
  const { atriumRise } = ROOM;

  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.92, 1.05, 0.86, 32),
    new THREE.MeshStandardMaterial({ color: 0x1c1530, roughness: 0.62, metalness: 0.3 })
  );
  plinth.position.y = atriumRise + 0.43;
  g.add(plinth);

  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.94, 0.022, 8, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 1.9, 2.6), toneMapped: false })
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.y = atriumRise + 0.84;
  g.add(collar);

  const hero = xrpHero({ height: 2.1 });
  hero.position.y = atriumRise + 0.86 + 1.15;
  g.add(hero);

  // a pool of light thrown up the well behind the sign
  const wash = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 5.6),
    new THREE.MeshBasicMaterial({
      map: radialTexture(0x2f6fff, { power: 1.8 }), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.16, toneMapped: false,
    })
  );
  wash.rotation.x = -Math.PI / 2;
  wash.position.y = ROOM.coffer - 0.02;
  g.add(wash);

  g.userData.hero = hero;
  return g;
}

/* ----------------------------------------------------------------- lights */

/**
 * Five lights for the whole arcade.
 *
 * Phase 1 gave each cabinet a screen light and a marquee bar; twenty-three of
 * those is forty-six lights, and every one of them multiplies the fragment cost
 * of every lit material in the room. The emissive surfaces and the floor pools
 * carry the colour instead, and these five exist only so that unlit geometry
 * still has readable form.
 */
export function buildLights({ amb = 0.42, hemi = 0.62, dir = 0.70, atrium = 10, lounge = 12, wall = 45 } = {}) {
  const g = new THREE.Group();
  g.name = 'lights';

  g.add(new THREE.AmbientLight(0x2e2846, amb));
  g.add(new THREE.HemisphereLight(0x3d4d96, 0x140f1e, hemi));

  const key = new THREE.DirectionalLight(0xbcc8ff, dir);
  key.position.set(6, 9, 8);
  g.add(key, key.target);

  const a = new THREE.PointLight(0x7fd4ff, atrium, 15, 1.45);
  a.position.set(0, 5.4, 0);
  g.add(a);

  const l = new THREE.PointLight(0xff5fc0, lounge, 11, 1.8);
  l.position.set(-9.0, 3.0, 6.8);
  g.add(l);

  // The hero row is the deepest part of the room and the furthest from every
  // other emitter; without this the seven best games sit in the dark.
  const wl = new THREE.PointLight(0xa9c4ff, wall, 18, 1.35);
  wl.position.set(0, 3.0, -7.6);
  g.add(wl);

  g.userData.lights = { key, atrium: a, lounge: l, wall: wl };
  return g;
}

/**
 * scene.environment from a painted equirect.
 *
 * In a room lit by emissive surfaces there is no image-based light at all unless
 * one is supplied, and without it every metal edge and glossy floor resolves to
 * flat black. This is a 512x256 canvas of roughly where the room's colour lives.
 */
export function buildEnvironment(renderer) {
  const canvas = makeEnvCanvas();
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  tex.dispose();
  return rt.texture;
}

export { NEON };
