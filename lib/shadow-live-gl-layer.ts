// Live GPU terrain shadows: the "live" renderer of Hard Shadows, next to the
// shadow:// tiles (lib/shadow-protocol.ts, kept for exports, the Iso-line and
// as the fallback). Idea 1 of docs/content/docs/dev/shadow-benchmark.mdx.
//
// What it does, once per frame on the GPU:
//  - The view's DEM tiles (the upstream the shadow:// tiles read, through the
//    same shared decoded-tile cache) are stitched into ONE Float32 texture,
//    the mosaic: about one DEM texel per CSS pixel, the view plus one tile on
//    every side, at most SHADOW_MOSAIC_MAX_TILES tiles (a coarser zoom when
//    the view is wider). Tiles go in with texSubImage2D as they arrive; a pan
//    inside the mosaic changes nothing, a pan out of it lays out a new one.
//  - Each fragment marches its own ray toward the sun across the mosaic:
//    exact bilinear samples of the R32F texels (texelFetch, no half floats,
//    no filtering extension), one-texel steps for 40 texels then steps
//    growing with the distance (lib/shadow-live-math.ts), until the ground
//    rises above the ray (shadow, no tolerance: low plateau edges are kept),
//    the ray leaves the mosaic, or the ray is above the mosaic's highest
//    point (lit). A sun change is two uniforms and a redraw.
//
// Drawn like lib/live-dem-gl-layer.ts's layers: with terrain off, the
// mosaic's tiles as flat meshes through MapLibre's projection prelude
// (mercator and globe); with terrain on, through renderToTerrainTile, one
// quad per terrain tile, MapLibre draping the result over the relief. The
// fragment shader gets the mosaic uv in both cases, so it is one shader.
//
// Written for this repository; Mapricot's shader (which the benchmark reads)
// carries no licence and none of it is used here.
import type { CustomLayerInterface, CustomRenderMethodInput, CustomTerrainRenderInput, Map as MapLibreMap } from "maplibre-gl"
import { createTileMesh } from "maplibre-gl"
import { compileProgram, mapTileVertexShader, TERRAIN_TILE_VERT } from "./live-dem-gl-layer"
import { fetchPaddedElevationGrid, sharedTileCache, type UpstreamEncoding } from "./normal-derived-protocol"
import {
  chooseMosaicLayout, layoutContains, lngLatToMercator, sunStepVector, sunTanAltitude,
  SHADOW_MAX_STEPS, SHADOW_MOSAIC_MAX_SIDE, SHADOW_STEP_GROWTH, type MosaicLayout,
} from "./shadow-live-math"

export type ShadowLiveOptions = {
  upstreamTemplate: string
  encoding: UpstreamEncoding
  tileSize: number
  minzoom?: number
  maxzoom?: number
  /** Sun, compass degrees clockwise from north and degrees above the horizon
   *  (state.illuminationDir / illuminationAlt, as the shadow:// tiles). */
  azimuthDeg: number
  altitudeDeg: number
  /** Shadow darkness, 0..1 (the raster layer's opacity in the tile renderer). */
  opacity: number
}

// Elevation written for texels with no data yet (a tile still loading, a hole
// in the DEM): far below any ground, so it never blocks a ray, and fragments
// whose own elevation blends it are not drawn.
const NODATA = -1e7
// Decoded tiles kept on the CPU to rebuild a moved mosaic without refetching.
const MAX_CACHED_GRIDS = 72
const MESH_GRANULARITY = 64
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_mosaic; // R32F, metres, row 0 = north
uniform vec2 u_size;              // mosaic size in texels
uniform float u_mercY0;           // Web Mercator y (0..1) of the mosaic's north edge
uniform float u_mercPerTexel;     // 1 / (tileSize * 2^z)
uniform vec2 u_sunStep;           // unit step toward the sun, texels (east, south)
uniform float u_tanAlt;           // tan(sun altitude); negative at night
uniform float u_maxElev;          // highest elevation in the mosaic
uniform float u_opacity;
in vec2 v_uv;                     // mosaic uv
out vec4 fragColor;

const float NODATA_BELOW = ${(NODATA / 10).toFixed(1)};
const float GROWTH = ${SHADOW_STEP_GROWTH.toFixed(8)};
const int MAX_STEPS = ${SHADOW_MAX_STEPS};
const float PI = 3.141592653589793;

float texel(ivec2 c) {
  return texelFetch(u_mosaic, clamp(c, ivec2(0), ivec2(u_size) - 1), 0).r;
}

// Bilinear elevation at continuous texel coords (centres at i + 0.5), in full
// float precision: four texelFetches, no hardware filtering.
float elevAt(vec2 p) {
  vec2 b = p - 0.5;
  ivec2 i = ivec2(floor(b));
  vec2 f = b - vec2(i);
  return mix(mix(texel(i), texel(i + ivec2(1, 0)), f.x), mix(texel(i + ivec2(0, 1)), texel(i + ivec2(1, 1)), f.x), f.y);
}

void main() {
  vec2 p = v_uv * u_size;
  if (p.x < 0.0 || p.y < 0.0 || p.x > u_size.x || p.y > u_size.y) discard;
  float h0 = elevAt(p);
  if (h0 < NODATA_BELOW) discard;
  bool shadow = u_tanAlt < 0.0;
  if (!shadow) {
    // Ground size of a texel at this fragment's latitude.
    float lat = atan(sinh(PI * (1.0 - 2.0 * (u_mercY0 + p.y * u_mercPerTexel))));
    float rise = u_tanAlt * ${EARTH_CIRCUMFERENCE_M.toFixed(3)} * cos(lat) * u_mercPerTexel;
    float d = 0.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      d += max(1.0, d * GROWTH);
      float ray = h0 + d * rise;
      if (ray > u_maxElev) break;
      vec2 q = p + u_sunStep * d;
      if (q.x < 0.5 || q.y < 0.5 || q.x > u_size.x - 0.5 || q.y > u_size.y - 0.5) break;
      if (elevAt(q) > ray) { shadow = true; break; }
    }
  }
  if (!shadow) discard;
  fragColor = vec4(0.0, 0.0, 0.0, u_opacity);
}
`

interface Grid { data: Float32Array; max: number }

const keyOf = (z: number, x: number, y: number) => `${z}/${x}/${y}`
const wrapX = (x: number, z: number) => ((x % 2 ** z) + 2 ** z) % 2 ** z

export class ShadowLiveLayer implements CustomLayerInterface {
  id: string
  type = "custom" as const
  renderingMode = "2d" as const
  options: ShadowLiveOptions
  /** Called once if the layer cannot draw here (shader or texture failure):
   *  the React wrapper then falls back to the shadow:// tiles. */
  onUnsupported?: (reason: string) => void

  private map: MapLibreMap | null = null
  private gl: WebGL2RenderingContext | null = null
  private disposed = false
  private failed = false
  private abort = new AbortController()
  private mapPrograms = new Map<string, WebGLProgram>()
  private terrainProgram: WebGLProgram | null = null
  private uniformCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
  private meshVao: WebGLVertexArrayObject | null = null
  private emptyVao: WebGLVertexArrayObject | null = null
  private meshBuffers: WebGLBuffer[] = []
  private indexCount = 0
  private indexType = 0
  private maxSide = SHADOW_MOSAIC_MAX_SIDE

  private grids = new Map<string, Grid>()
  private pending = new Set<string>()
  private mosaic: WebGLTexture | null = null
  private layout: MosaicLayout | null = null
  /** Per mosaic slot (row-major): whether its tile is in the texture. */
  private uploaded: boolean[] = []
  private maxElev = -Infinity
  private nodataTile: Float32Array | null = null
  private revision = 0
  private loggedFetchError = false

  constructor(id: string, options: ShadowLiveOptions) {
    this.id = id
    this.options = options
  }

  /** Read by MapLibre once per frame: the draped terrain tiles are redrawn when it moves. */
  get terrainTileRevision(): number {
    return this.revision
  }

  private changed() {
    this.revision++
    this.map?.triggerRepaint()
  }

  /** Sun and opacity: uniforms only. A new DEM needs a new instance (the wrapper remounts). */
  updateOptions(patch: Partial<ShadowLiveOptions>) {
    this.options = { ...this.options, ...patch }
    this.changed()
  }

  /** For the dev console and tests: what the layer currently holds. */
  debugState() {
    const loaded = this.uploaded.filter(Boolean).length
    return { layout: this.layout, loadedTiles: loaded, maxElev: this.maxElev, failed: this.failed, maxSteps: SHADOW_MAX_STEPS }
  }

  private uniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation | null {
    let cache = this.uniformCache.get(program)
    if (!cache) this.uniformCache.set(program, (cache = new Map()))
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name))
    return cache.get(name)!
  }

  private fail(where: string, err: unknown) {
    if (this.failed) return
    this.failed = true
    console.error(`[shadow-live-gl-layer] ${where} failed; falling back to the shadow:// tiles:`, err)
    this.onUnsupported?.(`${where}: ${err instanceof Error ? err.message : String(err)}`)
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    this.gl = gl
    try {
      this.maxSide = Math.min(SHADOW_MOSAIC_MAX_SIDE, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number)
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
      this.emptyVao = gl.createVertexArray()
      this.terrainProgram = compileProgram(gl, TERRAIN_TILE_VERT, FRAGMENT_SHADER, "shadow-live-gl-layer")
    } catch (err) {
      this.fail("onAdd()", err)
    }
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.disposed = true
    this.abort.abort()
    if (this.mosaic) gl.deleteTexture(this.mosaic)
    this.mosaic = null
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
    this.grids.clear()
    this.pending.clear()
    this.gl = null
    this.map = null
  }

  // ─── Mosaic ───────────────────────────────────────────────────────────────

  private fetchGrid(z: number, x: number, y: number) {
    const key = keyOf(z, x, y)
    if (this.pending.has(key) || this.grids.has(key)) return
    this.pending.add(key)
    const n = this.options.tileSize
    fetchPaddedElevationGrid(sharedTileCache, this.options.upstreamTemplate, this.options.encoding, z, x, y, n, this.abort.signal, 0)
      .then(({ padded, paddedValid }) => {
        this.pending.delete(key)
        if (this.disposed) return
        // halo 0: padded is the tile itself, n × n, a fresh array.
        let max = -Infinity
        for (let i = 0; i < padded.length; i++) {
          const v = padded[i]
          if ((paddedValid && !paddedValid[i]) || !Number.isFinite(v)) padded[i] = NODATA
          else if (v > max) max = v
        }
        this.grids.set(key, { data: padded, max })
        this.pruneGrids()
        this.map?.triggerRepaint()
      })
      .catch((err) => {
        this.pending.delete(key)
        if (err?.name !== "AbortError" && !this.disposed && !this.loggedFetchError) {
          this.loggedFetchError = true
          console.error(`[shadow-live-gl-layer] DEM tile fetch failed (z${z}/${x}/${y}); template=${this.options.upstreamTemplate}`, err)
        }
      })
  }

  /** Drops the oldest decoded tiles outside the current mosaic. */
  private pruneGrids() {
    if (this.grids.size <= MAX_CACHED_GRIDS) return
    const keep = new Set(this.slotKeys())
    for (const key of this.grids.keys()) {
      if (this.grids.size <= MAX_CACHED_GRIDS) break
      if (!keep.has(key)) this.grids.delete(key)
    }
  }

  private slotKeys(): string[] {
    const l = this.layout
    if (!l) return []
    const keys: string[] = []
    for (let j = 0; j < l.ny; j++) for (let i = 0; i < l.nx; i++) keys.push(keyOf(l.z, wrapX(l.x0 + i, l.z), l.y0 + j))
    return keys
  }

  /** Uploads one tile's grid (or the no-data fill) into its mosaic slot. */
  private uploadSlot(gl: WebGL2RenderingContext, i: number, j: number, data: Float32Array) {
    const n = this.options.tileSize
    gl.texSubImage2D(gl.TEXTURE_2D, 0, i * n, j * n, n, n, gl.RED, gl.FLOAT, data)
  }

  private setLayout(gl: WebGL2RenderingContext, layout: MosaicLayout) {
    const n = this.options.tileSize
    const prev = this.layout
    const sameSize = prev && prev.nx === layout.nx && prev.ny === layout.ny
    this.layout = layout
    this.uploaded = new Array(layout.nx * layout.ny).fill(false)
    if (!this.mosaic || !sameSize) {
      if (this.mosaic) gl.deleteTexture(this.mosaic)
      this.mosaic = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.mosaic)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, layout.nx * n, layout.ny * n)
    }
    // Slots whose tile is not decoded yet start as no data; the others are
    // filled by updateMosaic's pass right after this.
    if (!this.nodataTile || this.nodataTile.length !== n * n) this.nodataTile = new Float32Array(n * n).fill(NODATA)
    gl.bindTexture(gl.TEXTURE_2D, this.mosaic)
    for (let j = 0; j < layout.ny; j++) {
      for (let i = 0; i < layout.nx; i++) {
        if (!this.grids.has(keyOf(layout.z, wrapX(layout.x0 + i, layout.z), layout.y0 + j))) this.uploadSlot(gl, i, j, this.nodataTile)
      }
    }
    this.maxElev = -Infinity
  }

  /** Once per frame, before any draw: picks the mosaic for the view, fetches
   *  its missing tiles and uploads the ones that arrived. */
  private updateMosaic(gl: WebGL2RenderingContext) {
    const map = this.map
    if (!map) return
    const b = map.getBounds()
    const [x0, y0] = lngLatToMercator(b.getWest(), b.getNorth())
    const [x1, y1] = lngLatToMercator(b.getEast(), b.getSouth())
    const bounds = { x0, y0, x1, y1 }
    const { tileSize, minzoom, maxzoom } = this.options
    const opts = { minzoom, maxzoom, maxSide: this.maxSide }
    const needed = chooseMosaicLayout(bounds, map.getZoom(), tileSize, { ...opts, margin: 1, preferZ: this.layout?.z })
    if (!needed) return
    const pixelStore = this.saveUnpackState(gl)
    let uploadedAny = false
    try {
      if (!this.layout || !layoutContains(this.layout, needed)) {
        // A second tile of slack where it fits, so small pans keep the mosaic.
        const roomy = chooseMosaicLayout(bounds, map.getZoom(), tileSize, { ...opts, margin: 2, preferZ: needed.z })
        this.setLayout(gl, roomy && roomy.z === needed.z ? roomy : needed)
        this.revision++
      }
      const l = this.layout!
      gl.bindTexture(gl.TEXTURE_2D, this.mosaic)
      for (let j = 0; j < l.ny; j++) {
        for (let i = 0; i < l.nx; i++) {
          const slot = j * l.nx + i
          if (this.uploaded[slot]) continue
          const x = wrapX(l.x0 + i, l.z), y = l.y0 + j
          const grid = this.grids.get(keyOf(l.z, x, y))
          if (!grid) { this.fetchGrid(l.z, x, y); continue }
          this.uploadSlot(gl, i, j, grid.data)
          this.uploaded[slot] = true
          if (grid.max > this.maxElev) this.maxElev = grid.max
          uploadedAny = true
        }
      }
    } finally {
      this.restoreUnpackState(gl, pixelStore)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    if (uploadedAny) this.revision++
  }

  // MapLibre caches the pixel-store state it set; leave it as found.
  private saveUnpackState(gl: WebGL2RenderingContext) {
    const s = {
      flipY: gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean,
      premultiply: gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean,
      alignment: gl.getParameter(gl.UNPACK_ALIGNMENT) as number,
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    return s
  }

  private restoreUnpackState(gl: WebGL2RenderingContext, s: { flipY: boolean; premultiply: boolean; alignment: number }) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, s.flipY)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, s.premultiply)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, s.alignment)
  }

  /** Mosaic uv of the NW and SE corners of tile (z, x unwrapped, y). */
  private uvRect(z: number, x: number, y: number): [number, number, number, number] {
    const l = this.layout!
    const k = 2 ** (l.z - z)
    let gx = x * k
    // A whole-world mosaic: bring the tile into the mosaic's own world copy.
    const s = 2 ** l.z
    if (l.nx === s) gx = ((gx - l.x0) % s + s) % s + l.x0
    const gy = y * k
    return [(gx - l.x0) / l.nx, (gy - l.y0) / l.ny, (gx + k - l.x0) / l.nx, (gy + k - l.y0) / l.ny]
  }

  // ─── Drawing ──────────────────────────────────────────────────────────────

  private ready(): boolean {
    return !this.failed && !!this.mosaic && !!this.layout && this.maxElev > -Infinity
  }

  private setShadingUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
    const l = this.layout!
    const n = this.options.tileSize
    const u = (name: string) => this.uniform(gl, program, name)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.mosaic)
    gl.uniform1i(u("u_mosaic"), 0)
    gl.uniform2f(u("u_size"), l.nx * n, l.ny * n)
    gl.uniform1f(u("u_mercY0"), l.y0 / 2 ** l.z)
    gl.uniform1f(u("u_mercPerTexel"), 1 / (n * 2 ** l.z))
    const [sx, sy] = sunStepVector(this.options.azimuthDeg)
    gl.uniform2f(u("u_sunStep"), sx, sy)
    gl.uniform1f(u("u_tanAlt"), sunTanAltitude(this.options.altitudeDeg))
    gl.uniform1f(u("u_maxElev"), this.maxElev)
    gl.uniform1f(u("u_opacity"), Math.max(0, Math.min(1, this.options.opacity)))
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  prerender(gl: WebGL2RenderingContext) {
    if (this.failed || !this.map) return
    try {
      this.updateMosaic(gl)
    } catch (err) {
      this.fail("prerender()", err)
    }
  }

  /** Terrain on: the shadows of one terrain tile into its render target. */
  renderToTerrainTile(gl: WebGL2RenderingContext, { tileID }: CustomTerrainRenderInput) {
    const program = this.terrainProgram
    if (!program || !this.emptyVao || !this.ready()) return
    try {
      const c = tileID.canonical
      const x = c.x + (tileID.wrap ?? 0) * 2 ** c.z
      gl.useProgram(program)
      gl.bindVertexArray(this.emptyVao)
      this.setShadingUniforms(gl, program)
      gl.uniform4f(this.uniform(gl, program, "u_rect"), -1, 1, 1, -1)
      gl.uniform4fv(this.uniform(gl, program, "u_uvRect"), this.uvRect(c.z, x, c.y))
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    } catch (err) {
      this.fail("renderToTerrainTile()", err)
    } finally {
      gl.bindVertexArray(null)
      gl.useProgram(null)
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    }
  }

  /** Terrain off (mercator or globe): the mosaic's loaded tiles, flat. */
  render(glArg: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const gl = glArg as WebGL2RenderingContext
    if (!this.meshVao || !this.ready()) return
    try {
      let program = this.mapPrograms.get(args.shaderData.variantName)
      if (!program) {
        program = compileProgram(gl, mapTileVertexShader(args.shaderData.vertexShaderPrelude, args.shaderData.define), FRAGMENT_SHADER, "shadow-live-gl-layer")
        this.mapPrograms.set(args.shaderData.variantName, program)
      }
      const l = this.layout!
      const s = 2 ** l.z
      // A whole-world mosaic (x0 = 0) is drawn on the world copy under the view's centre.
      const wrapShift = l.nx === s && this.map ? Math.floor(lngLatToMercator(this.map.getCenter().lng, 0)[0]) : 0
      gl.useProgram(program)
      gl.bindVertexArray(this.meshVao)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.STENCIL_TEST)
      this.setShadingUniforms(gl, program)
      const u = (name: string) => this.uniform(gl, program!, name)
      for (let j = 0; j < l.ny; j++) {
        for (let i = 0; i < l.nx; i++) {
          if (!this.uploaded[j * l.nx + i]) continue
          const ux = l.x0 + i
          const canonical = { z: l.z, x: wrapX(ux, l.z), y: l.y0 + j }
          const p = args.getProjectionData({ tileID: { canonical, wrap: Math.floor(ux / s) + wrapShift }, applyGlobeMatrix: true })
          gl.uniformMatrix4fv(u("u_projection_matrix"), false, p.mainMatrix)
          gl.uniform4fv(u("u_projection_tile_mercator_coords"), p.tileMercatorCoords)
          gl.uniform4fv(u("u_projection_clipping_plane"), p.clippingPlane)
          gl.uniform1f(u("u_projection_transition"), p.projectionTransition)
          gl.uniformMatrix4fv(u("u_projection_fallback_matrix"), false, p.fallbackMatrix)
          gl.uniform4f(u("u_uvRect"), i / l.nx, j / l.ny, (i + 1) / l.nx, (j + 1) / l.ny)
          gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0)
        }
      }
    } catch (err) {
      this.fail("render()", err)
    } finally {
      gl.bindVertexArray(null)
      gl.useProgram(null)
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    }
  }
}
