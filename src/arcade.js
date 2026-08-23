import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeCrtMaterial } from './crt.js';
import { Atlas } from './atlas.js';
import { paintAttract, paintMarquee, paintSide, paintFallback } from './art.js';
import { radialTexture } from './xrp.js';
import { ROLE_COLOR } from './cabinet.js';

/**
 * Twenty-three cabinets, six draw calls.
 *
 * Every cabinet on the floor is the same chassis geometry standing somewhere
 * else, so each slot's transform gets baked into a copy and the copies are
 * merged. What varies between cabinets — accent colour, which game's art —
 * rides in as vertex attributes: colour for the neon, an atlas cell for the
 * screens and panels. Nothing per-cabinet survives as its own object except the
 * dock transform, which is data, not scene graph.
 */

const NEON_GAIN = 1.55;     // how far past white the unlit neon sits, for bloom
const MARQUEE_GAIN = 1.35;

export function buildArcade({ template, slots, games, images, focusGain = 0.35 }) {
  const n = slots.length;
  const group = new THREE.Group();
  group.name = 'arcade';

  // ---- atlases, sized from the template's own quads ------------------------
  const scr = template.dock;
  const scrAspect = scr ? scr.width / scr.height : 1;
  const attract = new Atlas(cell(384, scrAspect), 384, n, { name: 'attract' });

  const mq = template.quads.marquee.userData;
  const marquee = new Atlas(512, cell(512, mq.h / mq.w), n, { name: 'marquee' });

  const sd = template.quads.sideL.userData;
  const side = new Atlas(336, cell(336, sd.h / sd.w), n, { name: 'side' });

  // ---- paint the static atlases once --------------------------------------
  slots.forEach((slot, i) => {
    const g = games[i];
    const opts = { title: g.title, image: images[g.slug] || null, accent: slot.accent, accent2: slot.accent2 };
    marquee.draw(i, (ctx, w, h) => paintMarquee(ctx, w, h, opts));
    side.draw(i, (ctx, w, h) => (opts.image ? paintSide(ctx, w, h, opts) : paintFallback(ctx, w, h, opts)));
    attract.draw(i, (ctx, w, h) => paintAttract(ctx, w, h, { ...opts, time: 0 }));
  });
  marquee.flush(); side.flush(); attract.flush();

  // ---- bake every slot ----------------------------------------------------
  const buckets = { body: [], panel: [], metal: [], accent: [], accent2: [] };
  const screens = [], marquees = [], sides = [];
  const docks = [];
  const blockers = [];

  slots.forEach((slot, i) => {
    const m = new THREE.Matrix4().makeRotationY(slot.yaw);
    m.setPosition(slot.pos[0], slot.pos[1] || 0, slot.pos[2]);

    for (const [role, geo] of Object.entries(template.parts)) {
      const g = geo.clone().applyMatrix4(m);
      const col = role === 'accent' ? scaled(slot.accent, NEON_GAIN)
                : role === 'accent2' ? scaled(slot.accent2, NEON_GAIN)
                : new THREE.Color(ROLE_COLOR[role] ?? ROLE_COLOR.body);
      paint(g, col);
      buckets[role].push(g);
    }

    if (template.screenGeo) {
      const g = template.screenGeo.clone().applyMatrix4(m);
      stamp(g, 'aCell', 4, attract.uv(i));
      stamp(g, 'aIdx', 1, [i]);
      screens.push(g);
    }

    marquees.push(atlasQuad(template.quads.marquee, m, marquee.uv(i)));
    sides.push(atlasQuad(template.quads.sideL, m, side.uv(i)));
    sides.push(atlasQuad(template.quads.sideR, m, side.uv(i)));

    // dock: the screen plane carried into world space
    if (scr) {
      docks.push({
        index: i,
        slot,
        game: games[i],
        position: scr.position.clone().applyMatrix4(m),
        normal: scr.normal.clone().transformDirection(m).normalize(),
        width: scr.width,
        height: scr.height,
      });
    }

    // collision footprint, generous enough that you never clip a corner
    const half = new THREE.Vector3(template.size.x / 2, 0, template.size.z / 2);
    const c = Math.abs(Math.cos(slot.yaw)), s = Math.abs(Math.sin(slot.yaw));
    blockers.push({
      cx: slot.pos[0], cz: slot.pos[2],
      hw: half.x * c + half.z * s + 0.06,
      hd: half.z * c + half.x * s + 0.06,
    });
  });

  // ---- merge and materialise ----------------------------------------------
  const meshes = {};
  const lit = [...buckets.body, ...buckets.panel];
  if (lit.length) {
    meshes.chassis = new THREE.Mesh(mergeGeometries(lit, false), new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0.12,
    }));
    meshes.chassis.name = 'cab-chassis';
  }
  if (buckets.metal.length) {
    meshes.metal = new THREE.Mesh(mergeGeometries(buckets.metal, false), new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.28, metalness: 0.85,
    }));
    meshes.metal.name = 'cab-metal';
  }
  const neon = [...buckets.accent, ...buckets.accent2];
  if (neon.length) {
    // Unlit on purpose. A glowing strip is an emitter, not a lit surface, and
    // MeshBasicMaterial multiplies the vertex colour straight through — which is
    // how the values get above 1.0 and into the bloom pass.
    meshes.neon = new THREE.Mesh(mergeGeometries(neon, false), new THREE.MeshBasicMaterial({
      vertexColors: true, toneMapped: false,
    }));
    meshes.neon.name = 'cab-neon';
  }
  if (screens.length) {
    const crt = makeCrtMaterial(attract.texture, { atlas: true, aspect: 1, bright: 1.62, focusGain });
    meshes.screens = new THREE.Mesh(mergeGeometries(screens, false), crt);
    meshes.screens.name = 'cab-screens';
    meshes.screens.userData.crt = crt;
  }
  meshes.marquees = new THREE.Mesh(mergeGeometries(marquees, false), new THREE.MeshBasicMaterial({
    map: marquee.texture, toneMapped: false,
    color: new THREE.Color(MARQUEE_GAIN, MARQUEE_GAIN, MARQUEE_GAIN),
  }));
  meshes.marquees.name = 'cab-marquees';

  meshes.sides = new THREE.Mesh(mergeGeometries(sides, false), new THREE.MeshStandardMaterial({
    map: side.texture, roughness: 0.62, metalness: 0.0,
  }));
  meshes.sides.name = 'cab-sides';

  Object.values(meshes).forEach((mesh) => {
    mesh.frustumCulled = false;    // one mesh spans the whole room
    group.add(mesh);
  });

  // ---- floor pools + blob shadows -----------------------------------------
  group.add(...floorDecals(slots, template, docks));

  // ---- live attract -------------------------------------------------------
  const painters = slots.map((slot, i) => {
    const g = games[i];
    return { i, slot, game: g, image: images[g.slug] || null, pos: new THREE.Vector3(slot.pos[0], 0, slot.pos[2]) };
  });

  let acc = 0;
  /**
   * Repaint attract cells, but only the ones a player could actually read.
   *
   * Twenty-three canvases at full rate is real CPU on a phone for pixels that
   * are four metres away and eight pixels tall. Anything past `radius` keeps the
   * frame it was last given, which is indistinguishable at that distance.
   */
  function update(dt, t, playerPos, { radius = 11, hz = 7 } = {}) {
    acc += dt;
    if (acc < 1 / hz) return;
    acc = 0;
    let painted = 0;
    for (const p of painters) {
      if (playerPos && p.pos.distanceTo(playerPos) > radius) continue;
      attract.draw(p.i, (ctx, w, h) => paintAttract(ctx, w, h, {
        title: p.game.title, image: p.image,
        accent: p.slot.accent, accent2: p.slot.accent2, time: t,
      }));
      painted++;
    }
    attract.flush();
    update.painted = painted;
  }

  function setFocus(i) {
    if (meshes.screens) meshes.screens.material.userData.uniforms.uFocus.value = i ?? -1;
  }

  return { group, meshes, docks, blockers, atlases: { attract, marquee, side }, update, setFocus };
}

/* --------------------------------------------------------------- helpers */

/** Cell width for a given height and aspect, snapped to a multiple of 4. */
function cell(base, aspect) {
  return Math.max(16, Math.round(base * aspect / 4) * 4);
}

/** A colour pushed past 1.0 so it clears the bloom threshold. */
function scaled(hex, gain) {
  const c = new THREE.Color(hex);
  return new THREE.Color(c.r * gain, c.g * gain, c.b * gain);
}

function paint(geo, color) {
  const n = geo.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = color.r; a[i * 3 + 1] = color.g; a[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
}

function stamp(geo, name, size, value) {
  const n = geo.getAttribute('position').count;
  const a = new Float32Array(n * size);
  for (let i = 0; i < n; i++) a.set(value, i * size);
  geo.setAttribute(name, new THREE.BufferAttribute(a, size));
}

/**
 * A decal quad with the atlas cell folded straight into its UVs.
 *
 * Unlike the screens these need no local UV — nothing samples them through a
 * distortion — so the cell transform can be baked once here instead of riding
 * along as an extra attribute.
 */
function atlasQuad(src, matrix, uv) {
  const g = src.clone().applyMatrix4(matrix);
  const a = g.getAttribute('uv');
  const out = new Float32Array(a.count * 2);
  for (let i = 0; i < a.count; i++) {
    out[i * 2]     = uv[0] + a.getX(i) * uv[2];
    out[i * 2 + 1] = uv[1] + a.getY(i) * uv[3];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(out, 2));
  if (!g.getAttribute('color')) paint(g, new THREE.Color(0xffffff));
  return g;
}

/**
 * The light each cabinet throws onto the floor, and the dark it blocks.
 *
 * These are flat quads, not lights. Twenty-three real point lights would price
 * every material in the room out of the frame budget, and a radial gradient on
 * the ground is what the eye actually reads as "that machine is glowing" —
 * the same reason the shadow underneath is a soft blob rather than a shadow map.
 */
function floorDecals(slots, template, docks) {
  const pools = [], shades = [];
  const pw = template.size.x * 2.6, pd = template.size.z * 3.2;

  slots.forEach((slot, i) => {
    const d = docks[i];
    const forward = d ? d.normal.clone() : new THREE.Vector3(0, 0, 1);
    // biased forward, because a cabinet spills light out of its screen, not backwards
    const cx = slot.pos[0] + forward.x * template.size.z * 0.55;
    const cz = slot.pos[2] + forward.z * template.size.z * 0.55;

    const p = new THREE.PlaneGeometry(pw, pd);
    p.rotateX(-Math.PI / 2);
    p.translate(cx, 0.014, cz);
    paint(p, scaled(slot.accent, 0.9));
    pools.push(p);

    const s = new THREE.PlaneGeometry(template.size.x * 1.5, template.size.z * 1.7);
    s.rotateX(-Math.PI / 2);
    s.translate(slot.pos[0], 0.008, slot.pos[2]);
    shades.push(s);
  });

  const poolTex = radialTexture(0xffffff, { power: 2.6 });
  const poolMesh = new THREE.Mesh(mergeGeometries(pools, false), new THREE.MeshBasicMaterial({
    map: poolTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, opacity: 0.20,
  }));
  poolMesh.name = 'floor-pools';
  poolMesh.renderOrder = 2;
  poolMesh.frustumCulled = false;

  const shadeMesh = new THREE.Mesh(mergeGeometries(shades, false), new THREE.MeshBasicMaterial({
    map: radialTexture(0x000000, { power: 1.6 }), transparent: true,
    depthWrite: false, opacity: 0.62,
  }));
  shadeMesh.name = 'floor-shadows';
  shadeMesh.renderOrder = 1;
  shadeMesh.frustumCulled = false;

  return [shadeMesh, poolMesh];
}
