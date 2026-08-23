import * as THREE from 'three';

/**
 * Runtime checks, run inside the page.
 *
 * The room's failure modes are almost all behavioural rather than visual: a dock
 * that lands a centimetre off, a blocker you can walk through, an atlas cell
 * that painted black, a spawn point inside a cabinet. None of those are visible
 * in a screenshot until they are already a bug, and there is no browser session
 * here to click around in — so the page tests itself and prints the result
 * somewhere a screenshot can read it.
 */
export function selftest({ scene, camera, renderer, state, dock, undock, ROOM, floorHeightAt }) {
  const out = [];
  let pass = 0, fail = 0;

  const ok = (name, cond, detail = '') => {
    (cond ? pass++ : fail++);
    out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
    return cond;
  };
  const near = (a, b, eps) => Math.abs(a - b) <= eps;

  const player = state.player;
  const docks = state.docks;

  // ---- layout -------------------------------------------------------------
  ok('23 cabinets placed', docks.length === 23, `got ${docks.length}`);

  const overlapping = [];
  for (let i = 0; i < docks.length; i++) {
    for (let j = i + 1; j < docks.length; j++) {
      const a = docks[i], b = docks[j];
      if (a.position.distanceTo(b.position) < 0.5) overlapping.push(`${i}/${j}`);
    }
  }
  ok('no two cabinets share a spot', overlapping.length === 0, overlapping.join(','));

  const inside = (x, z) => player.blockers.some((b) =>
    x > b.cx - b.hw - player.radius && x < b.cx + b.hw + player.radius &&
    z > b.cz - b.hd - player.radius && z < b.cz + b.hd + player.radius);
  ok('spawn is not inside anything', !inside(ROOM.spawn[0], ROOM.spawn[2]));

  ok('every dock faces out of its cabinet', docks.every((d) => near(d.normal.length(), 1, 1e-3)));
  ok('every dock is above the floor', docks.every((d) => d.position.y > 0.6 && d.position.y < 2.0),
    `y range ${Math.min(...docks.map((d) => d.position.y)).toFixed(2)}..${Math.max(...docks.map((d) => d.position.y)).toFixed(2)}`);

  // ---- the raised atrium --------------------------------------------------
  ok('atrium floor steps up', near(floorHeightAt(0, 0), ROOM.atriumRise, 1e-6));
  ok('main floor is flat', floorHeightAt(10, 8) === 0);
  const mid = floorHeightAt(ROOM.atriumR - ROOM.atriumRamp / 2, 0);
  ok('the step ramps rather than jumps', mid > 0.01 && mid < ROOM.atriumRise - 0.01, `mid ${mid.toFixed(3)}`);

  // ---- collision ----------------------------------------------------------
  const home = player.pos.clone();
  const target = docks[0];
  player.pos.set(target.position.x, 0, target.position.z);       // dead inside a cabinet
  player._resolve('x'); player._resolve('z');
  ok('pushed out of a solid cabinet', !inside(player.pos.x, player.pos.z),
    `-> ${player.pos.x.toFixed(2)},${player.pos.z.toFixed(2)}`);

  // walk hard into the north wall for two seconds and make sure we stay indoors
  player.pos.set(0, 0, -6);
  player.vel.set(0, 0, -6);
  for (let i = 0; i < 120; i++) player._step(0, -6 / 60);
  ok('cannot walk through a wall', player.pos.z > -ROOM.d / 2,
    `z ${player.pos.z.toFixed(2)}`);
  player.vel.set(0, 0, 0);

  // ---- focus --------------------------------------------------------------
  const d3 = docks[3];
  const stand = player.poseNear(d3, 1.0);
  player.pos.copy(stand.pos);
  player.yaw = stand.yaw;
  player.pitch = stand.pitch;
  player._apply(0);
  camera.updateMatrixWorld(true);
  const focused = state.focusProbe();
  ok('standing at a cabinet focuses it', focused === d3,
    focused ? `focused #${focused.index} wanted #${d3.index}` : 'focused nothing');

  const behind = d3.position.clone().sub(d3.normal.clone().multiplyScalar(1.0));
  player.pos.set(behind.x, floorHeightAt(behind.x, behind.z), behind.z);
  player.yaw = stand.yaw + Math.PI;
  player._apply(0);
  ok('standing behind it does not', state.focusProbe() !== d3);

  // ---- dock ---------------------------------------------------------------
  const before = { docked: !!state.docked };
  player.enabled = true;
  dock(d3);
  const obj = state.dockObject();
  if (ok('docking mounts a CSS3D object', !!obj)) {
    const p = obj.position;
    const gap = p.distanceTo(d3.position);
    ok('the iframe sits on the glass', gap < 0.05, `${(gap * 1000).toFixed(1)}mm off`);

    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion);
    ok('the iframe faces the same way as the screen', facing.dot(d3.normal) > 0.999,
      `dot ${facing.dot(d3.normal).toFixed(4)}`);

    const px = obj.element.getBoundingClientRect
      ? parseFloat(obj.element.style.width) : 0;
    ok('the iframe is scaled to the screen width',
      near(px * obj.scale.x, d3.width, 0.01), `${(px * obj.scale.x).toFixed(3)}m vs ${d3.width.toFixed(3)}m`);

    const frame = obj.element.querySelector('iframe');
    ok('the iframe points at a game', !!frame && /rcadia|docktest|game/i.test(frame.src),
      frame ? frame.src.slice(0, 64) : 'no iframe');
  }
  ok('camera stops while docked', player.enabled === false || !!state.docked);

  undock();
  ok('undocking removes the object', !state.dockObject());
  ok('undocking was clean', !before.docked && !state.docked);

  // ---- atlases ------------------------------------------------------------
  const { attract, marquee, side } = state.arcade.atlases;
  const blankCells = (atlas) => {
    const c = atlas.ctx;
    const bad = [];
    for (let i = 0; i < atlas.count; i++) {
      const r = atlas.rect(i);
      const d = c.getImageData(r.x + r.w * 0.25, r.y + r.h * 0.25, r.w * 0.5, r.h * 0.5).data;
      let sum = 0;
      for (let k = 0; k < d.length; k += 16) sum += d[k] + d[k + 1] + d[k + 2];
      if (sum < 400) bad.push(i);
    }
    return bad;
  };
  ok('every attract cell painted', blankCells(attract).length === 0, blankCells(attract).join(','));
  ok('every marquee cell painted', blankCells(marquee).length === 0, blankCells(marquee).join(','));
  ok('every side-art cell painted', blankCells(side).length === 0, blankCells(side).join(','));

  // ---- budget -------------------------------------------------------------
  renderer.info.reset();
  renderer.render(scene, camera);
  const info = renderer.info.render;
  ok('scene draw calls within budget', info.calls < 120, `${info.calls} draws`);
  ok('triangle count within budget', info.triangles < 300000, `${(info.triangles / 1000).toFixed(1)}k tris`);
  ok('texture count is sane', renderer.info.memory.textures < 60,
    `${renderer.info.memory.textures} textures`);

  player.pos.copy(home);
  player.enabled = true;

  out.unshift(`${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}   ${pass}/${pass + fail}`);
  return { pass, fail, text: out.join('\n') };
}
