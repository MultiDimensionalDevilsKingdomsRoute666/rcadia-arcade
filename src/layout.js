import * as THREE from 'three';

/**
 * The floor plan, as data.
 *
 * Everything about where things stand lives here: cabinet slots, prop placements,
 * collision blockers and the atrium's raised floor. Rearranging the arcade should
 * be an edit to this file and nothing else.
 *
 * Convention: `rigCabinet` normalises every chassis so its screen faces +Z, so a
 * slot's `yaw` is simply how far to turn it from there.
 */

export const ROOM = {
  w: 28, d: 20,                     // x in [-14, 14], z in [-10, 10]
  h: 4.5,                           // wall height
  atriumR: 3.6,                     // raised disc radius
  atriumRise: 0.25,                 // how far it steps up
  atriumRamp: 0.35,                 // radial distance the step blends over
  coffer: 6.5,                      // ceiling height over the atrium
  spawn: [0, 0, 8.6],               // just inside the entrance, looking -Z
  eye: 1.65,
};

const FACE = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 };

/**
 * Accent pairs, cycled deterministically. Two colours per cabinet: the hot one
 * drives the marquee and trim, the cool one the piping. Enough spread that a row
 * of cabinets never reads as a single blob of pink.
 */
const ACCENTS = [
  ['#ff17c3', '#00c7fe'], ['#00c7fe', '#ff17c3'], ['#f37e3e', '#00c7fe'],
  ['#5cff9d', '#736eb0'], ['#ffd84d', '#ff17c3'], ['#736eb0', '#00c7fe'],
  ['#ff3b6b', '#ffd84d'], ['#00c7fe', '#5cff9d'], ['#ff17c3', '#736eb0'],
  ['#f37e3e', '#ff17c3'], ['#7b5cff', '#00c7fe'],
];

/**
 * Cabinet slots, most prominent first.
 *
 * `rank` is the order games get assigned in — the highest-played game lands at
 * the head of this list. The hero wall reads centre-outwards so the busiest game
 * sits on the sightline you get after rounding the atrium, and the islands go
 * front-to-back so the entrance never faces a dead row.
 */
export function cabinetSlots() {
  const slots = [];

  // hero wall row: 7 cabinets on the north wall looking back at the entrance
  const wallX = [0, -1.8, 1.8, -3.6, 3.6, -5.4, 5.4];   // centre-out
  wallX.forEach((x) => slots.push({ pos: [x, 0, -9.15], yaw: FACE.S, zone: 'wall' }));

  // four back-to-back islands, two cabinets per side
  const islands = [
    [-7.6, 4.2], [7.6, 4.2],      // near the entrance
    [-7.6, -4.2], [7.6, -4.2],    // deeper in
  ];
  islands.forEach(([ix, iz]) => {
    [[+0.46, FACE.E], [-0.46, FACE.W]].forEach(([dx, yaw]) => {
      [-0.52, 0.52].forEach((dz) => {
        slots.push({ pos: [ix + dx, 0, iz + dz], yaw, zone: 'island', island: [ix, iz] });
      });
    });
  });

  return slots.map((s, i) => ({
    ...s,
    rank: i,
    accent: ACCENTS[i % ACCENTS.length][0],
    accent2: ACCENTS[i % ACCENTS.length][1],
    model: 'jtoastie',
  }));
}

/** Island plinths — the low lit base the back-to-back pairs sit on. */
export function islandBases() {
  return [[-7.6, 4.2], [7.6, 4.2], [-7.6, -4.2], [7.6, -4.2]]
    .map(([x, z]) => ({ pos: [x, 0, z], w: 1.9, d: 2.5, h: 0.12 }));
}

export const PROPS = [
  { kind: 'pool',     pos: [-9.6, 0, 5.9],  yaw: 0.18,  glow: '#00c7fe' },
  { kind: 'beerpong', pos: [-6.0, 0, 7.9],  yaw: -0.42, glow: '#ff17c3' },
];

/**
 * Height of the walkable floor at a point.
 *
 * The atrium is a 25cm step. Rather than gate it behind a single ramp — which
 * means a player who approaches from the wrong side hits an invisible wall — the
 * rise blends over the last 35cm of radius, so it steps up smoothly from any
 * direction and never needs a collider.
 */
export function floorHeightAt(x, z) {
  const r = Math.hypot(x, z);
  const { atriumR, atriumRise, atriumRamp } = ROOM;
  if (r > atriumR) return 0;
  if (r < atriumR - atriumRamp) return atriumRise;
  const t = (atriumR - r) / atriumRamp;
  return atriumRise * (t * t * (3 - 2 * t));      // smoothstep
}

/**
 * Axis-aligned blockers for collision. Walls come first (they can never move),
 * then everything the room places. Cabinet boxes get appended at build time once
 * their real footprint is known.
 */
export function staticBlockers() {
  const { w, d } = ROOM;
  const t = 0.5;                                  // wall thickness, pushed outward
  const box = (cx, cz, hw, hd) => ({ cx, cz, hw, hd });
  const out = [
    box(0, -d / 2 - t / 2, w / 2 + t, t / 2),     // north
    box(0,  d / 2 + t / 2, w / 2 + t, t / 2),     // south
    box(-w / 2 - t / 2, 0, t / 2, d / 2 + t),     // west
    box( w / 2 + t / 2, 0, t / 2, d / 2 + t),     // east
  ];
  islandBases().forEach((b) => out.push(box(b.pos[0], b.pos[2], b.w / 2, b.d / 2)));
  // the plinth under the XRP hero
  out.push(box(0, 0, 0.95, 0.95));
  return out;
}

/** Camera poses for the screenshot tour, so shots are comparable across builds. */
export const TOUR = {
  entrance: { pos: [0, 1.65, 8.6],     look: [0, 1.9, 0] },
  atrium:   { pos: [3.4, 1.65, 5.2],   look: [0, 2.6, 0] },
  heroRow:  { pos: [0, 1.65, -5.2],    look: [0, 1.35, -9.2] },
  aisle:    { pos: [-10.6, 1.65, 6.4], look: [-6.2, 1.4, -2.0] },
  lounge:   { pos: [-11.4, 1.65, 8.6], look: [-7.6, 1.0, 5.6] },
  island:   { pos: [-10.2, 1.65, 4.2], look: [-7.6, 1.35, 4.2] },
};

export function slotMatrix(slot, y = 0) {
  const m = new THREE.Matrix4();
  m.makeRotationY(slot.yaw);
  m.setPosition(slot.pos[0], y, slot.pos[2]);
  return m;
}
