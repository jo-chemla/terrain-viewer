// Shared scaffolding of the live ("Fast") Phong and Matcap layers
// (phong-live-gl-layer.ts, matcap-live-gl-layer.ts): per-tile Float32 DEM
// textures, shaded per fragment by the subclass, drawn two ways.
//
//  - Terrain off (2D, mercator or globe): render() draws each covering tile
//    as a flat mesh through MapLibre's own projection prelude
//    (shaderData.vertexShaderPrelude's projectTile), straight onto the map.
//    The program is compiled per projection variant (shaderData.variantName).
//  - Terrain on: MapLibre 6.13's experimental renderToTerrainTile hook
//    (PR #8588). MapLibre calls it instead of render(), once per terrain
//    tile, with that tile's render-to-texture target bound and clip space
//    = the tile (-1,-1 south-west, 1,1 north-east), then drapes the texture
//    over the relief together with the raster/fill/hillshade layers of the
//    same stack. The layer draws flat quads: its DEM tiles at the zoom whose
//    texels match the target's pixels (children of the terrain tile, or a
//    sub-rectangle of an ancestor past the DEM's maxzoom), a loaded ancestor
//    standing in while a tile loads. This replaced a hand-built drape (own
//    128-cell meshes with skirts, displaced through a copy of MapLibre's
//    get_elevation prelude and map.terrain.getTerrainData, resolved in an
//    offscreen depth buffer): the drape is now MapLibre's own surface.
//
// MapLibre caches the terrain-tile textures and redraws them when
// terrainTileRevision changes. Here it is a getter: it moves on every option
// change, on every texture arriving, and, while the shading depends on the
// view (camera-anchored light or matcap, Fresnel rim), whenever the bearing or
// pitch moved since it was last read. MapLibre reads it once per frame before
// drawing, so a rotation redraws the draped tiles in the same frame (every
// terrain tile, every frame of the gesture: the cost of view-dependent
// shading on a cached drape).
import type { CustomLayerInterface, CustomRenderMethodInput, CustomTerrainRenderInput, Map as MapLibreMap } from "maplibre-gl"
import { createTileMesh } from "maplibre-gl"
import { computeNormalPixels } from "./normals-protocol"
import { groundResolutionM, tileRowToLatRad, RAD_TO_DEG, type UpstreamEncoding } from "./normal-derived-protocol"

export type LiveDemOptions = {
  upstreamTemplate: string
  encoding: UpstreamEncoding
  tileSize: number
  minzoom?: number
  maxzoom?: number
}

type TileXYZ = { z: number; x: number; y: number }

interface DemTexture {
  texture: WebGLTexture
  lastUsed: number
  /** 1 / (mercator-corrected meters per pixel) at the tile's center latitude:
   *  the per-tile half of the Horn gradient (u_invGroundRes). */
  invGroundRes: number
}

/** The parts of the (publicly untyped) `map.terrain` read here. */
interface MapTerrainLike {
  qualityFactor?: number
  tileManager?: { tileSize?: number; getRenderableTiles?: () => ({ tileID: { canonical: TileXYZ } } | undefined)[] }
}

// Bounds GPU memory (about 1 MB per 512 px tile) over long sessions; the
// prune never evicts a tile used this frame (see pruneTextures).
const MAX_CACHED_TEXTURES = 96
// At most 4^3 DEM tiles per terrain tile, and ancestors this far up as
// stand-ins while a tile loads.
const MAX_CHILD_DEPTH = 3
const MAX_FALLBACK_DEPTH = 8
// 2D mesh subdivision: enough vertices to curve a low-zoom tile on the globe.
const MESH_GRANULARITY = 64

// Per-fragment normals from the tile's Float32 elevation grid, spliced into
// both layers' fragment shaders. The grid is the fetchPaddedElevationGrid
// product (1-texel halo stitched from the real neighbours), so the Horn
// stencil never sees a seam; evaluating it per fragment on the bilinear
// surface is what MapLibre's own hillshade does per device pixel (see
// .claude/memory/phong-live-sharpness.md for the baked-normal history).
export const DEM_NORMAL_GLSL = `
// (n+2)x(n+2) R32F padded elevation grid. NEAREST + texelFetch only — no
// float-linear extension needed; filtering happens manually in demAt() so
// the derivative is evaluated on the exact bilinear surface everywhere.
uniform highp sampler2D u_dem;
uniform float u_demDim;        // n — the tile's own pixel count (texture is n+2)
uniform float u_invGroundRes;  // 1 / (mercator-corrected meters per pixel) at this tile

float demTexel(ivec2 c) {
  // c is a tile-pixel index in [-1, n]; +1 shifts into the padded texture.
  // The clamp only engages for a tile-edge fragment's outer stencil taps —
  // the same positions the CPU pipeline's own edge pixels clamped.
  return texelFetch(u_dem, clamp(c + ivec2(1), ivec2(0), ivec2(int(u_demDim) + 1)), 0).r;
}

// Bilinear elevation at continuous tile-pixel coords p in [0, n].
float demAt(vec2 p) {
  vec2 base = p - 0.5;
  ivec2 i = ivec2(floor(base));
  vec2 f = base - vec2(i);
  float e00 = demTexel(i);
  float e10 = demTexel(i + ivec2(1, 0));
  float e01 = demTexel(i + ivec2(0, 1));
  float e11 = demTexel(i + ivec2(1, 1));
  return mix(mix(e00, e10, f.x), mix(e01, e11, f.x), f.y);
}

// Numerically identical to normal-derived-protocol.ts's hornGradient — same
// weights, same signs (dx is west − east, NEGATED vs standard; dy is
// south − north), same DELIBERATE absence of the textbook /8. Every consumer
// is calibrated to it: do not "fix" it here.
vec2 hornDxDy(vec2 p) {
  float a0 = demAt(p + vec2(-1.0, -1.0));
  float a1 = demAt(p + vec2( 0.0, -1.0));
  float a2 = demAt(p + vec2( 1.0, -1.0));
  float a3 = demAt(p + vec2(-1.0,  0.0));
  float a5 = demAt(p + vec2( 1.0,  0.0));
  float a6 = demAt(p + vec2(-1.0,  1.0));
  float a7 = demAt(p + vec2( 0.0,  1.0));
  float a8 = demAt(p + vec2( 1.0,  1.0));
  return vec2(
    (a0 + a3 + a3 + a6 - (a2 + a5 + a5 + a8)) * u_invGroundRes,
    (a6 + a7 + a7 + a8 - (a0 + a1 + a1 + a2)) * u_invGroundRes
  );
}

// (x=east, y=south, z=up) tile-local unit normal — the CPU path's
// normalize(vec3(-dx, -dy, 1)) with live exaggeration.
vec3 demNormal(vec2 uv, float exaggeration) {
  vec2 g = hornDxDy(uv * u_demDim);
  return normalize(vec3(-g * exaggeration, 1.0));
}
`

// 2D: the tile's mesh through MapLibre's projection prelude. u_uvRect maps
// the tile onto the DEM texture actually bound (itself, or the matching
// sub-rectangle of a loaded ancestor).
function mapTileVertexShader(prelude: string, define: string): string {
  return `#version 300 es
${prelude}
${define}
in vec2 a_pos;
uniform vec4 u_uvRect;
out vec2 v_uv;
void main() {
  v_uv = mix(u_uvRect.xy, u_uvRect.zw, a_pos / 8192.0);
  gl_Position = projectTile(a_pos);
}
`
}

// Terrain tile: one attribute-less quad (TRIANGLE_STRIP of 4) in the terrain
// tile's clip space; corner (0,0) is the north-west one, (1,1) the south-east.
const TERRAIN_TILE_VERT = `#version 300 es
uniform vec4 u_rect;   // clip x, y of the north-west then the south-east corner
uniform vec4 u_uvRect; // the same corners in the DEM texture (v grows south)
out vec2 v_uv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  v_uv = mix(u_uvRect.xy, u_uvRect.zw, c);
  gl_Position = vec4(mix(u_rect.xy, u_rect.zw, c), 0.0, 1.0);
}
`

/** Clip rect of region r inside terrain tile t, and r's uv inside DEM tile a.
 *  r is the finest of the three and lies inside both (quadtree nesting), so
 *  everything is exact in tile units of r's zoom. */
function quadFor(t: TileXYZ, r: TileXYZ, a: TileXYZ): { rect: [number, number, number, number]; uv: [number, number, number, number] } {
  const ts = 2 ** (r.z - t.z), tx = t.x * ts, ty = t.y * ts
  const as = 2 ** (r.z - a.z), ax = a.x * as, ay = a.y * as
  return {
    rect: [((r.x - tx) / ts) * 2 - 1, 1 - ((r.y - ty) / ts) * 2, ((r.x + 1 - tx) / ts) * 2 - 1, 1 - ((r.y + 1 - ty) / ts) * 2],
    uv: [(r.x - ax) / as, (r.y - ay) / as, (r.x + 1 - ax) / as, (r.y + 1 - ay) / as],
  }
}

const keyOf = (t: TileXYZ) => `${t.z}/${t.x}/${t.y}`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string, tag: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`[${tag}] shader compile failed: ${info}`)
  }
  return shader
}

function compileProgram(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string, tag: string): WebGLProgram {
  const program = gl.createProgram()!
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSrc, tag))
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc, tag))
  // a_pos at location 0 for every 2D variant, so the one mesh VAO fits all.
  gl.bindAttribLocation(program, 0, "a_pos")
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`[${tag}] program link failed: ${info}`)
  }
  return program
}

export abstract class LiveDemGlLayer<O extends LiveDemOptions> implements CustomLayerInterface {
  id: string
  type = "custom" as const
  renderingMode = "2d" as const
  options: O

  protected map: MapLibreMap | null = null
  protected gl: WebGL2RenderingContext | null = null
  protected disposed = false
  /** Log prefix, e.g. "phong-live-gl-layer". */
  protected abstract readonly tag: string
  /** Fragment shader: `in vec2 v_uv` (the DEM tile's uv), DEM_NORMAL_GLSL spliced in. */
  protected abstract readonly fragmentShader: string

  private mapPrograms = new Map<string, WebGLProgram>()
  private terrainProgram: WebGLProgram | null = null
  private uniformCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
  private meshVao: WebGLVertexArrayObject | null = null
  private emptyVao: WebGLVertexArrayObject | null = null
  private meshBuffers: WebGLBuffer[] = []
  private indexCount = 0
  private indexType = 0
  private textures = new Map<string, DemTexture>()
  private pending = new Set<string>()
  private frameCounter = 0
  private loggedError = false
  private loggedFetchError = false
  private revision = 0
  private viewKey = ""

  constructor(id: string, options: O) {
    this.id = id
    this.options = options
  }

  /** Whether the shading depends on the camera's bearing or pitch. */
  protected abstract viewDependent(): boolean
  /** Sets the shading uniforms (and binds extra textures, units 1+) on the bound program. */
  protected abstract setShadingUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): void
  /** Sets the blending and calls drawAll() once per pass, over whatever framebuffer is bound. */
  protected abstract drawPasses(gl: WebGL2RenderingContext, program: WebGLProgram, drawAll: () => void): void
  /** False while a resource the shading needs is still loading (draw nothing). */
  protected ready(_gl: WebGL2RenderingContext): boolean { return true }

  /** Read by MapLibre once per frame (see the header comment). */
  get terrainTileRevision(): number {
    const map = this.map
    if (map && this.viewDependent()) {
      const key = `${map.getBearing()},${map.getPitch()}`
      if (key !== this.viewKey) {
        this.viewKey = key
        this.revision++
      }
    }
    return this.revision
  }

  /** Something drawn changed: redraw the draped terrain tiles and the map. */
  protected changed() {
    this.revision++
    this.map?.triggerRepaint()
  }

  /** Live parameter update: uniforms only, no remount, no refetch. A new DEM
   *  (template/encoding/tileSize) needs a fresh instance instead — the cache
   *  is keyed by z/x/y only; the React wrappers remount for that. */
  updateOptions(patch: Partial<O>) {
    this.options = { ...this.options, ...patch }
    this.changed()
  }

  protected uniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation | null {
    let cache = this.uniformCache.get(program)
    if (!cache) this.uniformCache.set(program, (cache = new Map()))
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name))
    return cache.get(name)!
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    this.gl = gl
    const mesh = createTileMesh({ granularity: MESH_GRANULARITY })
    this.meshVao = gl.createVertexArray()
    gl.bindVertexArray(this.meshVao)
    const vertexBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.SHORT, false, 0, 0)
    const indexBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW)
    this.indexType = mesh.uses32bitIndices ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
    this.indexCount = mesh.indices.byteLength / (mesh.uses32bitIndices ? 4 : 2)
    gl.bindVertexArray(null)
    this.meshBuffers = [vertexBuffer, indexBuffer]
    // No attribute enabled: the terrain-tile quad comes from gl_VertexID.
    this.emptyVao = gl.createVertexArray()
    this.terrainProgram = compileProgram(gl, TERRAIN_TILE_VERT, this.fragmentShader, this.tag)
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.disposed = true
    for (const entry of this.textures.values()) gl.deleteTexture(entry.texture)
    this.textures.clear()
    this.pending.clear()
    for (const program of this.mapPrograms.values()) gl.deleteProgram(program)
    this.mapPrograms.clear()
    if (this.terrainProgram) gl.deleteProgram(this.terrainProgram)
    this.terrainProgram = null
    this.uniformCache.clear()
    for (const b of this.meshBuffers) gl.deleteBuffer(b)
    this.meshBuffers = []
    if (this.meshVao) gl.deleteVertexArray(this.meshVao)
    if (this.emptyVao) gl.deleteVertexArray(this.emptyVao)
    this.meshVao = this.emptyVao = null
    this.gl = null
    this.map = null
  }

  private mapProgram(gl: WebGL2RenderingContext, shaderData: CustomRenderMethodInput["shaderData"]): WebGLProgram {
    let program = this.mapPrograms.get(shaderData.variantName)
    if (!program) {
      program = compileProgram(gl, mapTileVertexShader(shaderData.vertexShaderPrelude, shaderData.define), this.fragmentShader, this.tag)
      this.mapPrograms.set(shaderData.variantName, program)
    }
    return program
  }

  private fetchTile(t: TileXYZ, key: string) {
    if (this.pending.has(key)) return
    this.pending.add(key)
    const { z, x, y } = t
    // computeNormalPixels for its refcounted cache, abort handling and
    // neighbour-stitched fetch (shared with the raster protocols); only its
    // Float32 `grid` is used here, the baked normals ride along unused.
    computeNormalPixels(this.options.upstreamTemplate, this.options.encoding, z, x, y, this.options.tileSize, new AbortController().signal)
      .then(({ grid }) => {
        this.pending.delete(key)
        if (this.disposed || !this.gl) return
        const gl = this.gl
        const texture = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        // NEAREST: the shader texelFetches and does its own bilinear.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, grid.stride, grid.stride, 0, gl.RED, gl.FLOAT, grid.padded)
        const latCenterDeg = tileRowToLatRad(y + 0.5, z) * RAD_TO_DEG
        const invGroundRes = 1 / groundResolutionM(latCenterDeg, z, this.options.tileSize)
        this.textures.set(key, { texture, lastUsed: this.frameCounter, invGroundRes })
        this.changed()
      })
      .catch((err) => {
        this.pending.delete(key)
        if (err?.name !== "AbortError" && !this.loggedFetchError) {
          this.loggedFetchError = true
          console.error(`[${this.tag}] DEM tile fetch/compute failed (z${z}/${x}/${y}); template=${this.options.upstreamTemplate}`, err)
        }
      })
  }

  /** The texture to draw for tile w: its own, else (fetching it) the nearest
   *  loaded ancestor. Marks what it returns as used this frame. */
  private resolve(w: TileXYZ): { entry: DemTexture; a: TileXYZ } | null {
    const key = keyOf(w)
    const own = this.textures.get(key)
    if (own) {
      own.lastUsed = this.frameCounter
      return { entry: own, a: w }
    }
    this.fetchTile(w, key)
    const minzoom = this.options.minzoom ?? 0
    for (let k = 1; k <= MAX_FALLBACK_DEPTH && w.z - k >= minzoom; k++) {
      const a = { z: w.z - k, x: Math.floor(w.x / 2 ** k), y: Math.floor(w.y / 2 ** k) }
      const entry = this.textures.get(keyOf(a))
      if (entry) {
        entry.lastUsed = this.frameCounter
        return { entry, a }
      }
    }
    return null
  }

  /** The DEM tiles to draw into terrain tile t, rendered at rttSize pixels:
   *  MapLibre sizes those textures for rttSize / qualityFactor CSS pixels, so
   *  the zoom is picked, as on the 2D path, for DEM texels ≈ device pixels. */
  private wantedTiles(t: TileXYZ, rttSize: number, qualityFactor: number): TileXYZ[] {
    const { tileSize, minzoom = 0, maxzoom = 22 } = this.options
    const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1
    const depth = Math.min(MAX_CHILD_DEPTH, Math.max(0, Math.round(Math.log2((rttSize / qualityFactor) * dpr / tileSize))))
    const zL = Math.min(maxzoom, Math.max(minzoom, t.z + depth))
    if (zL - t.z > MAX_CHILD_DEPTH) return []
    if (zL <= t.z) {
      const k = t.z - zL
      return [{ z: zL, x: Math.floor(t.x / 2 ** k), y: Math.floor(t.y / 2 ** k) }]
    }
    const n = 2 ** (zL - t.z)
    const out: TileXYZ[] = []
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push({ z: zL, x: t.x * n + i, y: t.y * n + j })
    return out
  }

  private terrainDraws(t: TileXYZ, rttSize: number, qualityFactor: number) {
    const draws: { entry: DemTexture; rect: number[]; uv: number[] }[] = []
    for (const w of this.wantedTiles(t, rttSize, qualityFactor)) {
      const hit = this.resolve(w)
      if (!hit) continue
      const r = w.z >= t.z ? w : t
      const { rect, uv } = quadFor(t, r, hit.a)
      draws.push({ entry: hit.entry, rect, uv })
    }
    return draws
  }

  private pruneTextures() {
    if (this.textures.size <= MAX_CACHED_TEXTURES) return
    const byAge = [...this.textures.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    const overflow = byAge.length - MAX_CACHED_TEXTURES
    for (let i = 0; i < overflow; i++) {
      const [key, entry] = byAge[i]
      // Never evict a tile used this frame: a view needing more than the cap
      // would otherwise evict, refetch and evict its own tiles forever (the
      // churn the old fixed /2 zoom bump caused). Sorted ascending, so stop.
      if (entry.lastUsed >= this.frameCounter) break
      this.gl?.deleteTexture(entry.texture)
      this.textures.delete(key)
    }
  }

  private setCommonUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
    gl.uniform1i(this.uniform(gl, program, "u_dem"), 0)
    gl.uniform1f(this.uniform(gl, program, "u_demDim"), this.options.tileSize)
    this.setShadingUniforms(gl, program)
    gl.activeTexture(gl.TEXTURE0)
  }

  private logOnce(where: string, err: unknown) {
    if (this.loggedError) return
    this.loggedError = true
    console.error(`[${this.tag}] ${where} failed — disabling further logging for this instance:`, err)
  }

  /** Terrain on: once per frame, before MapLibre redraws any terrain tile.
   *  Marks (and fetches) the DEM tiles every renderable terrain tile wants,
   *  so the prune keeps the ones cached drape textures were drawn from. */
  prerender(gl: WebGL2RenderingContext) {
    const terrain = (this.map as unknown as { terrain?: MapTerrainLike } | null)?.terrain
    if (!terrain) return
    try {
      this.frameCounter++
      this.ready(gl)
      const qualityFactor = terrain.qualityFactor ?? 2
      const rttSize = (terrain.tileManager?.tileSize ?? 512) * qualityFactor
      for (const tile of terrain.tileManager?.getRenderableTiles?.() ?? []) {
        if (!tile) continue
        for (const w of this.wantedTiles(tile.tileID.canonical, rttSize, qualityFactor)) this.resolve(w)
      }
      this.pruneTextures()
    } catch (err) {
      this.logOnce("prerender()", err)
    }
  }

  /** Terrain on: draws the layer's flat shading for one terrain tile into the
   *  bound tile target (see the header comment). */
  renderToTerrainTile(gl: WebGL2RenderingContext, { tileID, width }: CustomTerrainRenderInput) {
    const program = this.terrainProgram
    const terrain = (this.map as unknown as { terrain?: MapTerrainLike } | null)?.terrain
    if (!program || !this.emptyVao) return
    try {
      if (!this.ready(gl)) return
      const draws = this.terrainDraws(tileID.canonical, width, terrain?.qualityFactor ?? 2)
      if (!draws.length) return
      gl.useProgram(program)
      gl.bindVertexArray(this.emptyVao)
      this.setCommonUniforms(gl, program)
      const uRect = this.uniform(gl, program, "u_rect")
      const uUvRect = this.uniform(gl, program, "u_uvRect")
      const uInvGroundRes = this.uniform(gl, program, "u_invGroundRes")
      this.drawPasses(gl, program, () => {
        for (const d of draws) {
          gl.bindTexture(gl.TEXTURE_2D, d.entry.texture)
          gl.uniform1f(uInvGroundRes, d.entry.invGroundRes)
          gl.uniform4fv(uRect, d.rect)
          gl.uniform4fv(uUvRect, d.uv)
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        }
      })
    } catch (err) {
      this.logOnce("renderToTerrainTile()", err)
    } finally {
      gl.bindVertexArray(null)
      gl.useProgram(null)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    }
  }

  /** Terrain off (2D, mercator or globe): the covering tiles, flat, onto the map. */
  render(glArg: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    // The shaders are #version 300 es: the context is always WebGL2 here.
    const gl = glArg as WebGL2RenderingContext
    const map = this.map
    if (!map || !this.meshVao) return
    // An exception here would abort the rest of MapLibre's frame (the whole
    // map blanks); the finally restores the program/VAO/blend either way.
    try {
      if (!this.ready(gl)) return
      const program = this.mapProgram(gl, args.shaderData)
      this.frameCounter++
      // tileSize / dpr: one extra zoom level on hi-dpi screens so DEM texels
      // ≈ device pixels (user-approved 2026-08-20; never a fixed extra level,
      // see pruneTextures).
      const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1
      const tileIDs = map.coveringTiles({
        tileSize: Math.max(1, Math.round(this.options.tileSize / dpr)),
        minzoom: this.options.minzoom,
        maxzoom: this.options.maxzoom,
      })
      const draws: { tileID: (typeof tileIDs)[number]; entry: DemTexture; uv: number[] }[] = []
      for (const tileID of tileIDs) {
        const w = tileID.canonical
        const hit = this.resolve(w)
        if (hit) draws.push({ tileID, entry: hit.entry, uv: quadFor(w, w, hit.a).uv })
      }

      gl.useProgram(program)
      gl.bindVertexArray(this.meshVao)
      // Covering tiles never overlap, so no depth is needed; MapLibre's
      // sublayer depth would only reject fragments on the globe.
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.STENCIL_TEST)
      this.setCommonUniforms(gl, program)
      const u = (name: string) => this.uniform(gl, program, name)
      this.drawPasses(gl, program, () => {
        for (const { tileID, entry, uv } of draws) {
          // MapLibre's projection uniforms for this tile, what the prelude's
          // projectTile() reads: the same shader serves mercator and globe.
          const p = args.getProjectionData({ tileID: { canonical: tileID.canonical, wrap: tileID.wrap }, applyGlobeMatrix: true })
          gl.uniformMatrix4fv(u("u_projection_matrix"), false, p.mainMatrix)
          gl.uniform4fv(u("u_projection_tile_mercator_coords"), p.tileMercatorCoords)
          gl.uniform4fv(u("u_projection_clipping_plane"), p.clippingPlane)
          gl.uniform1f(u("u_projection_transition"), p.projectionTransition)
          gl.uniformMatrix4fv(u("u_projection_fallback_matrix"), false, p.fallbackMatrix)
          gl.bindTexture(gl.TEXTURE_2D, entry.texture)
          gl.uniform1f(u("u_invGroundRes"), entry.invGroundRes)
          gl.uniform4fv(u("u_uvRect"), uv)
          gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0)
        }
      })
      this.pruneTextures()
    } catch (err) {
      this.logOnce("render()", err)
    } finally {
      gl.bindVertexArray(null)
      gl.useProgram(null)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    }
  }
}
