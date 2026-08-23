import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';

import { loadGLB, chassisTemplate } from './cabinet.js';
import { buildArcade } from './arcade.js';
import { buildShell, buildNeon, buildFixtures, buildHero, buildLights, buildEnvironment, buildSigns, buildTruss } from './env.js';
import { rigProp, loungeDressing } from './props.js';
import { loadXrp } from './xrp.js';
import { Player } from './player.js';
import { ROOM, cabinetSlots, staticBlockers, floorHeightAt, PROPS, TOUR } from './layout.js';
import { selftest } from './selftest.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
const flag = (k) => q.get(k) === '1';
const BASE = q.get('base') || '.';
const SHOT = flag('shot');
const MOBILE = flag('mobile') || matchMedia('(pointer: coarse)').matches || innerWidth < 760;

const app = document.getElementById('app');
const el = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- renderer */

// alpha MUST stay false. A transparent canvas makes UnrealBloomPass lose the
// base render every frame and the whole scene dissolves into a blur wash — a
// full afternoon of Phase 1 went into finding that.
const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, alpha: false, powerPreference: 'high-performance' });
let renderScale = num('rs', MOBILE ? 0.85 : 1);
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2) * renderScale);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exp', 1.05);
renderer.info.autoReset = false;
renderer.domElement.className = 'gl';
app.appendChild(renderer.domElement);

const css = new CSS3DRenderer();
css.domElement.className = 'css3d';
app.appendChild(css.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04030a);
// Linear fog, not exponential: in a closed room the far wall is 28m away, and a
// range that ends just past it keeps depth without hazing over the near rows.
scene.fog = new THREE.Fog(0x06040e, num('fogn', 12), num('fogf', 44));

const cssScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', MOBILE ? 68 : 62), 1, 0.05, 90);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1),
  num('bloom', 0.62), num('bloomr', 0.62), num('bloomt', 1.55));
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* -------------------------------------------------------------------- data */

const state = { docked: null, focus: null, ready: false, arcade: null, docks: [] };

async function loadJSON(url) { return (await fetch(url)).json(); }

function loadImage(url) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}

const slugOf = (g) => (String(g.iframeSrc || '').match(/\/games\/([^/]+)\//) || [, ''])[1];

/* ------------------------------------------------------------------- build */

async function build() {
  const [games, chassis] = await Promise.all([
    loadJSON(`${BASE}/assets/games.json`),
    loadGLB(`${BASE}/assets/cabinet-jtoastie.glb`),
    loadXrp(`${BASE}/assets/xrp.svg`),
  ]);

  // Busiest games get the most prominent slots — the hero wall you meet after
  // rounding the atrium, then the islands nearest the door.
  const ranked = games
    .map((g) => ({ ...g, slug: slugOf(g) }))
    .filter((g) => g.slug)
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0));

  const slots = cabinetSlots().slice(0, ranked.length);
  const picked = ranked.slice(0, slots.length);

  const images = {};
  await Promise.all(picked.map(async (g) => {
    images[g.slug] = await loadImage(`${BASE}/assets/games/${g.slug}.png`);
  }));

  // Kill switches. Every large contributor to the look can be removed from the
  // URL, because "the floor went brown" is a question about which of six
  // overlapping things did it, and bisecting beats guessing.
  if (!flag('noenv')) scene.environment = buildEnvironment(renderer);

  const shell = buildShell();
  const neon = buildNeon();
  const fixtures = buildFixtures();
  const hero = buildHero();
  const lights = buildLights({
    amb: num('amb', 0.42), hemi: num('hemi', 0.62), dir: num('dir', 0.70),
    atrium: num('patrium', 10), lounge: num('plounge', 12), wall: num('pwall', 45),
  });
  scene.add(shell, lights, buildSigns(), buildTruss());
  if (!flag('noneon')) scene.add(neon);
  if (!flag('nofix')) scene.add(fixtures);
  if (!flag('nohero')) scene.add(hero);
  if (flag('nofog')) scene.fog = null;

  const template = chassisTemplate(chassis.scene, { height: 1.78 });
  const arcade = buildArcade({ template, slots, games: picked, images });
  if (flag('nopool')) {
    ['floor-pools', 'floor-shadows'].forEach((n) => {
      const m = arcade.group.getObjectByName(n);
      if (m) arcade.group.remove(m);
    });
  }
  scene.add(arcade.group);
  state.arcade = arcade;
  state.docks = arcade.docks;

  const dressing = loungeDressing();
  scene.add(dressing);

  const props = await Promise.all(PROPS.map((p) => rigProp(
    `${BASE}/assets/prop-${p.kind}.glb`, p.kind,
    { height: p.kind === 'pool' ? 0.80 : 0.76, pos: p.pos, yaw: p.yaw, glow: p.glow }
  )));
  props.forEach((p) => scene.add(p));

  const blockers = [
    ...staticBlockers(),
    ...arcade.blockers,
    ...props.map((p) => p.userData.blocker),
    ...dressing.userData.blockers,
  ];

  const player = new Player(camera, { dom: renderer.domElement, blockers, floorHeightAt, eye: ROOM.eye });
  player.pos.set(ROOM.spawn[0], 0, ROOM.spawn[2]);
  player.onTap = (ndc) => tapped(ndc, player);

  // The joystick has no fixed home: it appears wherever the thumb lands, which
  // is the only version of a screen stick that works when you cannot see your
  // own hand. The ring follows the touch origin, the nub follows the drag.
  const ring = el('stick'), nub = ring.firstElementChild;
  player.onStick = (st) => {
    if (!st) { ring.classList.remove('on'); nub.style.transform = ''; return; }
    ring.style.left = `${st.ox}px`;
    ring.style.top = `${st.oy}px`;
    ring.classList.add('on');
    nub.style.transform = `translate(${st.x * 34}px, ${st.y * 34}px)`;
    document.body.classList.add('moved');
  };

  state.player = player;
  state.hero = hero.userData.hero;
  return { arcade, player, template };
}

/* ------------------------------------------------------------------- focus */

const _v = new THREE.Vector3();

/**
 * The cabinet you are standing in front of.
 *
 * Distance alone is not enough on an island, where two machines share a metre of
 * floor back to back — the dot product against the screen's own normal is what
 * decides which one you are actually looking at.
 */
function nearestDock(player) {
  let best = null, bestScore = 0;
  const facing = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  for (const d of state.docks) {
    _v.set(d.position.x - player.pos.x, 0, d.position.z - player.pos.z);
    const dist = _v.length();
    if (dist > 2.4) continue;
    _v.divideScalar(dist || 1);
    if (_v.dot(facing) < 0.25) continue;             // it is behind you
    const face = -_v.dot(d.normal);                  // you are in front of it
    if (face < 0.55) continue;
    const score = face * (1 - dist / 2.4);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

const prompt = () => el('prompt');

function updateFocus(player) {
  if (state.docked) return;
  const d = nearestDock(player);
  if (d !== state.focus) {
    state.focus = d;
    state.arcade.setFocus(d ? d.index : -1);
  }
  const p = prompt();
  if (!d) { p.classList.remove('on'); return; }

  _v.copy(d.position).add(d.normal.clone().multiplyScalar(0.05)).project(camera);
  if (_v.z > 1) { p.classList.remove('on'); return; }
  p.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  p.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
  p.querySelector('.title').textContent = d.game.title;
  p.querySelector('.hint').textContent = player.touch ? 'TAP TO PLAY' : 'PRESS  E  TO PLAY';
  p.classList.add('on');
}

/** A tap or click: play what was hit, or walk to it if it is out of reach. */
function tapped(ndc, player) {
  if (state.docked) return;
  if (state.focus) { dock(state.focus); return; }

  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const hits = rc.intersectObjects(
    [state.arcade.meshes.screens, state.arcade.meshes.chassis, state.arcade.meshes.marquees].filter(Boolean),
    false
  );
  if (!hits.length) { player.requestPointerLock(); return; }

  // Whichever dock is closest to the point that was hit, provided it is close
  // enough that the tap plausibly meant that machine.
  let best = null, bestD = 1.4;
  for (const d of state.docks) {
    const dist = d.position.distanceTo(hits[0].point);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  if (best) player.moveTo(player.poseNear(best), 900);
}

/* -------------------------------------------------------------------- dock */

let dockObj = null;

/**
 * Park a live iframe on the cabinet glass.
 *
 * CSS3DRenderer transforms a DOM element with the same projection the WebGL
 * camera uses, which is the only way an actual playable page can sit on a 3D
 * surface — an iframe can never become a texture, because no browser will let
 * one document read another's rendered pixels.
 *
 * The consequence is that the two layers only agree while the camera is still,
 * so docking freezes the player, and only one cabinet can be live at a time.
 */
function dock(d) {
  if (state.docked) return;
  const player = state.player;
  state.docked = d;
  document.body.classList.add('docked');
  prompt().classList.remove('on');

  // Mount before moving, not after.
  //
  // CSS3DRenderer re-projects the element with the live camera every frame, so
  // the iframe stays glued to the glass throughout the approach and simply grows
  // as you walk in. Waiting for the fly-in to finish before mounting made the
  // whole dock hostage to the render loop — background a tab mid-approach and
  // requestAnimationFrame stops, the tween never completes, and the player is
  // left frozen in front of a cabinet that never turns on.
  const PX = 760;
  const wrap = document.createElement('div');
  wrap.className = 'dock';
  wrap.style.width = `${PX}px`;
  wrap.style.height = `${Math.round(PX * (d.height / d.width))}px`;

  const frame = document.createElement('iframe');
  frame.src = q.get('dockurl') || `https://www.rcadia.xyz/api/game-proxy/${d.game.slug}/index.html`;
  frame.allow = 'autoplay; fullscreen; gamepad';
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
  wrap.appendChild(frame);

  dockObj = new CSS3DObject(wrap);
  dockObj.position.copy(d.position).add(d.normal.clone().multiplyScalar(0.008));
  dockObj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normal);
  dockObj.scale.setScalar(d.width / PX);
  cssScene.add(dockObj);

  css.domElement.style.zIndex = '2';
  css.domElement.style.pointerEvents = 'auto';
  renderer.domElement.style.pointerEvents = 'none';

  const fill = MOBILE ? num('fill', 0.94) : num('fill', 0.62);
  const pose = player.poseForDock(d, { fill, fov: camera.fov, aspect: camera.aspect });
  player.enabled = false;
  player.moveTo(pose, SHOT ? 0 : 700);

  if (MOBILE && screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }
}

function undock() {
  if (!state.docked) return;
  if (dockObj) { cssScene.remove(dockObj); dockObj.element.remove(); dockObj = null; }
  css.domElement.style.zIndex = '0';
  css.domElement.style.pointerEvents = 'none';
  renderer.domElement.style.pointerEvents = 'auto';
  document.body.classList.remove('docked');

  const d = state.docked;
  state.docked = null;
  const player = state.player;
  // Hand control back straight away and let the step-back play out underneath;
  // moveTo cancels itself the moment the player touches a key.
  player.moveTo(player.poseNear(d, 1.25), 520).then(() => { player.enabled = true; });
  setTimeout(() => { player.enabled = true; }, 700);
  if (MOBILE && screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
}

/* ------------------------------------------------------------------- frame */

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  css.setSize(w, h);
}
addEventListener('resize', resize);

const clock = new THREE.Clock();
let t = 0;

// Adaptive quality: the room is the same on a laptop and a four-year-old phone,
// so rather than guess a device tier, watch the actual frame time and give back
// resolution once if it is not keeping up.
const perf = { samples: [], dropped: false };

function adapt(ms) {
  if (perf.dropped || SHOT) return;
  perf.samples.push(ms);
  if (perf.samples.length < 90) return;
  const avg = perf.samples.reduce((a, b) => a + b, 0) / perf.samples.length;
  perf.samples.length = 0;
  if (avg > 24) {
    perf.dropped = true;
    renderScale *= 0.72;
    renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2) * renderScale);
    resize();
    bloom.strength *= 0.85;
  }
}

function frame() {
  requestAnimationFrame(frame);
  const dt = SHOT ? 1 / 60 : Math.min(0.05, clock.getDelta());
  t += dt;
  const t0 = performance.now();
  renderer.info.reset();

  const player = state.player;
  if (player) {
    player.update(dt);
    if (!state.docked) updateFocus(player);
    state.arcade.update(dt, t, player.pos, { radius: MOBILE ? 8 : 12, hz: MOBILE ? 5 : 8 });
  }
  if (state.arcade && state.arcade.meshes.screens) {
    state.arcade.meshes.screens.material.userData.uniforms.uTime.value = t;
  }
  if (state.hero && !SHOT) state.hero.rotation.y = Math.sin(t * 0.22) * 0.42;

  composer.render();
  css.render(cssScene, camera);

  adapt(performance.now() - t0);
  if (statsEl) stats(performance.now() - t0);
}

/* ------------------------------------------------------------------- stats */

let statsEl = null;
let acc = 0, frames = 0, worst = 0;
function stats(ms) {
  acc += ms; frames++; worst = Math.max(worst, ms);
  if (frames < (SHOT ? 2 : 30)) return;
  const info = renderer.info.render;
  statsEl.textContent =
    `${(acc ? 1000 / (acc / frames) : 0).toFixed(0)} fps  ·  ${(acc / frames).toFixed(1)}ms avg  ·  ${worst.toFixed(1)}ms peak\n` +
    `${info.calls} draws  ·  ${(info.triangles / 1000).toFixed(1)}k tris  ·  ` +
    `${renderer.info.memory.textures} tex  ·  ${renderer.info.memory.geometries} geo\n` +
    `scale ${renderScale.toFixed(2)}  ·  attract ${state.arcade && state.arcade.update.painted || 0}/23 live`;
  acc = 0; frames = 0; worst = 0;
}

/* -------------------------------------------------------------------- boot */

(async () => {
  if (MOBILE) document.body.classList.add('touch', 'coarse');
  resize();
  const { player } = await build();

  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') undock();
    if (e.code === 'KeyE' && !state.docked && state.focus) dock(state.focus);
  });
  el('back').onclick = undock;

  if (flag('stats')) {
    statsEl = el('stats');
    statsEl.style.display = 'block';
  }

  if (SHOT) {
    const pose = TOUR[q.get('pose') || 'entrance'] || TOUR.entrance;
    player.enabled = false;
    player.pos.set(pose.pos[0], floorHeightAt(pose.pos[0], pose.pos[2]), pose.pos[2]);
    const look = new THREE.Vector3(...pose.look);
    const dir = look.clone().sub(new THREE.Vector3(pose.pos[0], pose.pos[1], pose.pos[2]));
    player.yaw = Math.atan2(-dir.x, -dir.z);
    player.pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    document.body.classList.add('bare');
    if (q.has('dock')) {
      const idx = +q.get('dock');
      const d = state.docks[Number.isFinite(idx) ? idx : 0];
      if (d) { player.enabled = true; dock(d); player.enabled = false; }
    }
  }

  if (flag('selftest')) {
    document.body.classList.add('bare');
    const r = selftest({ scene, camera, renderer, state, dock, undock, ROOM, floorHeightAt });
    const pre = el('stats');
    pre.style.cssText += ';display:block;left:16px;top:14px;right:auto;font-size:13px;'
      + 'max-height:96vh;overflow:hidden;color:' + (r.fail ? '#ff8fae' : '#8fffc4');
    pre.textContent = r.text;
    statsEl = null;
    console.log(r.text);
  }

  frame();
  document.body.classList.add('ready');
  state.ready = true;
})();

state.focusProbe = () => nearestDock(state.player);
state.dockObject = () => dockObj;

window.RCADIA = { scene, camera, state, renderer, dock, undock, THREE, TOUR };
