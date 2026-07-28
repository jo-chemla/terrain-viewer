// Live-uniform WebGL Matcap shading — the "Fast" alternative to
// lib/matcap-protocol.ts's raster-tile pipeline, mirroring
// lib/phong-live-gl-layer.ts's architecture closely (same per-tile normal
// texture, same terrain-drape scaffolding via map.terrain.getTerrainData() —
// see that file's header comment for the full derivation/history of both).
// The one genuinely different piece is the shading math itself: a plain
// matcap lookup samples the material image at UV = N.xy*0.5+0.5, which is
// really an ORTHOGRAPHIC simplification (implicitly assumes the view
// direction is a constant straight-down (0,0,1) everywhere on screen — exact
// at dead center, quietly wrong everywhere else once there's real
// perspective). This layer instead reconstructs a real per-fragment view
// ray from the fragment's screen position + the camera's actual field of
// view (both already exposed to a custom layer — screen position via
// gl_FragCoord/viewport size, FOV via CustomRenderMethodInput.fov) and
// reflects THAT off the surface normal, so a ray away from the optical axis
// (near a screen edge, or at a wide FOV) diverges accordingly and samples a
// different point on the matcap sphere than it would at screen center —
// the effect requested: "rays less centered in the camera frame get more
// reflected away by the same normal."
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap, OverscaledTileID } from "maplibre-gl"
import { createTileMesh } from "maplibre-gl"
import { computeNormalPixels } from "./normals-protocol"
import type { UpstreamEncoding } from "./normal-derived-protocol"

/** Shape of the real (but publicly untyped) `map.terrain` property — mirrors
 *  maplibre-gl's own `TerrainData` return shape for `getTerrainData()`. See
 *  phong-live-gl-layer.ts's header comment for the full story. */
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

// Identical to phong-live-gl-layer.ts's TERRAIN_PRELUDE — see that file for
// the full derivation (verbatim copy of maplibre-gl's own
// src/shaders/_prelude.vertex.glsl TERRAIN3D block, minus the depth/
// occlusion half neither live layer needs).
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

export type MatcapLiveOptions = {
  upstreamTemplate: string
  encoding: UpstreamEncoding
  tileSize: number
  minzoom?: number
  maxzoom?: number
  /** Material-capture image URL (lib/matcap-textures.ts). */
  matcapUrl: string
  /** Spins the material's apparent orientation only (never the surface
   *  geometry) — same "Sphere Rotation" convention as matcap-protocol.ts /
   *  gpu-matcap-compute.ts. */
  rotationDeg: number
  exaggeration: number
  opacity: number
}

const MAX_CACHED_TEXTURES = 96

// Identical to phong-live-gl-layer.ts's buildVertexShader.
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

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_normalMap;
uniform sampler2D u_matcap;
uniform float u_rotationRad;
uniform float u_exaggeration;
uniform float u_opacity;
uniform float u_fov;
uniform vec2 u_viewportSize;
out vec4 fragColor;

void main() {
  vec3 encoded = texture(u_normalMap, v_uv).rgb;
  vec3 raw = encoded * 2.0 - 1.0;

  // Reapply the current exaggeration live to the cached (unexaggerated)
  // normal, same reasoning as gpu-matcap-compute.ts.
  vec2 slope = (raw.xy / raw.z) * u_exaggeration;
  vec3 n = normalize(vec3(slope, 1.0));

  // Only the material's apparent orientation rotates (Sphere Rotation),
  // never the surface itself.
  float cb = cos(u_rotationRad);
  float sb = sin(u_rotationRad);
  vec3 rotatedN = vec3(n.x * cb + n.y * sb, -n.x * sb + n.y * cb, n.z);

  // Real per-fragment view ray instead of the orthographic-matcap
  // simplification's constant (0,0,1): reconstruct this fragment's NDC
  // position from gl_FragCoord + the actual viewport size, then scale by
  // the camera's own half-vertical-FOV tangent (aspect-corrected for X) to
  // get how far this ray cants away from the optical axis. At screen
  // center (ndc = 0) this reduces exactly to the orthographic case
  // (viewDir = (0,0,-1)); toward the edges, or at a wider FOV, the ray
  // diverges more, so the same surface normal reflects toward a different
  // point on the matcap sphere.
  vec2 ndc = (gl_FragCoord.xy / u_viewportSize) * 2.0 - 1.0;
  float halfFovTan = tan(u_fov * 0.5);
  float aspect = u_viewportSize.x / u_viewportSize.y;
  vec3 viewDir = normalize(vec3(ndc.x * halfFovTan * aspect, ndc.y * halfFovTan, -1.0));

  vec3 r = reflect(viewDir, rotatedN);
  vec2 uv = r.xy * 0.5 + 0.5;
  vec3 matcapColor = texture(u_matcap, uv).rgb;

  // Premultiplied — CustomLayerInterface.render's default blend func is
  // gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA), which expects that.
  fragColor = vec4(matcapColor * u_opacity, u_opacity);
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`[matcap-live-gl-layer] shader compile failed: ${info}`)
  }
  return shader
}

function compileProgram(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const program = gl.createProgram()!
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSrc))
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc))
  gl.bindAttribLocation(program, 0, "a_pos")
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`[matcap-live-gl-layer] program link failed: ${info}`)
  }
  return program
}

interface ProgramBundle {
  program: WebGLProgram
  uProjectionMatrix: WebGLUniformLocation | null
  uProjectionTileMercatorCoords: WebGLUniformLocation | null
  uProjectionClippingPlane: WebGLUniformLocation | null
  uProjectionTransition: WebGLUniformLocation | null
  uProjectionFallbackMatrix: WebGLUniformLocation | null
  uNormalMap: WebGLUniformLocation | null
  uMatcap: WebGLUniformLocation | null
  uRotationRad: WebGLUniformLocation | null
  uExaggeration: WebGLUniformLocation | null
  uOpacity: WebGLUniformLocation | null
  uFov: WebGLUniformLocation | null
  uViewportSize: WebGLUniformLocation | null
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

export class MatcapLiveLayer implements CustomLayerInterface {
  id: string
  type: "custom" = "custom"
  renderingMode: "2d" = "2d"
  options: MatcapLiveOptions

  private map: MapLibreMap | null = null
  private gl: WebGL2RenderingContext | null = null
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
  private flatTerrainTexture: WebGLTexture | null = null
  private static readonly FLAT_TERRAIN_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  private static readonly FLAT_TERRAIN_UNPACK = [0, 0, 0, 0]

  // The material image is independent of the DEM/tile pyramid, so (unlike
  // upstreamTemplate/encoding/tileSize) a matcapUrl change doesn't need a
  // full remount — render() notices the mismatch and kicks off a reload.
  private matcapTexture: WebGLTexture | null = null
  private matcapTextureUrl: string | null = null
  private matcapTextureLoading = false
  private loggedMatcapError = false

  constructor(id: string, options: MatcapLiveOptions) {
    this.id = id
    this.options = options
  }

  /** Live parameter update — no remount, no tile refetch/re-load, just a
   *  repaint with fresh uniform values (rotationDeg/exaggeration/opacity),
   *  or (matcapUrl) a one-time async texture swap picked up by render(). */
  updateOptions(patch: Partial<MatcapLiveOptions>) {
    this.options = { ...this.options, ...patch }
    this.map?.triggerRepaint()
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    this.gl = gl

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
    if (this.matcapTexture) gl.deleteTexture(this.matcapTexture)
    this.matcapTexture = null
    this.matcapTextureUrl = null
    if (this.vao) gl.deleteVertexArray(this.vao)
    this.vao = null
    this.gl = null
    this.map = null
  }

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
      uMatcap: gl.getUniformLocation(program, "u_matcap"),
      uRotationRad: gl.getUniformLocation(program, "u_rotationRad"),
      uExaggeration: gl.getUniformLocation(program, "u_exaggeration"),
      uOpacity: gl.getUniformLocation(program, "u_opacity"),
      uFov: gl.getUniformLocation(program, "u_fov"),
      uViewportSize: gl.getUniformLocation(program, "u_viewportSize"),
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
        if (err?.name !== "AbortError" && !this.loggedFetchError) {
          this.loggedFetchError = true
          console.error(`[matcap-live-gl-layer] normal-tile fetch/compute failed (z${z}/${x}/${y}); template=${this.options.upstreamTemplate}`, err)
        }
      })
  }

  /** Fetches + uploads the material image for a new matcapUrl — mirrors
   *  gpu-matcap-compute.ts's getMatcapTexture, instance-scoped here (rather
   *  than that module's shared cache) since this layer already owns its own
   *  GL resources end-to-end. */
  private loadMatcapTexture(gl: WebGL2RenderingContext, url: string) {
    this.matcapTextureLoading = true
    fetch(url)
      .then((res) => res.blob())
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        this.matcapTextureLoading = false
        if (this.disposed || !this.gl) return
        const texture = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        bitmap.close()
        if (this.matcapTexture) gl.deleteTexture(this.matcapTexture)
        this.matcapTexture = texture
        this.matcapTextureUrl = url
        this.map?.triggerRepaint()
      })
      .catch((err) => {
        this.matcapTextureLoading = false
        if (!this.loggedMatcapError) {
          this.loggedMatcapError = true
          console.error(`[matcap-live-gl-layer] material image fetch failed: ${url}`, err)
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
    const gl = glArg as WebGL2RenderingContext
    const map = this.map
    if (!map || !this.vao) return

    try {
      if (this.options.matcapUrl !== this.matcapTextureUrl && !this.matcapTextureLoading) {
        this.loadMatcapTexture(gl, this.options.matcapUrl)
      }
      // Nothing to draw with yet — same "wait for the first async load"
      // behavior phong-live-gl-layer.ts has for its first normal tile.
      if (!this.matcapTexture) return

      const bundle = this.getProgram(gl, args.shaderData)
      this.frameCounter++

      // Same DPR + extra-zoom-level adjustment as phong-live-gl-layer.ts —
      // see that file's render() comment for why.
      const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1
      const tileIDs = map.coveringTiles({
        tileSize: Math.max(1, Math.round(this.options.tileSize / dpr / 2)),
        minzoom: this.options.minzoom,
        maxzoom: this.options.maxzoom,
      })

      gl.useProgram(bundle.program)
      gl.bindVertexArray(this.vao)
      gl.uniform1i(bundle.uNormalMap, 0)
      gl.uniform1i(bundle.uMatcap, 2)
      gl.uniform1f(bundle.uRotationRad, (this.options.rotationDeg * Math.PI) / 180)
      gl.uniform1f(bundle.uExaggeration, this.options.exaggeration)
      gl.uniform1f(bundle.uOpacity, this.options.opacity)
      gl.uniform1f(bundle.uFov, args.fov)
      gl.uniform2f(bundle.uViewportSize, gl.drawingBufferWidth, gl.drawingBufferHeight)

      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, this.matcapTexture)

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

        const p = map.transform.getProjectionData({ overscaledTileID: tileID, applyGlobeMatrix: true })
        gl.uniformMatrix4fv(bundle.uProjectionMatrix, false, p.mainMatrix)
        gl.uniform4f(bundle.uProjectionTileMercatorCoords, p.tileMercatorCoords[0], p.tileMercatorCoords[1], p.tileMercatorCoords[2], p.tileMercatorCoords[3])
        gl.uniform4f(bundle.uProjectionClippingPlane, p.clippingPlane[0], p.clippingPlane[1], p.clippingPlane[2], p.clippingPlane[3])
        gl.uniform1f(bundle.uProjectionTransition, p.projectionTransition)
        gl.uniformMatrix4fv(bundle.uProjectionFallbackMatrix, false, p.fallbackMatrix)

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
          gl.uniformMatrix4fv(bundle.uTerrainMatrix, false, MatcapLiveLayer.FLAT_TERRAIN_MATRIX)
          gl.uniform4fv(bundle.uTerrainUnpack, MatcapLiveLayer.FLAT_TERRAIN_UNPACK)
          gl.uniform1f(bundle.uTerrainExaggeration, 1)
        }

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, entry.texture)
        gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0)
      }

      this.pruneTextures()
    } catch (err) {
      if (!this.loggedError) {
        console.error("[matcap-live-gl-layer] render() failed — disabling further logging for this instance:", err)
        this.loggedError = true
      }
    } finally {
      gl.bindVertexArray(null)
      gl.useProgram(null)
    }
  }
}
