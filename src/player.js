import * as THREE from 'three';

/**
 * Walking the arcade, on a desk or in a hand.
 *
 * Desktop gets WASD and mouse look, with pointer lock as an upgrade rather than
 * a gate — a page that opens on "click to enable controls" is a page nobody
 * looks at. Touch gets a thumb stick on the left, look-drag on the right, and,
 * more importantly, tap-to-approach: on a phone the reliable way to reach a
 * cabinet is to point at it, not to steer to it.
 *
 * Collision is circle-versus-AABB against a static list. There is no physics
 * engine here and there should not be: the room is boxes on a plane, the player
 * cannot jump, and the atrium's step is solved by the floor being a height
 * function rather than by a collider.
 */

const TAP_MS = 260;
const TAP_PX = 14;

export class Player {
  constructor(camera, { dom, blockers = [], floorHeightAt = () => 0, eye = 1.65 } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.blockers = blockers;
    this.floorHeightAt = floorHeightAt;
    this.eye = eye;

    this.pos = new THREE.Vector3(0, 0, 8.6);
    this.vel = new THREE.Vector3();
    this.yaw = 0;                       // yaw 0 looks down -Z, into the room
    this.pitch = 0;
    this.radius = 0.34;
    this.speed = 3.1;
    this.run = 1.7;
    this.bob = 0;
    this.enabled = true;
    this.touch = matchMedia('(pointer: coarse)').matches;

    this.keys = new Set();
    this.stick = null;                  // { id, ox, oy, x, y }
    this.look = null;                   // { id, x, y }
    this.tween = null;
    this.onTap = null;                  // (ndc) => void
    this.onStick = null;                // (stick | null) => void, for the on-screen ring

    this._bind();
  }

  /* ------------------------------------------------------------- input */

  _bind() {
    const d = this.dom;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD'
        || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    }, { passive: false });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // ---- mouse ---------------------------------------------------------
    let dragging = false, lx = 0, ly = 0, downAt = 0, moved = 0;
    d.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true; lx = e.clientX; ly = e.clientY; downAt = performance.now(); moved = 0;
    });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === d) { this._turn(e.movementX, e.movementY); return; }
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      this._turn(dx, dy);
    });
    addEventListener('mouseup', (e) => {
      if (!dragging) return;
      dragging = false;
      // A click that did not drag is a click, and should select what it hit.
      if (performance.now() - downAt < TAP_MS * 1.6 && moved < TAP_PX && this.onTap) {
        this.onTap(this._ndc(e.clientX, e.clientY));
      }
    });
    d.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---- touch ---------------------------------------------------------
    d.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const left = t.clientX < innerWidth * 0.42;
        if (left && !this.stick) {
          this.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 };
          if (this.onStick) this.onStick(this.stick);
        } else if (!this.look) {
          this.look = { id: t.identifier, x: t.clientX, y: t.clientY, at: performance.now(), moved: 0 };
        }
      }
    }, { passive: true });

    d.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (this.stick && t.identifier === this.stick.id) {
          const R = 58;
          this.stick.x = clamp((t.clientX - this.stick.ox) / R, -1, 1);
          this.stick.y = clamp((t.clientY - this.stick.oy) / R, -1, 1);
          if (this.onStick) this.onStick(this.stick);
        } else if (this.look && t.identifier === this.look.id) {
          const dx = t.clientX - this.look.x, dy = t.clientY - this.look.y;
          this.look.x = t.clientX; this.look.y = t.clientY;
          this.look.moved += Math.abs(dx) + Math.abs(dy);
          this._turn(dx * 1.35, dy * 1.35);
        }
      }
    }, { passive: true });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this.stick && t.identifier === this.stick.id) {
          this.stick = null;
          if (this.onStick) this.onStick(null);
        }
        if (this.look && t.identifier === this.look.id) {
          const quick = performance.now() - this.look.at < TAP_MS && this.look.moved < TAP_PX;
          if (quick && this.onTap) this.onTap(this._ndc(t.clientX, t.clientY));
          this.look = null;
        }
      }
    };
    d.addEventListener('touchend', end, { passive: true });
    d.addEventListener('touchcancel', end, { passive: true });
  }

  _ndc(px, py) {
    const r = this.dom.getBoundingClientRect();
    return new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
  }

  _turn(dx, dy) {
    if (!this.enabled || this.tween) return;
    const k = 0.0026;
    this.yaw -= dx * k;
    this.pitch = clamp(this.pitch - dy * k, -1.15, 1.05);
  }

  requestPointerLock() {
    if (!this.touch && this.dom.requestPointerLock) this.dom.requestPointerLock();
  }

  /* ------------------------------------------------------------ motion */

  /**
   * Glide to a pose. Used by tap-to-approach and by docking.
   *
   * A zero duration applies the pose on the spot and resolves. Tweens only
   * advance from inside update(), so anything that awaits a move before the
   * render loop is running — a headless shot that docks during boot, say —
   * would otherwise wait forever for a frame that never comes.
   */
  moveTo({ pos, yaw, pitch = 0 }, ms = 700) {
    if (ms <= 0) {
      this.pos.copy(pos);
      this.yaw = shortestYaw(this.yaw, yaw);
      this.pitch = pitch;
      this._apply(0);
      return Promise.resolve();
    }
    return new Promise((done) => {
      this.tween = {
        from: { pos: this.pos.clone(), yaw: this.yaw, pitch: this.pitch },
        to: { pos: pos.clone(), yaw: shortestYaw(this.yaw, yaw), pitch },
        t: 0, dur: ms / 1000, done,
      };
    });
  }

  cancelTween() {
    if (this.tween) { this.tween.done(); this.tween = null; }
  }

  update(dt) {
    if (this.tween) {
      const w = this.tween;
      w.t = Math.min(1, w.t + dt / w.dur);
      const e = 1 - Math.pow(1 - w.t, 3);
      this.pos.lerpVectors(w.from.pos, w.to.pos, e);
      this.yaw = w.from.yaw + (w.to.yaw - w.from.yaw) * e;
      this.pitch = w.from.pitch + (w.to.pitch - w.from.pitch) * e;
      if (w.t >= 1) { w.done(); this.tween = null; }
      this._apply(0);
      return;
    }

    if (!this.enabled) { this._apply(0); return; }

    let fwd = 0, strafe = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) strafe -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) strafe += 1;
    if (this.stick) { strafe += this.stick.x; fwd -= this.stick.y; }

    const len = Math.hypot(fwd, strafe);
    if (len > 1) { fwd /= len; strafe /= len; }

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? this.run : 1;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = new THREE.Vector3(
      (-sin * fwd + cos * strafe) * this.speed * sprint,
      0,
      (-cos * fwd - sin * strafe) * this.speed * sprint
    );

    // critically-damped-ish smoothing, so starts and stops are not instant
    this.vel.lerp(wish, Math.min(1, dt * 13));
    if (this.vel.lengthSq() < 1e-5) this.vel.set(0, 0, 0);

    this._step(this.vel.x * dt, this.vel.z * dt);
    this._apply(dt);
  }

  /**
   * Move and slide.
   *
   * Each axis is resolved on its own so that walking into a cabinet at an angle
   * slides along it instead of stopping dead — the single difference between a
   * room that feels navigable and one that feels like a maze of glue.
   */
  _step(dx, dz) {
    this.pos.x += dx;
    this._resolve('x');
    this.pos.z += dz;
    this._resolve('z');
  }

  _resolve(axis) {
    const r = this.radius;
    for (const b of this.blockers) {
      const nx = clamp(this.pos.x, b.cx - b.hw, b.cx + b.hw);
      const nz = clamp(this.pos.z, b.cz - b.hd, b.cz + b.hd);
      const dx = this.pos.x - nx, dz = this.pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        if (axis === 'x') this.pos.x = nx + (dx / d) * r;
        else this.pos.z = nz + (dz / d) * r;
      } else {
        // dead centre inside the box: back out the way we came
        if (axis === 'x') this.pos.x = this.pos.x < b.cx ? b.cx - b.hw - r : b.cx + b.hw + r;
        else this.pos.z = this.pos.z < b.cz ? b.cz - b.hd - r : b.cz + b.hd + r;
      }
    }
  }

  _apply(dt) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * speed * 2.4;
    const bobY = Math.sin(this.bob * 2) * 0.017 * Math.min(1, speed / 2.5);
    const bobX = Math.cos(this.bob) * 0.012 * Math.min(1, speed / 2.5);

    const ground = this.floorHeightAt(this.pos.x, this.pos.z);
    this.pos.y += (ground - this.pos.y) * Math.min(1, dt * 12 || 1);

    this.camera.position.set(this.pos.x + bobX * Math.cos(this.yaw), this.pos.y + this.eye + bobY,
      this.pos.z - bobX * Math.sin(this.yaw));
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }

  /** Where the camera would need to stand for `dock` to fill the view. */
  poseForDock(dock, { fill = 0.6, fov, aspect }) {
    const vfov = THREE.MathUtils.degToRad(fov);
    const byH = (dock.height / 2) / Math.tan(vfov / 2) / fill;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const byW = (dock.width / 2) / Math.tan(hfov / 2) / fill;
    const dist = Math.max(byH, byW);

    const eyeAt = dock.position.clone().add(dock.normal.clone().multiplyScalar(dist));
    const ground = this.floorHeightAt(eyeAt.x, eyeAt.z);
    return {
      pos: new THREE.Vector3(eyeAt.x, ground, eyeAt.z),
      yaw: Math.atan2(dock.normal.x, dock.normal.z),
      pitch: Math.atan2(dock.position.y - (ground + this.eye), dist),
      dist,
    };
  }

  /** Standing position for walking up to a cabinet, one step back from play range. */
  poseNear(dock, distance = 1.05) {
    const p = dock.position.clone().add(dock.normal.clone().multiplyScalar(distance));
    const ground = this.floorHeightAt(p.x, p.z);
    return {
      pos: new THREE.Vector3(p.x, ground, p.z),
      yaw: Math.atan2(dock.normal.x, dock.normal.z),
      pitch: Math.atan2(dock.position.y - (ground + this.eye), distance),
    };
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** Pick the equivalent angle nearest the current one, so turns take the short way. */
function shortestYaw(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}
