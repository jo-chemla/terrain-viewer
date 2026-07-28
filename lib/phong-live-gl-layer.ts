// Live-uniform WebGL Phong terrain shading — the "Fast" alternative to
// lib/phong-protocol.ts's raster-tile pipeline. Renders per visible tile as a
// flat quad, sampling the SAME cached normal texture that protocol produces
// (lib/normals-protocol.ts's computeNormalPixels — DEM fetch + Horn-gradient
// normal compute is genuinely shared, never redone here), but shades it live
// in a fragment shader with light direction/diffuse/specular/exaggeration as
// plain uniforms. A slider drag is therefore a uniform write + repaint, never
// a tile re-fetch/PNG-encode/re-decode round trip.
//
// MERCATOR + GLOBE, flat (no terrain drape). Positioning goes through
// MapLibre's OWN projection code via the per-frame `shaderData.vertexShaderPrelude`
// (which defines `projectTile(a_pos)`) plus the projection uniforms from
// `map.transform.getProjectionData({overscaledTileID})` — so the same tile
// quad projects correctly under mercator AND globe, matching how MapLibre's
// own layers do it. Because the shader variant depends on the active
// projection (`shaderData.variantName` flips mercator↔globe), the GL program
// is compiled lazily per variant and cached (see `programs` below): the plain
// per-tile `u_matrix` approach used before only handled mercator, which is why
// globe used to be unavailable for "2D Fast".
//
// NOW DRAPES onto MapLibre's own terrain surface. A prior attempt at this
// (projectTileFor3D + a hand-built elevation buffer sourced independently of
// MapLibre's own DEM texture) never reliably matched that surface and was
// abandoned; deep-diving MapLibre's actual render internals at the time
// concluded there was no hook for a `type: "custom"` layer to participate in
// terrain-drape at all. Revisited following github.com/maplibre/maplibre-gl-js
// discussion #5293 (kubapelc's pointer): `map.terrain.getTerrainData(tileID)`
// hands back the EXACT SAME DEM texture + uniforms (`u_terrain*`) MapLibre's
// own `terrain.vertex.glsl` shader reads, and the `get_elevation(vec2)` GLSL
// function that shader calls to sample them — along with `projectTileFor3D`,
// already used here for globe — is plain source shipped in the npm package's
// `src/shaders/_prelude.vertex.glsl` (only its `#ifdef TERRAIN3D` block is
// reproduced below as TERRAIN_PRELUDE; not exported as a JS string, but not
// hidden either — legitimate to copy since it's the same public dependency
// this project already has installed). `map.terrain` itself has no public
// TS type (hence the local MapTerrainLike cast below), but `Terrain.
// getTerrainData` is a fully public, documented method in maplibre-gl's own
// .d.ts — this is an internal-but-stable hook, not a private hack.
//
// One shader path handles BOTH terrain-on and terrain-off: get_elevation()
// always runs, but when no terrain is active render() binds a flat fallback
// (1×1 zero DEM texture + identity matrix, see FLAT_FALLBACK below) that
// makes it return 0 everywhere — collapsing to exactly the old flat
// behavior, so 2D/tilted-3D-without-terrain/globe-without-terrain are
// unaffected. Tile selection stays on the existing `map.coveringTiles()` (not
// `map.terrain.sourceCache.getRenderableTiles()`, which a previous public
// attempt at this same technique reported duplicate/overlapping coverage
// from) — `getTerrainData()` resolves whatever DEM tile actually covers a
// given tileID itself (including overzoom), so it doesn't need our tile
// selection to match the terrain source's own tile pyramid.
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap, OverscaledTileID } from "maplibre-gl"
import { createTileMesh } from "maplibre-gl"
import { computeNormalPixels } from "./normals-protocol"
import type { UpstreamEncoding } from "./normal-derived-protocol"

// --- Minimal vec3/mat4 helpers for the camera-relative light fix below ---
// (self-contained rather than pulling in a matrix library for six calls/frame).

type Vec3 = [number, number, number]
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
function computeCameraBasis(mainMatrix: ArrayLike<number>): { right: Vec3; up: Vec3; forward: Vec3 } | null {
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

/** Shape of the real (but publicly untyped) `map.terrain` property — mirrors
 *  maplibre-gl's own `TerrainData` return shape for `getTerrainData()`. */
interface MapTerrainLike {
  exaggeration: number
  getTerrainData(tileID: OverscaledTileID): {
    u_terrain_dim: number
    u_terrain_matrix: number[]
    u_terrain_unpack: number[]
    u_terrain_exaggeration: number
    texture: WebGLTexture
  }
}

// The `#ifdef TERRAIN3D` block of maplibre-gl's own
// src/shaders/_prelude.vertex.glsl, trimmed to just get_elevation() and its
// dependencies (the depth-texture/occlusion half of that file, u_depth +
// calculate_visibility, isn't needed here — this layer doesn't do
// behind-terrain occlusion). TERRAIN3D is unconditionally defined (not tied
// to whether terrain is actually active) since the flat-fallback trick above
// makes get_elevation() safe to call either way. The `#ifdef GLOBE` pole
// guard is kept as-is — GLOBE is defined (or not) by shaderData.define,
// which is spliced in immediately before this block, so the guard sees the
// right value for the active projection variant.
const TERRAIN_PRELUDE = `
uniform sampler2D u_terrain;
uniform float u_terrain_dim;
uniform mat4 u_terrain_matrix;
uniform vec4 u_terrain_unpack;
uniform float u_terrain_exaggeration;

float ele(vec2 pos) {
  vec4 rgb = (texture(u_terrain, pos) * 255.0) * u_terrain_unpack;
  return rgb.r + rgb.g + rgb.b - u_terrain_unpack.a;
}

float get_elevation(vec2 pos) {
#ifdef GLOBE
  if ((pos.y < -32767.5) || (pos.y > 32766.5)) {
    return 0.0;
  }
#endif
  vec2 coord = (u_terrain_matrix * vec4(pos, 0.0, 1.0)).xy * u_terrain_dim + 1.0;
  vec2 f = fract(coord);
  vec2 c = (floor(coord) + 0.5) / (u_terrain_dim + 2.0);
  float d = 1.0 / (u_terrain_dim + 2.0);
  float tl = ele(c);
  float tr = ele(c + vec2(d, 0.0));
  float bl = ele(c + vec2(0.0, d));
  float br = ele(c + vec2(d, d));
  float elevation = mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y);
  return elevation * u_terrain_exaggeration;
}
`

export type PhongLiveOptions = {
  upstreamTemplate: string
  encoding: UpstreamEncoding
  tileSize: number
  minzoom?: number
  maxzoom?: number
  /** Compass azimuth, degrees clockwise from north — same field/sign
   *  convention as phong-protocol.ts (state.illuminationDir). In
   *  camera-relative mode (below) this is the azimuth RELATIVE to the camera;
   *  the live map bearing is added per-frame inside render(). */
  lightDir: number
  /** Degrees above the horizon. */
  lightAlt: number
  /** When true, the light is fixed to the CAMERA (a headlamp): lightDir/
   *  lightAlt are reinterpreted as an offset from the camera's actual real-
   *  time orientation (both bearing AND pitch — see render()'s
   *  computeCameraBasis usage) every rendered frame, read live from the
   *  transform — so the light tracks continuously through a rotate/tilt
   *  gesture, not just after it settles. Absolute mode (false) leaves the
   *  light pinned to compass directions, unaffected by camera orientation. */
  lightRelativeToCamera: boolean
  diffuseStrength: number
  specularStrength: number
  exaggeration: number
  opacity: number
}

// Evicted LRU-style once exceeded — bounds GPU texture memory during long
// pan/zoom sessions without needing a hard tile-count cap on `coveringTiles`.
const MAX_CACHED_TEXTURES = 96

// The vertex shader is assembled per projection variant from MapLibre's own
// `shaderData` (see render()): the prelude declares the u_projection_* uniforms
// and defines `projectTile(vec2)`, which projects tile-local 0..EXTENT coords
// to clip space correctly under BOTH mercator and globe. `a_pos` is forced to
// attribute location 0 (bindAttribLocation, see compileProgram) so the single
// shared VAO works for every compiled variant.
function buildVertexShader(prelude: string, define: string): string {
  return `#version 300 es
${prelude}
${define}
${TERRAIN_PRELUDE}
in vec2 a_pos;
out vec2 v_uv;
const float TILE_EXTENT = 8192.0;
void main() {
  v_uv = a_pos / TILE_EXTENT;
  gl_Position = projectTileFor3D(a_pos, get_elevation(a_pos));
}
`
}

// Same Blinn-Phong math/encoding as gpu-phong-compute.ts's fragment shader
// (kept byte-for-byte equivalent — see that file for the derivation/rationale
// of the two-regime multiply-darken/screen-brighten alpha encoding), except
// output is premultiplied — CustomLayerInterface.render's default blend func
// is `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`, which expects that.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_normalMap;
uniform vec3 u_lightDir;
uniform float u_diffuseStrength;
uniform float u_specularStrength;
uniform float u_exaggeration;
uniform float u_opacity;
out vec4 fragColor;

const float AMBIENT = 0.35;
const float SHININESS = 32.0;

void main() {
  vec3 encoded = texture(u_normalMap, v_uv).rgb;
  vec3 raw = encoded * 2.0 - 1.0;

  vec2 slope = (raw.xy / raw.z) * u_exaggeration;
  vec3 n = normalize(vec3(slope, 1.0));

  vec3 L = u_lightDir;
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);

  float diffuse = u_diffuseStrength * max(dot(n, L), 0.0);
  float diffuseIntensity = clamp(AMBIENT + diffuse, 0.0, 1.0);
  float specDot = max(dot(n, H), 0.0);
  float specular = u_specularStrength * pow(specDot, SHININESS);
  float total = diffuseIntensity + specular;

  vec3 color;
  float alpha;
  if (total <= 1.0) {
    color = vec3(0.0);
    alpha = 1.0 - total;
  } else {
    color = vec3(1.0);
    alpha = min(total - 1.0, 1.0);
  }
  alpha *= u_opacity;
  fragColor = vec4(color * alpha, alpha);
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`[phong-live-gl-layer] shader compile failed: ${info}`)
  }
  return shader
}

function compileProgram(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const program = gl.createProgram()!
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSrc))
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc))
  // Pin a_pos to location 0 for every variant so the single shared VAO (set up
  // once in onAdd against index 0) stays valid no matter which program is bound.
  gl.bindAttribLocation(program, 0, "a_pos")
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`[phong-live-gl-layer] program link failed: ${info}`)
  }
  return program
}

// One compiled program per projection variant (mercator vs globe), each with
// its own uniform locations — see render()'s getProgram().
interface ProgramBundle {
  program: WebGLProgram
  uProjectionMatrix: WebGLUniformLocation | null
  uProjectionTileMercatorCoords: WebGLUniformLocation | null
  uProjectionClippingPlane: WebGLUniformLocation | null
  uProjectionTransition: WebGLUniformLocation | null
  uProjectionFallbackMatrix: WebGLUniformLocation | null
  uNormalMap: WebGLUniformLocation | null
  uLightDir: WebGLUniformLocation | null
  uDiffuseStrength: WebGLUniformLocation | null
  uSpecularStrength: WebGLUniformLocation | null
  uExaggeration: WebGLUniformLocation | null
  uOpacity: WebGLUniformLocation | null
  uTerrain: WebGLUniformLocation | null
  uTerrainDim: WebGLUniformLocation | null
  uTerrainMatrix: WebGLUniformLocation | null
  uTerrainUnpack: WebGLUniformLocation | null
  uTerrainExaggeration: WebGLUniformLocation | null
}

interface TextureEntry {
  texture: WebGLTexture
  lastUsed: number
}

export class PhongLiveLayer implements CustomLayerInterface {
  id: string
  type: "custom" = "custom"
  renderingMode: "2d" = "2d"
  options: PhongLiveOptions

  private map: MapLibreMap | null = null
  private gl: WebGL2RenderingContext | null = null
  // Compiled programs keyed by shaderData.variantName (mercator vs globe) —
  // MapLibre hands us a different prelude per projection, so we can't compile
  // a single program up front in onAdd (which has no shaderData); we compile
  // lazily on first render for each variant and reuse thereafter.
  private programs = new Map<string, ProgramBundle>()
  private vao: WebGLVertexArrayObject | null = null
  private indexCount = 0
  private indexType = 0
  private textures = new Map<string, TextureEntry>()
  private pending = new Set<string>()
  private frameCounter = 0
  private disposed = false
  private loggedError = false
  private loggedFetchError = false
  // 1×1 all-zero DEM texture + identity matrix bound whenever terrain isn't
  // active (or a tile's real DEM isn't loaded yet) — makes get_elevation()
  // return 0 uniformly, i.e. exactly the old flat behavior, with no separate
  // shader variant needed for the terrain-off case.
  private flatTerrainTexture: WebGLTexture | null = null
  private static readonly FLAT_TERRAIN_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  private static readonly FLAT_TERRAIN_UNPACK = [0, 0, 0, 0]
  // Last-known-good camera basis for camera-relative light (see
  // computeCameraBasis) — kept across frames so a rare degenerate/
  // non-invertible matrix doesn't snap the light to a garbage direction for
  // one frame; just reuses the previous orientation until the next good one.
  private lastCameraBasis: { right: Vec3; up: Vec3; forward: Vec3 } | null = null

  constructor(id: string, options: PhongLiveOptions) {
    this.id = id
    this.options = options
  }

  /** Live parameter update — no remount, no tile refetch, just a repaint with
   *  fresh uniform values (the whole point of this layer over the raster
   *  protocol). Changing upstreamTemplate/encoding/tileSize here would NOT
   *  invalidate already-cached textures (they're keyed only by z/x/y) — the
   *  React wrapper remounts a fresh instance instead for those. */
  updateOptions(patch: Partial<PhongLiveOptions>) {
    this.options = { ...this.options, ...patch }
    this.map?.triggerRepaint()
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    this.gl = gl
    // Programs are compiled lazily per projection variant in render() (we need
    // MapLibre's per-frame shaderData for the prelude, which onAdd doesn't get).

    // A single shared quad mesh (granularity higher than 1 so globe projection
    // has enough vertices to curve the tile across the sphere instead of a flat
    // chord — a 1×1 quad would visibly cut the corner under globe) reused for
    // every tile: only the per-tile projection uniforms differ between draw
    // calls, never the geometry itself. a_pos is bound to attribute location 0
    // for every program variant (see compileProgram), so this one VAO is valid
    // no matter which program is bound at draw time.
    const mesh = createTileMesh({ granularity: 8 }, "16bit")
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    const vertexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.SHORT, false, 0, 0)
    const indexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW)
    this.indexType = mesh.uses32bitIndices ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
    this.indexCount = mesh.indices.byteLength / (mesh.uses32bitIndices ? 4 : 2)
    gl.bindVertexArray(null)

    this.flatTerrainTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.flatTerrainTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.disposed = true
    for (const entry of this.textures.values()) gl.deleteTexture(entry.texture)
    this.textures.clear()
    this.pending.clear()
    for (const bundle of this.programs.values()) gl.deleteProgram(bundle.program)
    this.programs.clear()
    if (this.flatTerrainTexture) gl.deleteTexture(this.flatTerrainTexture)
    this.flatTerrainTexture = null
    if (this.vao) gl.deleteVertexArray(this.vao)
    this.vao = null
    this.gl = null
    this.map = null
  }

  // Compile (once) and return the program for the current projection variant.
  // shaderData.variantName changes whenever the prelude/projection changes, so
  // it's the correct cache key (MapLibre's own docs recommend exactly this).
  private getProgram(gl: WebGL2RenderingContext, shaderData: CustomRenderMethodInput["shaderData"]): ProgramBundle {
    const existing = this.programs.get(shaderData.variantName)
    if (existing) return existing
    const program = compileProgram(gl, buildVertexShader(shaderData.vertexShaderPrelude, shaderData.define), FRAGMENT_SHADER)
    const bundle: ProgramBundle = {
      program,
      uProjectionMatrix: gl.getUniformLocation(program, "u_projection_matrix"),
      uProjectionTileMercatorCoords: gl.getUniformLocation(program, "u_projection_tile_mercator_coords"),
      uProjectionClippingPlane: gl.getUniformLocation(program, "u_projection_clipping_plane"),
      uProjectionTransition: gl.getUniformLocation(program, "u_projection_transition"),
      uProjectionFallbackMatrix: gl.getUniformLocation(program, "u_projection_fallback_matrix"),
      uNormalMap: gl.getUniformLocation(program, "u_normalMap"),
      uLightDir: gl.getUniformLocation(program, "u_lightDir"),
      uDiffuseStrength: gl.getUniformLocation(program, "u_diffuseStrength"),
      uSpecularStrength: gl.getUniformLocation(program, "u_specularStrength"),
      uExaggeration: gl.getUniformLocation(program, "u_exaggeration"),
      uOpacity: gl.getUniformLocation(program, "u_opacity"),
      uTerrain: gl.getUniformLocation(program, "u_terrain"),
      uTerrainDim: gl.getUniformLocation(program, "u_terrain_dim"),
      uTerrainMatrix: gl.getUniformLocation(program, "u_terrain_matrix"),
      uTerrainUnpack: gl.getUniformLocation(program, "u_terrain_unpack"),
      uTerrainExaggeration: gl.getUniformLocation(program, "u_terrain_exaggeration"),
    }
    this.programs.set(shaderData.variantName, bundle)
    return bundle
  }

  private fetchTile(tileID: OverscaledTileID, key: string) {
    if (this.pending.has(key)) return
    this.pending.add(key)
    const { z, x, y } = tileID.canonical
    const controller = new AbortController()
    computeNormalPixels(this.options.upstreamTemplate, this.options.encoding, z, x, y, this.options.tileSize, controller.signal)
      .then(({ pixels }) => {
        this.pending.delete(key)
        if (this.disposed || !this.gl) return
        const gl = this.gl
        const texture = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.options.tileSize, this.options.tileSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        this.textures.set(key, { texture, lastUsed: this.frameCounter })
        this.map?.triggerRepaint()
      })
      .catch((err) => {
        this.pending.delete(key)
        // Was silently swallowed — an abort during pan is normal, but a real
        // fetch/compute failure here is exactly what leaves the layer white
        // with no clue why, so surface the first one.
        if (err?.name !== "AbortError" && !this.loggedFetchError) {
          this.loggedFetchError = true
          console.error(`[phong-live-gl-layer] normal-tile fetch/compute failed (z${z}/${x}/${y}); template=${this.options.upstreamTemplate}`, err)
        }
      })
  }

  private pruneTextures() {
    if (this.textures.size <= MAX_CACHED_TEXTURES) return
    const byAge = [...this.textures.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    const overflow = byAge.length - MAX_CACHED_TEXTURES
    for (let i = 0; i < overflow; i++) {
      const [key, entry] = byAge[i]
      this.gl?.deleteTexture(entry.texture)
      this.textures.delete(key)
    }
  }

  render(glArg: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    // This layer's shaders are #version 300 es (WebGL2-only) — onAdd already
    // requires a WebGL2RenderingContext to compile them, so by the time
    // render() runs, glArg is always actually a WebGL2RenderingContext too
    // (the same context instance); this cast just satisfies the wider
    // CustomLayerInterface signature (which also allows plain WebGL1).
    const gl = glArg as WebGL2RenderingContext
    const map = this.map
    if (!map || !this.vao) return

    // render() runs every single frame with no isolation from MapLibre's own
    // render loop — an uncaught exception here (e.g. from calling a
    // transform/projection method before the style has fully finished
    // loading) wouldn't just skip this layer, it could abort the whole
    // frame's remaining draw calls, which reads as "the entire map went
    // blank/white" rather than "this one overlay didn't render." try/finally
    // guarantees GL state (program/VAO binding) is always restored too, so a
    // failure here can't leave state that corrupts whatever layer MapLibre
    // draws next even if this layer's own draw calls didn't all complete.
    try {
      // Mercator AND globe are both handled: the program for the current
      // projection variant is compiled from MapLibre's own per-frame
      // shaderData (prelude + define), and projectTile() inside it does the
      // right thing for whichever projection is active. No projection bail.
      const bundle = this.getProgram(gl, args.shaderData)
      this.frameCounter++

      // Divide the covering tileSize by devicePixelRatio so a retina screen
      // pulls a higher zoom level (more, sharper tiles) — matching what
      // MapLibre's own native raster pipeline (3D Slow) does automatically, so
      // 2D Fast is no longer visibly softer than 3D Slow on hi-dpi displays.
      // An extra /2 on top of that pulls one more zoom level still — confirmed
      // (2026-07-28, once terrain-drape was live) visibly softer/lower-res
      // than the native `hillshade` layer at the same viewport otherwise, even
      // though both read the exact same upstream DEM tiles.
      const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1
      const tileIDs = map.coveringTiles({
        tileSize: Math.max(1, Math.round(this.options.tileSize / dpr / 2)),
        minzoom: this.options.minzoom,
        maxzoom: this.options.maxzoom,
      })

      // Compass azimuth + altitude -> unit light vector in the SAME (x=east,
      // y=south, z=up) space the normal map is encoded in — byte-for-byte the
      // same formula/empirically-verified signs as phong-protocol.ts (see its
      // header comment for how these signs were pinned against maplibre's own
      // hillshade shader).
      const azRad = (this.options.lightDir * Math.PI) / 180
      const elRad = (this.options.lightAlt * Math.PI) / 180
      const cosEl = Math.cos(elRad)
      const lx0 = -Math.sin(azRad) * cosEl
      const ly0 = -Math.cos(azRad) * cosEl
      const lz0 = Math.sin(elRad)

      let lx = lx0, ly = ly0, lz = lz0
      if (this.options.lightRelativeToCamera) {
        // Camera-relative ("headlamp"): reinterpret (lightDir, lightAlt) as
        // an offset from the camera's OWN orientation — not just bearing
        // (yaw) the way the previous version did, which left the light's
        // altitude untouched as pitch changed. Uses the same real-camera-
        // basis technique that fixed Matcap's equivalent bug (see
        // computeCameraBasis) instead of hand-deriving a pitch/bearing
        // rotation matrix — right/up/forward are built from real per-tile
        // projection-matrix data via unprojection, not a separately chosen
        // sign convention.
        //
        // The substitution below (right<->east, up<->-south i.e. north,
        // forward<->-up i.e. down) is verified to reduce to EXACTLY the old
        // lx0/ly0/lz0 formula at the reference orientation (bearing=0,
        // pitch=0, where right=east, up=north, forward=straight down) —
        // checked against all three axis cases (az=0/el=0, az=0/el=90,
        // az=90/el=0) by hand before shipping, so this is a verified-
        // consistent extension of the existing formula, not a fresh guess.
        if (tileIDs.length > 0) {
          const p0 = map.transform.getProjectionData({ overscaledTileID: tileIDs[0], applyGlobeMatrix: true })
          const basis = computeCameraBasis(p0.mainMatrix)
          if (basis) this.lastCameraBasis = basis
        }
        const basis = this.lastCameraBasis
        if (basis) {
          lx = lx0 * basis.right[0] - ly0 * basis.up[0] - lz0 * basis.forward[0]
          ly = lx0 * basis.right[1] - ly0 * basis.up[1] - lz0 * basis.forward[1]
          lz = lx0 * basis.right[2] - ly0 * basis.up[2] - lz0 * basis.forward[2]
          const len = Math.hypot(lx, ly, lz) || 1
          lx /= len; ly /= len; lz /= len
        } else {
          // No visible tiles yet this frame (nothing to derive a basis
          // from) and no previous basis cached — fall back to the old
          // bearing-only approximation rather than an undefined light.
          const azDegFallback = this.options.lightDir + map.getBearing()
          const azRadFallback = (azDegFallback * Math.PI) / 180
          lx = -Math.sin(azRadFallback) * cosEl
          ly = -Math.cos(azRadFallback) * cosEl
          lz = lz0
        }
      }

      gl.useProgram(bundle.program)
      gl.bindVertexArray(this.vao)
      gl.uniform1i(bundle.uNormalMap, 0)
      gl.uniform3f(bundle.uLightDir, lx, ly, lz)
      gl.uniform1f(bundle.uDiffuseStrength, this.options.diffuseStrength)
      gl.uniform1f(bundle.uSpecularStrength, this.options.specularStrength)
      gl.uniform1f(bundle.uExaggeration, this.options.exaggeration)
      gl.uniform1f(bundle.uOpacity, this.options.opacity)
      gl.activeTexture(gl.TEXTURE0)

      // The real Terrain instance MapLibre's own terrain rendering uses —
      // has no public TS type (see MapTerrainLike above), so this is
      // undefined/null (not an error) whenever 3D terrain elevation isn't
      // active, in which case every tile below binds the flat fallback
      // instead and get_elevation() returns 0 uniformly.
      const terrain = (map as unknown as { terrain?: MapTerrainLike }).terrain
      gl.uniform1i(bundle.uTerrain, 1)

      for (const tileID of tileIDs) {
        const key = tileID.key
        const entry = this.textures.get(key)
        if (!entry) {
          this.fetchTile(tileID, key)
          continue
        }
        entry.lastUsed = this.frameCounter

        // Per-tile projection uniforms from MapLibre's own projection code.
        // These are exactly what shaderData.vertexShaderPrelude's projectTile()
        // consumes, so the SAME shader handles mercator and globe — the whole
        // point of routing through the prelude instead of a bare u_matrix.
        // applyGlobeMatrix:true so globe gets the sphere transform (ignored,
        // harmlessly, under mercator).
        const p = map.transform.getProjectionData({ overscaledTileID: tileID, applyGlobeMatrix: true })
        gl.uniformMatrix4fv(bundle.uProjectionMatrix, false, p.mainMatrix)
        gl.uniform4f(bundle.uProjectionTileMercatorCoords, p.tileMercatorCoords[0], p.tileMercatorCoords[1], p.tileMercatorCoords[2], p.tileMercatorCoords[3])
        gl.uniform4f(bundle.uProjectionClippingPlane, p.clippingPlane[0], p.clippingPlane[1], p.clippingPlane[2], p.clippingPlane[3])
        gl.uniform1f(bundle.uProjectionTransition, p.projectionTransition)
        gl.uniformMatrix4fv(bundle.uProjectionFallbackMatrix, false, p.fallbackMatrix)

        // Same DEM texture + uniforms MapLibre's own terrain.vertex.glsl reads
        // for this exact tile (see this file's header comment) — get_elevation()
        // in TERRAIN_PRELUDE samples them identically, so the mesh displaces
        // onto the SAME surface MapLibre's native terrain rendering computes,
        // no independently-fetched/meshed DEM involved.
        gl.activeTexture(gl.TEXTURE1)
        if (terrain) {
          const td = terrain.getTerrainData(tileID)
          gl.bindTexture(gl.TEXTURE_2D, td.texture)
          gl.uniform1f(bundle.uTerrainDim, td.u_terrain_dim)
          gl.uniformMatrix4fv(bundle.uTerrainMatrix, false, td.u_terrain_matrix)
          gl.uniform4fv(bundle.uTerrainUnpack, td.u_terrain_unpack)
          gl.uniform1f(bundle.uTerrainExaggeration, td.u_terrain_exaggeration)
        } else {
          gl.bindTexture(gl.TEXTURE_2D, this.flatTerrainTexture)
          gl.uniform1f(bundle.uTerrainDim, 1)
          gl.uniformMatrix4fv(bundle.uTerrainMatrix, false, PhongLiveLayer.FLAT_TERRAIN_MATRIX)
          gl.uniform4fv(bundle.uTerrainUnpack, PhongLiveLayer.FLAT_TERRAIN_UNPACK)
          gl.uniform1f(bundle.uTerrainExaggeration, 1)
        }

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, entry.texture)
        gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0)
      }

      this.pruneTextures()
    } catch (err) {
      if (!this.loggedError) {
        console.error("[phong-live-gl-layer] render() failed — disabling further logging for this instance:", err)
        this.loggedError = true
      }
    } finally {
      gl.bindVertexArray(null)
      gl.useProgram(null)
    }
  }
}
