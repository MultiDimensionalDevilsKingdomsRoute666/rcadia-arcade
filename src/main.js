import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';

import { loadGLB, rigCabinet } from './cabinet.js';
import { makeMarquee, makeSideArt, makeAttract, PALETTE } from './art.js';

RectAreaLightUniformsLib.init();

const q = new URLSearchParams(location.search);
const SHOT = q.get('shot') === '1';
if (SHOT) document.body.classList.add('shot');
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
const BASE = q.get('base') || '.';

const GAMES = [
  { slug: 'crypto-crush',    title: 'Crypto Crush',    accent: PALETTE.PINK,   accent2: PALETTE.BLUE },
  { slug: 'macro-machines',  title: 'Macro Machines',  accent: PALETTE.ORANGE, accent2: PALETTE.BLUE },
  { slug: 'flappy-bird',     title: 'Flappy Bird',     accent: '#ffd84d',      accent2: PALETTE.PINK },
  { slug: 'resurexion',      title: 'Resurexion',      accent: '#ff3b3b',      accent2: PALETTE.PURPLE },
  { slug: 'genesis-pinball', title: 'Genesis Pinball', accent: PALETTE.BLUE,   accent2: PALETTE.PINK },
  { slug: 'ufo-confirmed',   title: 'UFO Confirmed',   accent: '#5cff9d',      accent2: PALETTE.BLUE },
];
const MODELS = {
  jtoastie: `${BASE}/assets/cabinet-jtoastie.glb`,
  burunduk: `${BASE}/assets/cabinet-burunduk.glb`,
};

// ---------------------------------------------------------------- renderer
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exp', 1.2);
renderer.domElement.className = 'gl';
app.appendChild(renderer.domElement);

const css = new CSS3DRenderer();
css.domElement.className = 'css3d';
app.appendChild(css.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05050a);
scene.fog = new THREE.FogExp2(0x05050a, 0.055);

const cssScene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
camera.position.set(1.30, 1.30, 2.05);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.05, 0);
controls.enableDamping = true;
controls.minDistance = 0.9;
controls.maxDistance = 9;
controls.maxPolarAngle = Math.PI * 0.52;

// ---------------------------------------------------------------- room
// three r155+ lights are in physical units — candela / lumens, not the old
// 0..1 scale. Everything here is deliberately large.
scene.add(new THREE.AmbientLight(0x3a3550, num('amb', 0.50)));
scene.add(new THREE.HemisphereLight(0x4a5aa0, 0x120f1c, num('hemi', 0.20)));

const key = new THREE.SpotLight(0xf2f6ff, num('key', 300), 16, 0.75, 0.6, 1.1);
key.position.set(2.2, 4.2, 2.8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0012;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);

const fill = new THREE.DirectionalLight(0x8f9dd8, num('fill', 0.35));
fill.position.set(-2.5, 2.6, 2.2);
scene.add(fill);

// the two colour washes that make the room read as an arcade and not a garage
const rimA = new THREE.PointLight(PALETTE.PINK, num('rim', 100), 9, 1.8);
rimA.position.set(-1.9, 1.75, -1.1);
const rimB = new THREE.PointLight(PALETTE.BLUE, num('rim', 100), 9, 1.8);
rimB.position.set(2.1, 1.55, -1.4);
const back = new THREE.PointLight(0x9b6bff, num('back', 45), 8, 1.8);
back.position.set(0, 2.5, -2.0);
scene.add(rimA, rimB, back);

const floor = new Reflector(new THREE.PlaneGeometry(40, 40), {
  clipBias: 0.003,
  textureWidth: 1024,
  textureHeight: 1024,
  color: 0x14121c,
});
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0.001;
if (q.get('noref') !== '1') scene.add(floor);

const grid = new THREE.GridHelper(40, 80, 0x2a2440, 0x161226);
grid.material.opacity = 0.35;
grid.material.transparent = true;
grid.position.y = 0.004;
scene.add(grid);

// ---------------------------------------------------------------- composer
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), num('bloom', 1.0), num('bloomr', 0.60), num('bloomt', 12.0));
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- cabinet
const state = {
  model: q.get('model') || 'jtoastie',
  game: Math.max(0, GAMES.findIndex((g) => g.slug === (q.get('game') || 'crypto-crush'))),
  docked: false,
  attract: null,
  cab: null,
  raw: {},
};

async function image(url) {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}

async function buildCabinet() {
  if (state.cab) {
    scene.remove(state.cab);
    state.cab.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose && m.dispose());
    });
    state.cab = null;
  }
  undock();

  const g = GAMES[state.game];
  const url = MODELS[state.model];
  if (!state.raw[url]) state.raw[url] = (await loadGLB(url)).scene;

  const im = await image(`${BASE}/assets/games/${g.slug}.png`);
  const attract = makeAttract(g.title, im, { accent: g.accent, accent2: g.accent2 });
  state.attract = attract;

  const cab = rigCabinet(state.raw[url], {
    height: 1.8,
    accent: new THREE.Color(g.accent).getHex(),
    accent2: new THREE.Color(g.accent2).getHex(),
    screenTexture: attract.texture,
    screenAspect: 1,
    emissive: { accentGlow: num('eacc', 2.0), trimGlow: num('etrim', 0.25) },
    marqueeGlow: num('emq', 1.6),
    screenLight: num('escr', 8),
    marqueeLight: num('emql', 10),
    marqueeTexture: makeMarquee(g.title, { accent: g.accent, accent2: g.accent2 }),
    sideTexture: makeSideArt(g.title, im, { accent: g.accent, accent2: g.accent2 }),
  });
  scene.add(cab);
  state.cab = cab;

  key.target.position.set(0, 1.2, 0);
  document.getElementById('caption').textContent =
    `${g.title} · ${state.model} · ${cab.userData.dock ? `screen ${cab.userData.dock.width.toFixed(2)}×${cab.userData.dock.height.toFixed(2)}m` : 'no screen mesh'}`;
  return cab;
}

// ------------------------------------------------- CSS3D dock (live iframe)
// The proof that a real, playable game can live on the cabinet glass: an
// <iframe> transformed into the scene by CSS3DRenderer, with a NoBlending
// plane punching a transparent hole through the WebGL layer in front of it.
let dockObj = null;

function dockGame() {
  const cab = state.cab;
  if (!cab || !cab.userData.dock || state.docked) return;
  const { dock, screen } = cab.userData;
  const g = GAMES[state.game];

  const PX = 700;                       // iframe pixel size
  const scale = dock.width / PX;

  const wrap = document.createElement('div');
  wrap.className = 'dock';
  wrap.style.width = `${PX}px`;
  wrap.style.height = `${PX}px`;
  const frame = document.createElement('iframe');
  frame.src = q.get('dockurl') || `https://www.rcadia.xyz/api/game-proxy/${g.slug}/index.html`;
  frame.style.width = '100%';
  frame.style.height = '100%';
  frame.style.border = '0';
  wrap.appendChild(frame);

  dockObj = new CSS3DObject(wrap);
  screen.updateWorldMatrix(true, false);
  dockObj.position.copy(dock.position).add(dock.normal.clone().multiplyScalar(0.006));
  dockObj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dock.normal);
  dockObj.scale.setScalar(scale);
  cssScene.add(dockObj);

  screen.visible = false;

  // lift the CSS3D layer above the GL canvas and let clicks/keys reach the game
  css.domElement.style.zIndex = '2';
  css.domElement.style.pointerEvents = 'auto';
  renderer.domElement.style.pointerEvents = 'none';
  controls.enabled = false;
  state.docked = true;
  document.body.classList.add('docked');
}

function undock() {
  if (dockObj) { cssScene.remove(dockObj); dockObj.element.remove(); dockObj = null; }
  if (state.cab && state.cab.userData.screen) state.cab.userData.screen.visible = true;
  css.domElement.style.zIndex = '0';
  css.domElement.style.pointerEvents = 'none';
  renderer.domElement.style.pointerEvents = 'auto';
  controls.enabled = true;
  state.docked = false;
  document.body.classList.remove('docked');
}

// ---------------------------------------------------------------- controls
function ui() {
  const gameSel = document.getElementById('game');
  GAMES.forEach((g, i) => gameSel.add(new Option(g.title, String(i))));
  gameSel.value = String(state.game);
  gameSel.onchange = () => { state.game = +gameSel.value; buildCabinet(); };

  const modelSel = document.getElementById('modelsel');
  Object.keys(MODELS).forEach((k) => modelSel.add(new Option(k, k)));
  modelSel.value = state.model;
  modelSel.onchange = () => { state.model = modelSel.value; buildCabinet(); };

  document.getElementById('dock').onclick = () => (state.docked ? undock() : dockGame());
  document.getElementById('wire').onclick = () => {
    const cab = state.cab; if (!cab) return;
    cab.traverse((o) => { if (o.isMesh && o.material && 'wireframe' in o.material) o.material.wireframe = !o.material.wireframe; });
  };
  const bl = document.getElementById('bloom');
  bl.value = String(bloom.strength);
  bl.oninput = () => { bloom.strength = +bl.value; };

  const cv = document.getElementById('curve');
  cv.oninput = () => {
    const u = state.cab && state.cab.userData.crt && state.cab.userData.crt.userData.uniforms;
    if (u) u.uCurve.value = +cv.value;
  };
  addEventListener('keydown', (e) => { if (e.key === 'Escape') undock(); });
}

// ---------------------------------------------------------------- loop
function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  css.setSize(w, h);
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let t = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = SHOT ? 1 / 60 : clock.getDelta();
  t += dt;

  if (state.attract && (!SHOT || t < 0.2)) state.attract.draw(t);
  const u = state.cab && state.cab.userData.crt && state.cab.userData.crt.userData.uniforms;
  if (u) u.uTime.value = t;

  if (!SHOT) controls.update();
  composer.render();
  css.render(cssScene, camera);
}

(async () => {
  ui();
  await buildCabinet();
  if (SHOT) {
    camera.position.set(
      +(q.get('cx') ?? 1.9), +(q.get('cy') ?? 1.55), +(q.get('cz') ?? 2.9)
    );
    camera.lookAt(0, 1.05, 0);
    document.getElementById('panel').style.display = 'none';
    if (q.get('dock') === '1') dockGame();
  }
  frame();
  document.body.classList.add('ready');
})();

// expose for headless probing
window.RCADIA = { scene, camera, state, dockGame, undock, THREE };

if (q.get('dbg') === '1') {
  setTimeout(() => {
    const cab = state.cab; if (!cab) return console.log('DBG no cab');
    const mq = cab.userData.decals.marquee;
    const sc = cab.userData.screen;
    const n = new THREE.Vector3();
    const out = [];
    const rep = (label, o) => {
      if (!o) return out.push(`${label}: MISSING`);
      o.updateWorldMatrix(true, false);
      o.getWorldDirection(n);
      const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      const sc3 = new THREE.Vector3().setFromMatrixScale(o.matrixWorld);
      out.push(`${label}: pos=(${p.toArray().map(v=>v.toFixed(2))}) fwd=(${n.toArray().map(v=>v.toFixed(2))}) scale=(${sc3.toArray().map(v=>v.toFixed(3))}) det=${o.matrixWorld.determinant().toFixed(3)}`);
    };
    rep('marquee', mq); rep('screen', sc); rep('root', cab.children[0]);
    const bb = new THREE.Box3().setFromObject(cab.children[0]);
    out.push(`rootBox min=(${bb.min.toArray().map(v=>v.toFixed(2))}) max=(${bb.max.toArray().map(v=>v.toFixed(2))})`);
    const sb = sc ? new THREE.Box3().setFromObject(sc) : null;
    if (sb) out.push(`screenBox min=(${sb.min.toArray().map(v=>v.toFixed(2))}) max=(${sb.max.toArray().map(v=>v.toFixed(2))})`);
    out.push(`screenName="${sc && sc.name}" matName="${sc && sc.material && sc.material.name}"`);
    out.push(`decals=${Object.keys(cab.userData.decals).join(',') || 'NONE'}`);
    const dk = cab.userData.dock;
    if (dk) out.push(`dock.normal=(${dk.normal.toArray().map(v=>v.toFixed(3))}) dock.pos=(${dk.position.toArray().map(v=>v.toFixed(2))}) w=${dk.width.toFixed(2)} h=${dk.height.toFixed(2)}`);
    out.push(`rootRotY=${(cab.children[0].rotation.y*180/Math.PI).toFixed(1)}deg`);
    out.push(`cam=(${camera.position.toArray().map(v=>v.toFixed(2))}) projDet=${camera.projectionMatrix.determinant().toFixed(4)}`);
    // check uv range on the screen mesh
    if (sc && sc.geometry.getAttribute('uv')) {
      const uv = sc.geometry.getAttribute('uv');
      const us=[],vs=[];
      for (let i=0;i<uv.count;i++){us.push(+uv.getX(i).toFixed(2));vs.push(+uv.getY(i).toFixed(2));}
      out.push(`screen uv u=[${us}] v=[${vs}]`);
      const pos = sc.geometry.getAttribute('position');
      const xs=[]; for(let i=0;i<pos.count;i++) xs.push(pos.getX(i).toFixed(2)+'/'+pos.getZ(i).toFixed(2));
      out.push(`screen local x/z=[${xs}]`);
    }
    console.log('DBG ' + out.join(' || '));
  }, 1200);
}
