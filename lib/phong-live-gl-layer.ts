// Live-uniform WebGL Phong terrain shading — the "Fast" alternative to
// lib/phong-protocol.ts's raster-tile pipeline. It reads the same upstream DEM
// tiles that protocol does (lib/normals-protocol.ts's computeNormalPixels,
// cache shared) but shades them live in a fragment shader, with the lights,
// diffuse/specular/Fresnel strengths and exaggeration as plain uniforms: a
// slider drag is a uniform write and a repaint, never a tile round trip.
//
// Tiles, textures and the two draw paths (flat onto the map with terrain off,
// mercator or globe; MapLibre's renderToTerrainTile per terrain tile with
// terrain on) live in lib/live-dem-gl-layer.ts; this file is the shading.
//
// Compositing: true albedo × (ambient + diffuse) + specular, where the albedo
// is whatever is already in the framebuffer beneath the layer (the map, or the
// terrain tile's texture with the layers draped under this one). Two passes
// per tile: a multiply, blendFuncSeparate(ZERO, ONE_MINUS_SRC_COLOR, ONE,
// ONE_MINUS_SRC_ALPHA) with rgb = 1 − shade, then an add, blendFunc(ONE, ONE),
// with the specular and light rim. The multiply also writes the darkening as
// alpha: when the layer starts a terrain stack of its own (a symbol layer of
// the vector basemap sits below it, so the albedo is in an earlier stack), the
// tile texture holds black at that alpha and still darkens the map when
// MapLibre drapes it (in grey: per-channel light colours need the albedo in
// the same stack).
import { DEM_NORMAL_GLSL, LiveDemGlLayer, type LiveDemOptions } from "./live-dem-gl-layer"

// --- Minimal vec3/mat4 helpers for computeCameraBasis below ---
// (self-contained rather than pulling in a matrix library for six calls/frame).

export type Vec3 = [number, number, number]
const vSub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const vDot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const vScale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const vNormalize = (a: Vec3): Vec3 => {
  const len = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / len, a[1] / len, a[2] / len]
}

// Standard cofactor-expansion 4x4 inverse (the well-known glMatrix mat4.invert
// algorithm) — convention-agnostic w.r.t. row/column-major as long as the
// same flat-array indexing is used consistently for both invert and multiply
// (transformMat4 below), which it is.
function invertMat4(a: ArrayLike<number>): number[] | null {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3]
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7]
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11]
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15]

  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!det) return null
  det = 1.0 / det

  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det,
    (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det,
    (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det,
    (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det,
    (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det,
    (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det,
    (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det,
    (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det,
    (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ]
}

function transformMat4(m: ArrayLike<number>, v: [number, number, number, number]): [number, number, number, number] {
  const [x, y, z, w] = v
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ]
}

/** Robustly derives the camera's actual (right, up, forward) basis, in the
 *  same (x=east, y=south, z=up) world space the light-direction formula
 *  uses, from a visible tile's real per-tile projection matrix — rather
 *  than hand-deriving a pitch/bearing rotation from trig (the approach that
 *  had a real sign bug for Matcap's own camera-relative mode). Unprojects
 *  three screen rays (center, center+dx, center+dy) through the matrix's
 *  inverse and Gram-Schmidt-orthogonalizes the two offset rays against the
 *  center ray — built entirely from real matrix data, self-consistent by
 *  construction, no separate sign choice to get wrong. Returns null if the
 *  matrix isn't invertible (degenerate frame — caller should keep whatever
 *  basis it last had rather than update to garbage). */
export function computeCameraBasis(mainMatrix: ArrayLike<number>): { right: Vec3; up: Vec3; forward: Vec3 } | null {
  const inv = invertMat4(mainMatrix)
  if (!inv) return null
  const unproject = (ndcX: number, ndcY: number, ndcZ: number): Vec3 => {
    const h = transformMat4(inv, [ndcX, ndcY, ndcZ, 1])
    return [h[0] / h[3], h[1] / h[3], h[2] / h[3]]
  }
  const eps = 0.01
  const forward = vNormalize(vSub(unproject(0, 0, 1), unproject(0, 0, -1)))
  const rightRay = vNormalize(vSub(unproject(eps, 0, 1), unproject(eps, 0, -1)))
  const upRay = vNormalize(vSub(unproject(0, eps, 1), unproject(0, eps, -1)))
  const right = vNormalize(vSub(rightRay, vScale(forward, vDot(rightRay, forward))))
  const up = vNormalize(vSub(upRay, vScale(forward, vDot(upRay, forward))))
  return { right, up, forward }
}

export type PhongLiveOptions = LiveDemOptions & {
  /** Compass azimuth, degrees clockwise from north — same field/sign
   *  convention as phong-protocol.ts (state.illuminationDir). In
   *  camera-relative mode (below) this is the azimuth RELATIVE to the camera;
   *  the live map bearing is added per draw. */
  lightDir: number
  /** Degrees above the horizon. */
  lightAlt: number
  /** When true, the light is fixed to the CAMERA (a headlamp): lightDir/
   *  lightAlt are reinterpreted as an offset from the camera's live bearing
   *  AND pitch (analytic frame, see setShadingUniforms), read from the map on
   *  every draw — so the light tracks a rotate/tilt gesture continuously.
   *  Absolute mode (false) leaves the light pinned to compass directions. */
  lightRelativeToCamera: boolean
  /** Light 1's colour, linear-ish RGB 0..1 (white = the classic grey shading). */
  lightColor?: [number, number, number]
  /** Lights 2 and 3: same azimuth/altitude conventions as lightDir/lightAlt
   *  (camera-relative too when that flag is on), each with a colour. Their
   *  diffuse adds per channel, so a slope lit by one of them takes its hue. */
  extraLights?: { dir: number; alt: number; color: [number, number, number] }[]
  diffuseStrength: number
  specularStrength: number
  /** Fresnel rim: brightens slopes that face away from the camera (the
   *  grazing-angle term, Schlick's form), 0 = off. View dependent, so only
   *  this live renderer can draw it: the view vector is the camera's own
   *  orientation, read from the map on every draw. */
  fresnelStrength?: number
  /** Exponent of the rim falloff; higher = thinner rim. */
  fresnelPower?: number
  /** A dark rim (multiplies the albedo down) instead of a white additive
   *  one: the opposite of the theme's background, so the rim reads on both
   *  (black on the light theme, white on the dark one). */
  fresnelDark?: boolean
  exaggeration: number
  opacity: number
}

// Same Blinn-Phong LIGHTING math as gpu-phong-compute.ts's fragment shader;
// the output depends on u_pass (see the header comment for the blending).
// u_opacity fades the shade toward the identity (×1) and scales the specular
// term, so 0% leaves the map untouched.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec3 u_lightDir[3];
uniform vec3 u_lightColor[3];
uniform int u_lightCount;
uniform float u_diffuseStrength;
uniform float u_specularStrength;
uniform float u_fresnelStrength;
uniform float u_fresnelPower;
uniform float u_fresnelDark; // 1 = darken (multiply), 0 = add white
uniform vec3 u_viewDir;
uniform float u_exaggeration;
uniform float u_opacity;
uniform int u_pass; // 0 = multiply, 1 = add
out vec4 fragColor;
${DEM_NORMAL_GLSL}

const float AMBIENT = 0.35;
const float SHININESS = 32.0;

void main() {
  vec3 n = demNormal(v_uv, u_exaggeration);

  vec3 V = vec3(0.0, 0.0, 1.0);
  // Up to three lights, each with a colour: the diffuse terms add per
  // channel and are averaged so a slope every light reaches stays at the
  // single-light maximum; specular is averaged the same way.
  vec3 diffuseRgb = vec3(0.0);
  float specDotSum = 0.0;
  for (int i = 0; i < 3; i++) {
    if (i >= u_lightCount) break;
    vec3 L = u_lightDir[i];
    vec3 H = normalize(L + V);
    diffuseRgb += u_lightColor[i] * max(dot(n, L), 0.0);
    specDotSum += pow(max(dot(n, H), 0.0), SHININESS);
  }
  float count = float(max(u_lightCount, 1));
  vec3 diffuse = u_diffuseStrength * diffuseRgb / count;
  // NORMALIZED for the multiply-compositing model (deliberate deviation
  // from the raster path's raw AMBIENT + diffuse): dividing by the maximum
  // attainable value (AMBIENT + u_diffuseStrength) maps a fully-lit slope
  // to exactly 1 — leaving the albedo untouched there — and everything
  // else darkens proportionally. Without it, turning Diffuse Strength DOWN
  // darkened the entire map toward 35% instead of just flattening it.
  vec3 diffuseIntensity = clamp((vec3(AMBIENT) + diffuse) / (AMBIENT + u_diffuseStrength), 0.0, 1.0);
  float specular = u_specularStrength * specDotSum / count;
  // Fresnel rim (Schlick): (1 - n.v)^p, strongest where the surface turns
  // away from the camera; u_viewDir is the direction from the ground to the
  // camera in the normals' frame. The classic form, n.v clamped at 0: slopes
  // tilted more than (90 - pitch) degrees away saturate to the full rim, a
  // crisp edge along ridges at a steep pitch. A remap of n.v from [-1, 1]
  // onto [0, 1] was tried (2026-10-03); the user preferred this one.
  float rim = u_fresnelStrength * pow(1.0 - clamp(dot(n, u_viewDir), 0.0, 1.0), u_fresnelPower);
  // A dark rim goes into the multiplicative channel (the blend cannot add a
  // negative), a light one into the additive channel with the specular.
  vec3 shade = mix(vec3(1.0), diffuseIntensity * (1.0 - u_fresnelDark * clamp(rim, 0.0, 1.0)), u_opacity);
  float add = clamp((specular + (1.0 - u_fresnelDark) * rim) * u_opacity, 0.0, 1.0);

  if (u_pass == 0) {
    // Under blendFuncSeparate(ZERO, ONE_MINUS_SRC_COLOR, ONE, ONE_MINUS_SRC_ALPHA):
    // dst.rgb * shade, and the mean darkening as alpha for an empty stack.
    vec3 darken = vec3(1.0) - shade;
    fragColor = vec4(darken, (darken.r + darken.g + darken.b) / 3.0);
  } else {
    // Under blendFunc(ONE, ONE): the specular added, alpha untouched.
    fragColor = vec4(vec3(add), 0.0);
  }
}
`

export class PhongLiveLayer extends LiveDemGlLayer<PhongLiveOptions> {
  protected readonly tag = "phong-live-gl-layer"
  protected readonly fragmentShader = FRAGMENT_SHADER

  protected viewDependent(): boolean {
    return this.options.lightRelativeToCamera || (this.options.fresnelStrength ?? 0) > 0
  }

  protected setShadingUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
    const map = this.map!
    const u = (name: string) => this.uniform(gl, program, name)
    // Compass azimuth + altitude -> unit light vector in the SAME (x=east,
    // y=south, z=up) space the normals live in — byte-for-byte the same
    // formula/signs as phong-protocol.ts, which ARE correct for both
    // anchors (verified 2026-08-21 against the pad, native hillshade, and
    // the sun-shadow tools, all agreeing). HISTORY WARNING: these signs
    // were briefly flipped and partially compensated across two commits
    // after an "absolute is inverted" report that turned out to come from
    // a STALE dev tab — if an inversion is ever reported again, have the
    // reporter hard-refresh and A/B against native hillshade (same
    // illuminationDir state) before touching any sign here.
    const bRad = (map.getBearing() * Math.PI) / 180
    const pRad = (map.getPitch() * Math.PI) / 180
    const toLightVec = (dirDeg: number, altDeg: number): [number, number, number] => {
      const azRad = (dirDeg * Math.PI) / 180
      const elRad = (altDeg * Math.PI) / 180
      const cosEl = Math.cos(elRad)
      const lx0 = -Math.sin(azRad) * cosEl
      const ly0 = -Math.cos(azRad) * cosEl
      const lz0 = Math.sin(elRad)
      if (!this.options.lightRelativeToCamera) return [lx0, ly0, lz0]
      // Camera-relative ("headlamp"): (dir, alt) is an offset from the
      // camera's own orientation. Analytic camera frame from bearing/pitch
      // (right-handed ENU, y negated into tile coords):
      //   right = (cos b, sin b, 0); up_s = (sin b cos p, -cos b cos p, sin p); viewer = (-sin b sin p, cos b sin p, cos p)
      // then the x flip into the normals' (hornGradient) convention.
      const sinB = Math.sin(bRad), cosB = Math.cos(bRad)
      const sinP = Math.sin(pRad), cosP = Math.cos(pRad)
      const sinAz = Math.sin(azRad), cosAz = Math.cos(azRad)
      const tx = cosEl * (sinAz * cosB + cosAz * sinB * cosP) + lz0 * (-sinB * sinP)
      const ty = cosEl * (sinAz * sinB + cosAz * -cosB * cosP) + lz0 * (cosB * sinP)
      const tz = cosEl * (cosAz * sinP) + lz0 * cosP
      let lx = -tx, ly = ty, lz = tz
      const len = Math.hypot(lx, ly, lz) || 1
      lx /= len; ly /= len; lz /= len
      return [lx, ly, lz]
    }
    const lights: { vec: [number, number, number]; color: [number, number, number] }[] = [
      { vec: toLightVec(this.options.lightDir, this.options.lightAlt), color: this.options.lightColor ?? [1, 1, 1] },
      ...(this.options.extraLights ?? []).slice(0, 2).map((l) => ({ vec: toLightVec(l.dir, l.alt), color: l.color })),
    ]
    const dirs = new Float32Array(9), cols = new Float32Array(9)
    lights.forEach((l, i) => { dirs.set(l.vec, i * 3); cols.set(l.color, i * 3) })

    gl.uniform3fv(u("u_lightDir"), dirs)
    gl.uniform3fv(u("u_lightColor"), cols)
    gl.uniform1i(u("u_lightCount"), lights.length)
    gl.uniform1f(u("u_diffuseStrength"), this.options.diffuseStrength)
    gl.uniform1f(u("u_specularStrength"), this.options.specularStrength)
    gl.uniform1f(u("u_fresnelStrength"), this.options.fresnelStrength ?? 0)
    gl.uniform1f(u("u_fresnelPower"), this.options.fresnelPower ?? 3)
    gl.uniform1f(u("u_fresnelDark"), this.options.fresnelDark ? 1 : 0)
    // Ground-to-camera direction in the normals' frame (x east, y south,
    // z up): the camera sits opposite the bearing, pitch degrees off the
    // vertical. Same frame as the "viewer" vector above, x flipped into the
    // hornGradient convention.
    gl.uniform3f(u("u_viewDir"), Math.sin(bRad) * Math.sin(pRad), Math.cos(bRad) * Math.sin(pRad), Math.cos(pRad))
    gl.uniform1f(u("u_exaggeration"), this.options.exaggeration)
    gl.uniform1f(u("u_opacity"), this.options.opacity)
  }

  protected drawPasses(gl: WebGL2RenderingContext, program: WebGLProgram, drawAll: () => void) {
    const uPass = this.uniform(gl, program, "u_pass")
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.uniform1i(uPass, 0)
    drawAll()
    if (this.options.specularStrength > 0 || ((this.options.fresnelStrength ?? 0) > 0 && !this.options.fresnelDark)) {
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.uniform1i(uPass, 1)
      drawAll()
    }
  }
}
