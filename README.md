# RCADIA — a walkable XRPL arcade

> Build needs Node 18+ and `rsync`.

A 3D arcade you walk around, where **every cabinet plays the real game** hosted on
rcadia.xyz. Twenty-three machines, an XRP hero sign, a lounge, and a carpet that
has no business being this accurate.

```bash
npm i && ./build.sh && npm start      # http://localhost:8299
```

Assets are committed, so a fresh clone runs as-is. To re-pull the game list and
cover art from the live API: `./scripts/fetch-assets.sh`.

Two pages come out of `dist/`:

| | |
|---|---|
| `index.html` | the arcade floor |
| `rig.html`   | the Phase 1 single-cabinet lab, still the fastest way to tune a chassis |

---

## The one idea everything hangs off

**An iframe can never become a WebGL texture.** No browser will let one document
read another's rendered pixels, so a game cannot be painted onto a 3D surface the
normal way. `CSS3DRenderer` is the only route: it transforms a real DOM element
with the same projection matrix the WebGL camera uses, so an `<iframe>` sits on
the cabinet glass, perspective-correct, and is genuinely playable.

RCADIA's games are already proxied same-origin through `/api/game-proxy/*` (done
originally for mobile Safari postMessage), which means **the tournament and agent
SDKs work through the dock unchanged**. That was the single luckiest thing about
this project.

What it costs: one docked cabinet at a time, and the CSS3D layer has to be lifted
above the GL canvas while docked. Undocked cabinets run an attract loop in
ordinary WebGL and occlude correctly, so the floor still reads right.

---

## Twenty-three cabinets, sixty draw calls

Scaling Phase 1 naively — every cabinet its own materials, its own screen light,
its own marquee bar — is roughly 250 draw calls and 46 dynamic lights. That is
unshippable on a phone. Three decisions fix it, and each one also makes the room
look *better*, because the budget goes to the effects that actually sell a dark
neon space.

**Merge, don't instance.** Cabinets never move, so `chassisTemplate()` returns
raw geometry in cabinet-local space sorted into five roles, and `buildArcade()`
bakes each slot's transform into a copy and merges the lot. Per-cabinet colour
rides in as a vertex attribute. Merging beats instancing for static geometry, and
it sidesteps the fact that three will not drive `emissive` from `instanceColor`.

**One atlas per art type.** Twenty-three attract screens, twenty-three marquees
and forty-six side panels would be ninety-two textures and ninety-two draws.
Packed into three atlases they are three of each, and the quads that sample them
merge into single meshes. The CRT shader carries the cell as a `vec4` vertex
attribute so the barrel distortion happens in the quad's *local* UV and only then
maps into the cell — curving an atlas coordinate directly bends the sample
straight into the neighbouring game's artwork.

**Fake the lights.** Five real lights in the whole arcade. Everything else is
emissive material plus bloom, plus a merged sheet of additive radial quads on the
floor — one per cabinet, tinted to its accent — which is what the eye actually
reads as "that machine is glowing". Blob shadows replace the shadow map entirely.

Measured, not asserted (`?stats=1`): **60 draws / 49k tris for the whole frame
including post**, 19 draws for the scene alone, 13 textures.

---

## Verifying it

Everything is checked headlessly; there is no click-around step.

```bash
./scripts/tour.sh                 # all six poses, tiled into /tmp/tour.png with per-shot means
./scripts/tour.sh "bloom=1.4"     # ...with any URL override applied
OUT=/tmp/x.png ./scripts/shot.sh "shot=1&pose=atrium&stats=1"
```

**`?selftest=1` is the real gate.** The room's failure modes are behavioural, not
visual — a dock a centimetre off, a blocker you can walk through, an atlas cell
that painted black, a spawn point inside a cabinet. None of those show up in a
screenshot until they are already a bug. So the page tests itself and prints the
result where a screenshot can read it:

```bash
OUT=/tmp/st.png ./scripts/shot.sh "shot=1&selftest=1&dockurl=/assets/docktest.html"
# ALL PASS 26/26 — including "the iframe sits on the glass  8.0mm off"
#                            "the iframe faces the same way as the screen  dot 1.0000"
#                            "the iframe is scaled to the screen width  0.537m vs 0.537m"
```

Judge exposure **numerically** (`PIL.ImageStat`), never by eye on a contact
sheet — downscaled thumbnails read far brighter than the real frame, which cost
two wrong calls in Phase 1. A good frame means ~20–35.

Every large contributor to the look has a URL kill switch, because "the floor
went brown" is a question about which of six overlapping things did it:
`?noenv=1 ?noneon=1 ?nofix=1 ?nopool=1 ?nohero=1 ?nofog=1`. That bisect found the
light-cone gradient in four shots.

Lights, bloom, fog and exposure are all URL parameters (`?bloom= ?bloomt= ?amb=
?hemi= ?dir= ?pwall= ?exp= ?fogn=`), so the whole look is tunable from one build.

---

## Traps, all paid for in full

- **`alpha: true` on the renderer silently breaks `UnrealBloomPass`.** Every
  bloom>0 frame loses its base render and becomes an all-blur wash.
- **`ConeGeometry`'s V runs 0 at the wide base, and textures upload flipped.** The
  light shafts were at full strength where they met the floor and transparent at
  the lamp — exactly backwards — which washed the entire carpet warm brown.
- **`DoubleSide` on an additive cone** blends its near and far walls, doubling a
  shaft you are meant to see through.
- **`normalizeScreenUVs` calls `updateWorldMatrix`**, which rebuilds `matrixWorld`
  from the mesh's own transform. Handing it a bare mesh with the real matrix
  copied in silently loses that matrix, and every screen renders as rainbow
  stripes. Bake into local space *first*, then rewrite UVs against identity.
- **A quad rotated into place has an axis-aligned bounding box, not a
  panel-aligned one.** One axis collapses to zero and the aspect ratio becomes
  `Infinity`. Quads carry their own `{w, h}`.
- **A near-mirror floor under a point light** puts the whole specular lobe in one
  spot and ACES cannot hold it. Roughen the floor, not the light.
- **`renderer.info` resets on every `render()` call**, so reading it after the
  composer reports only the last fullscreen pass. `autoReset = false`.
- **Awaiting a camera tween before mounting the iframe** makes docking hostage to
  the render loop. Background the tab mid-approach and rAF stops, the tween never
  finishes, and the player is frozen in front of a cabinet that never turns on.
  Mount first, fly in second — CSS3D re-projects every frame anyway, so the
  iframe stays glued to the glass the whole way in.
- **Lights are physical units** since three r155 — candela, not 0..1.
- **No network fetches in the page.** Chrome's `--virtual-time-budget` stalls
  indefinitely on any outstanding request, which is why Google Fonts are named in
  the CSS but never loaded and why every asset is fetched at build time.
- **Never pass `--disable-gpu` to headless Chrome** on a WebGL page. It hangs.

---

## Layout

`src/layout.js` is the whole floor plan as data. 28 x 20m, walls at `x=±14 /
z=±10`, ceiling 4.5m with the atrium coffered to 6.5m.

- **Atrium** at the origin: a 3.6m disc stepped up 25cm, XRP mark inlaid glowing
  in the terrazzo, 2.1m extruded logo on a plinth under a lit well. The rise
  blends over the last 35cm of radius rather than hiding behind a single ramp, so
  it steps up smoothly from any direction and needs no collider at all.
- **Hero wall**: 7 cabinets on the north wall, the seven most-played games,
  centre-out — so the busiest game sits on the sightline you get after rounding
  the atrium.
- **Four islands**: 4 cabinets each, back-to-back, 2 per side.
- **Lounge**: pool table and beer pong, southwest.

Games are assigned by `playCount` descending from the live API snapshot in
`assets/games.json`.

## Movement

Eye height 1.65m, 3.1 m/s, head bob, shift to run. Desktop is WASD plus
drag-to-look, with pointer lock as an *upgrade* rather than a gate — a page that
opens on "click to enable controls" is a page nobody looks at. Touch gets a stick
that appears wherever the thumb lands (the only kind that works when you cannot
see your own hand), look-drag on the right, and **tap a cabinet to walk to it**,
which matters more on a phone than the stick does.

Collision is circle-versus-AABB with per-axis resolution, so walking into a
cabinet at an angle slides along it instead of stopping dead. No physics engine.

---

## Known gaps

- **Cabinet art is procedural.** All 23 games point `verticalImageUrl` at the same
  `OgImage.png` at wildly different aspect ratios (1895x1063 next to 667x666), and
  `rdos3k` has none at all — hence `coverFit` and a generated fallback tile. Real
  per-game marquee and side art is its own pass.
- **burunduk's chassis** loads and themes but is a canopy machine, not an upright;
  its protruding front catches the marquee raycast, so it needs per-model art
  anchors before it can go on the floor. It lives in `rig.html` only.
- **No audio.** Deliberate; `sound.js` should drop in without restructuring.
- **Not mounted into the Next.js app** — this stays standalone, same as Phase 1.

## Licences

Cabinet and table models are **CC-BY 3.0** and the credit line in the page is a
licence condition, not decoration. See [ATTRIBUTION.md](ATTRIBUTION.md).
