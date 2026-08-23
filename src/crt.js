import * as THREE from 'three';

/**
 * CRT screen material. Takes any map (CanvasTexture / VideoTexture / Texture)
 * and sells it as a curved phosphor tube: barrel distortion, scanlines,
 * aperture-grille mask, vignette, bezel falloff.
 *
 * The uniforms are all live-tweakable — the harness GUI drives them directly.
 *
 * Two modes. On a lone cabinet the map is that cabinet's screen and `uv` is the
 * quad's own 0..1. In the arcade every screen is one cell of a shared atlas and
 * all twenty-three quads are merged into a single mesh, so `opts.atlas` switches
 * on two extra vertex attributes:
 *
 *   aCell  vec4  the cell's (offsetU, offsetV, scaleU, scaleV) in the atlas
 *   aIdx   float which cabinet this quad belongs to, for the focus highlight
 *
 * The barrel distortion has to happen in the quad's *local* UV and only then be
 * mapped into the cell — curving an atlas coordinate directly would bend the
 * sample straight into the neighbouring game's artwork.
 */
export function makeCrtMaterial(map, opts = {}) {
  const atlas = !!opts.atlas;
  const uniforms = {
    uMap:        { value: map || null },
    uTime:       { value: 0 },
    uCurve:      { value: opts.curve ?? 0.14 },   // barrel distortion
    uScan:       { value: opts.scan ?? 0.30 },    // scanline depth
    uScanCount:  { value: opts.scanCount ?? 340 },
    uMask:       { value: opts.mask ?? 0.22 },    // rgb aperture grille depth
    uVignette:   { value: opts.vignette ?? 0.35 },
    uBright:     { value: opts.bright ?? 1.30 },
    uTint:       { value: new THREE.Color(opts.tint ?? 0xffffff) },
    uOffTint:    { value: new THREE.Color(opts.offTint ?? 0x0a0c12) },
    uOn:         { value: opts.on === false ? 0 : 1 },
    uRoll:       { value: opts.roll ?? 0.05 },    // slow rolling refresh bar
    uAspect:     { value: opts.aspect ?? 1.0 },   // content aspect / screen aspect
    uFocus:      { value: -1 },                   // index of the cabinet being approached
    uFocusGain:  { value: opts.focusGain ?? 0.35 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    defines: atlas ? { ATLAS: '' } : {},
    toneMapped: false,
    transparent: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #ifdef ATLAS
        attribute vec4 aCell;
        attribute float aIdx;
        varying vec4 vCell;
        varying float vIdx;
      #endif
      void main() {
        vUv = uv;
        #ifdef ATLAS
          vCell = aCell;
          vIdx = aIdx;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uMap;
      uniform float uTime, uCurve, uScan, uScanCount, uMask, uVignette, uBright, uOn, uRoll, uAspect;
      uniform float uFocus, uFocusGain;
      uniform vec3 uTint, uOffTint;
      varying vec2 vUv;
      #ifdef ATLAS
        varying vec4 vCell;
        varying float vIdx;
      #endif

      // push uv out from center to fake tube curvature
      vec2 curve(vec2 uv) {
        uv = uv * 2.0 - 1.0;
        vec2 off = abs(uv.yx) / vec2(6.0, 4.0);
        uv += uv * off * off * uCurve * 6.0;
        return uv * 0.5 + 0.5;
      }

      void main() {
        vec2 uv = curve(vUv);

        // outside the tube = dead glass
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          gl_FragColor = vec4(uOffTint * 0.5, 1.0);
          return;
        }

        // letterbox the content to its own aspect inside a square-ish screen
        vec2 cuv = uv;
        if (uAspect > 1.0) {
          cuv.y = (cuv.y - 0.5) * uAspect + 0.5;
        } else if (uAspect < 1.0) {
          cuv.x = (cuv.x - 0.5) / uAspect + 0.5;
        }
        vec3 col;
        if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) {
          col = vec3(0.0);
        } else {
          // tiny chromatic split, like a misconverged tube
          float ca = 0.0016;
          #ifdef ATLAS
            // Inset by half a texel before landing in the cell. Neighbouring
            // cells touch, so a sample that lands exactly on the boundary picks
            // up the game next door.
            vec2 inset = vec2(0.5 / 2048.0);
            vec2 base = vCell.xy + inset;
            vec2 span = vCell.zw - inset * 2.0;
            col.r = texture2D(uMap, base + clamp(cuv + vec2( ca, 0.0), 0.0, 1.0) * span).r;
            col.g = texture2D(uMap, base + cuv * span).g;
            col.b = texture2D(uMap, base + clamp(cuv + vec2(-ca, 0.0), 0.0, 1.0) * span).b;
          #else
            col.r = texture2D(uMap, cuv + vec2( ca, 0.0)).r;
            col.g = texture2D(uMap, cuv).g;
            col.b = texture2D(uMap, cuv + vec2(-ca, 0.0)).b;
          #endif
        }

        // scanlines
        float s = sin(uv.y * uScanCount * 3.14159);
        col *= 1.0 - uScan * s * s;

        // aperture grille: rgb triads across x
        float px = uv.x * 900.0;
        vec3 grille = vec3(
          0.5 + 0.5 * cos(px * 2.0943951),
          0.5 + 0.5 * cos(px * 2.0943951 - 2.0943951),
          0.5 + 0.5 * cos(px * 2.0943951 + 2.0943951)
        );
        col *= mix(vec3(1.0), grille * 1.6, uMask);

        // slow rolling refresh bar
        float bar = fract(uv.y - uTime * 0.08);
        col *= 1.0 + uRoll * smoothstep(0.98, 1.0, bar);

        col *= uBright * uTint;

        // the cabinet you are walking toward leans forward out of the row
        #ifdef ATLAS
          col *= 1.0 + uFocusGain * step(abs(vIdx - uFocus), 0.5);
        #endif

        // vignette toward the bezel
        vec2 v = uv * (1.0 - uv.yx);
        col *= pow(clamp(v.x * v.y * 22.0, 0.0, 1.0), uVignette);

        // powered off: faint grey glass with a dim reflection gradient
        vec3 off = uOffTint + vec3(0.05) * (1.0 - uv.y);
        gl_FragColor = vec4(mix(off, col, uOn), 1.0);
      }
    `,
  });

  material.userData.uniforms = uniforms;
  return material;
}
