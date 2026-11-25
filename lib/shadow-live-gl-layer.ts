// Live GPU terrain shadows: the "live" renderer of Hard Shadows, next to the
// shadow:// tiles (lib/shadow-protocol.ts, kept for exports, the Iso-line and
// as the fallback). Measured in docs/content/docs/dev/shadow-renderers.mdx.
//
// What it does, once per frame on the GPU:
//  - The view's DEM tiles (the upstream the shadow:// tiles read, through the
//    same shared decoded-tile cache) are stitched into ONE Float32 texture,
//    the view mosaic: about one DEM texel per CSS pixel, the view plus one
//    tile on every side, at most SHADOW_MOSAIC_MAX_TILES tiles (a coarser
//    zoom when the view is wider). Tiles go in with texSubImage2D as they
//    arrive; a pan inside the mosaic changes nothing, a pan out of it lays
//    out a new one.
//  - A second texture, the far-field mosaic, holds the same DEM FAR_LEVELS
//    (3) zooms coarser around it, up to 36 tiles: tens of kilometres of relief
//    beyond the view for a few more megabytes, so a low sun's long shadows
//    cast from far off screen come in (chooseFarLayout).
//  - Each fragment marches its own ray toward the sun: across the view mosaic
//    first (exact bilinear samples of the R32F texels, texelFetch, one-texel
//    steps for 40 texels then steps growing with the distance), then on over
//    the far mosaic from where the ray leaves the view mosaic. It keeps the
//    highest horizon angle, with the ground lowered by the Earth's curvature
//    (less refraction), until the horizon is above the sun's disc (shadow),
//    the ray leaves the far mosaic, or it is above everything (lit). The sun
//    disc's 0.53° gives the soft edge (fraction of the disc above the
//    horizon), or a hard edge with radius 0. A sun change is uniforms and a
//    redraw. The shader is lib/shadow-live-math.ts's shadowFragmentShader,
//    whose CPU twin, sunVisibilityCpu, the tests and the benchmark run.
//
// Drawn like lib/live-dem-gl-layer.ts's layers: with terrain off, the view
// mosaic's tiles as flat meshes through MapLibre's projection prelude
// (mercator and globe); with terrain on, through renderToTerrainTile, one
// quad per terrain tile, MapLibre draping the result over the relief. The
// fragment shader gets the mosaic uv in both cases, so it is one shader.
import type { CustomLayerInterface, CustomRenderMethodInput, CustomTerrainRenderInput, Map as MapLibreMap } from "maplibre-gl"
import { createTileMesh } from "maplibre-gl"
import { compileProgram, mapTileVertexShader, TERRAIN_TILE_VERT } from "./live-dem-gl-layer"
import { fetchPaddedElevationGrid, sharedTileCache, type UpstreamEncoding } from "./normal-derived-protocol"
import {
  chooseFarLayout, chooseMosaicLayout, farTransform, layoutContains, lngLatToMercator, shadowFragmentShader, sunStepVector,
  CURVATURE_PER_M2, FAR_MAX_TILES, SHADOW_MAX_STEPS, SHADOW_MOSAIC_MAX_SIDE, SHADOW_MOSAIC_MAX_TILES, SUN_RADIUS_DEG, type MosaicLayout,
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
  /** Soft edge from the sun's disc (state.shadowSoft); hard when false. */
  soft?: boolean
  /** The far-field mosaic (on unless a test turns it off). */
  farField?: boolean
}

// Elevation written for texels with no data yet (a tile still loading, a hole
// in the DEM): far below any ground, so it never blocks a ray, and fragments
// whose own elevation blends it are not drawn.
const NODATA = -1e7
// Decoded tiles kept on the CPU to rebuild a moved mosaic without refetching:
// both mosaics plus a border's worth (1 MB a tile at 512 px).
const MAX_CACHED_GRIDS = SHADOW_MOSAIC_MAX_TILES + FAR_MAX_TILES + 16
const MESH_GRANULARITY = 64

const FRAGMENT_SHADER = shadowFragmentShader(NODATA)

interface Grid { data: Float32Array; max: number }

const keyOf = (z: number, x: number, y: number) => `${z}/${x}/${y}`
const wrapX = (x: number, z: number) => ((x % 2 ** z) + 2 ** z) % 2 ** z

/** One R32F texture holding a rectangle of DEM tiles at one zoom (the view
 *  mosaic or the far-field one), filled slot by slot as tiles arrive. */
class MosaicTexture {
  layout: MosaicLayout | null = null
  texture: WebGLTexture | null = null
  /** Per slot (row-major): whether its tile is in the texture. */
  uploaded: boolean[] = []
  maxElev = -Infinity
  private readonly tileSize: number
  constructor(tileSize: number) { this.tileSize = tileSize }

  slotKeys(): string[] {
    const l = this.layout
    if (!l) return []
    const keys: string[] = []
    for (let j = 0; j < l.ny; j++) for (let i = 0; i < l.nx; i++) keys.push(keyOf(l.z, wrapX(l.x0 + i, l.z), l.y0 + j))
    return keys
  }

  get ready(): boolean { return !!this.texture && !!this.layout && this.maxElev > -Infinity }
  get width(): number { return this.layout ? this.layout.nx * this.tileSize : 0 }
  get height(): number { return this.layout ? this.layout.ny * this.tileSize : 0 }

  private uploadSlot(gl: WebGL2RenderingContext, i: number, j: number, data: Float32Array) {
    const n = this.tileSize
    gl.texSubImage2D(gl.TEXTURE_2D, 0, i * n, j * n, n, n, gl.RED, gl.FLOAT, data)
  }

  /** A new rectangle: the texture is kept when the size matches; slots whose
   *  tile is not decoded yet start as no data (update() fills the others
   *  right after). */
  setLayout(gl: WebGL2RenderingContext, layout: MosaicLayout, nodataTile: Float32Array, hasGrid: (key: string) => boolean) {
    const n = this.tileSize
    const prev = this.layout
    const sameSize = prev && prev.nx === layout.nx && prev.ny === layout.ny
    this.layout = layout
    this.uploaded = new Array(layout.nx * layout.ny).fill(false)
    if (!this.texture || !sameSize) {
      if (this.texture) gl.deleteTexture(this.texture)
      this.texture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, layout.nx * n, layout.ny * n)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    for (let j = 0; j < layout.ny; j++) {
      for (let i = 0; i < layout.nx; i++) {
        if (!hasGrid(keyOf(layout.z, wrapX(layout.x0 + i, layout.z), layout.y0 + j))) this.uploadSlot(gl, i, j, nodataTile)
      }
    }
    this.maxElev = -Infinity
  }

  /** Uploads the decoded tiles not in the texture yet; asks for the missing
   *  ones. Whether anything was uploaded. */
  update(gl: WebGL2RenderingContext, grids: Map<string, Grid>, fetch: (z: number, x: number, y: number) => void): boolean {
    const l = this.layout
    if (!l || !this.texture) return false
    let any = false
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    for (let j = 0; j < l.ny; j++) {
      for (let i = 0; i < l.nx; i++) {
        const slot = j * l.nx + i
        if (this.uploaded[slot]) continue
        const x = wrapX(l.x0 + i, l.z), y = l.y0 + j
        const grid = grids.get(keyOf(l.z, x, y))
        if (!grid) { fetch(l.z, x, y); continue }
        this.uploadSlot(gl, i, j, grid.data)
        this.uploaded[slot] = true
        if (grid.max > this.maxElev) this.maxElev = grid.max
        any = true
      }
    }
    return any
  }

  dispose(gl: WebGL2RenderingContext) {
    if (this.texture) gl.deleteTexture(this.texture)
    this.texture = null
    this.layout = null
  }
}

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
  private view: MosaicTexture
  private far: MosaicTexture
  private nodataTile: Float32Array | null = null
  private revision = 0
  private loggedFetchError = false

  constructor(id: string, options: ShadowLiveOptions) {
    this.id = id
    this.options = options
    this.view = new MosaicTexture(options.tileSize)
    this.far = new MosaicTexture(options.tileSize)
  }

  /** Read by MapLibre once per frame: the draped terrain tiles are redrawn when it moves. */
  get terrainTileRevision(): number {
    return this.revision
  }

  private changed() {
    this.revision++
    this.map?.triggerRepaint()
  }

  /** Sun, opacity, soft edge: uniforms only. A new DEM needs a new instance (the wrapper remounts). */
  updateOptions(patch: Partial<ShadowLiveOptions>) {
    this.options = { ...this.options, ...patch }
    this.changed()
  }

  /** For the dev console and tests: what the layer currently holds. */
  debugState() {
    return {
      layout: this.view.layout, loadedTiles: this.view.uploaded.filter(Boolean).length, maxElev: this.view.maxElev,
      farLayout: this.far.layout, farLoadedTiles: this.far.uploaded.filter(Boolean).length, farMaxElev: this.far.maxElev,
      failed: this.failed, maxSteps: SHADOW_MAX_STEPS,
    }
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
    this.view.dispose(gl)
    this.far.dispose(gl)
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

  // ─── Mosaics ──────────────────────────────────────────────────────────────

  private fetchGrid = (z: number, x: number, y: number) => {
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

  private hasGrid = (key: string) => this.grids.has(key)

  /** Drops the oldest decoded tiles outside both mosaics. */
  private pruneGrids() {
    if (this.grids.size <= MAX_CACHED_GRIDS) return
    const keep = new Set([...this.view.slotKeys(), ...this.far.slotKeys()])
    for (const key of this.grids.keys()) {
      if (this.grids.size <= MAX_CACHED_GRIDS) break
      if (!keep.has(key)) this.grids.delete(key)
    }
  }

  /** Once per frame, before any draw: picks the mosaics for the view, fetches
   *  their missing tiles and uploads the ones that arrived. The view mosaic
   *  first: its tiles are asked for before the far field's. */
  private updateMosaics(gl: WebGL2RenderingContext) {
    const map = this.map
    if (!map) return
    const b = map.getBounds()
    const [x0, y0] = lngLatToMercator(b.getWest(), b.getNorth())
    const [x1, y1] = lngLatToMercator(b.getEast(), b.getSouth())
    const bounds = { x0, y0, x1, y1 }
    const { tileSize, minzoom, maxzoom } = this.options
    const opts = { minzoom, maxzoom, maxSide: this.maxSide }
    const needed = chooseMosaicLayout(bounds, map.getZoom(), tileSize, { ...opts, margin: 1, preferZ: this.view.layout?.z })
    if (!needed) return
    const n = tileSize
    if (!this.nodataTile || this.nodataTile.length !== n * n) this.nodataTile = new Float32Array(n * n).fill(NODATA)
    const pixelStore = this.saveUnpackState(gl)
    let uploadedAny = false
    try {
      if (!this.view.layout || !layoutContains(this.view.layout, needed)) {
        // A second tile of slack where it fits, so small pans keep the mosaic.
        const roomy = chooseMosaicLayout(bounds, map.getZoom(), tileSize, { ...opts, margin: 2, preferZ: needed.z })
        this.view.setLayout(gl, roomy && roomy.z === needed.z ? roomy : needed, this.nodataTile, this.hasGrid)
        this.revision++
      }
      uploadedAny = this.view.update(gl, this.grids, this.fetchGrid)
      // The far field, around the view mosaic as laid out: kept while it
      // still holds a one-tile margin around it, else laid out anew with the
      // full margin.
      const farOpts = { minzoom, maxSide: this.maxSide }
      const farNeeded = this.options.farField === false ? null : chooseFarLayout(this.view.layout!, tileSize, farOpts)
      if (!farNeeded) {
        if (this.far.layout) { this.far.dispose(gl); this.revision++ }
      } else {
        const farMin = chooseFarLayout(this.view.layout!, tileSize, { ...farOpts, margin: 1 })
        if (!this.far.layout || !farMin || !layoutContains(this.far.layout, farMin)) {
          this.far.setLayout(gl, farNeeded, this.nodataTile, this.hasGrid)
          this.revision++
        }
        if (this.far.update(gl, this.grids, this.fetchGrid)) uploadedAny = true
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

  /** View-mosaic uv of the NW and SE corners of tile (z, x unwrapped, y). */
  private uvRect(z: number, x: number, y: number): [number, number, number, number] {
    const l = this.view.layout!
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
    return !this.failed && this.view.ready
  }

  private setShadingUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
    const l = this.view.layout!
    const n = this.options.tileSize
    const u = (name: string) => this.uniform(gl, program, name)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.view.texture)
    gl.uniform1i(u("u_mosaic"), 0)
    gl.uniform2f(u("u_size"), this.view.width, this.view.height)
    gl.uniform1f(u("u_mercY0"), l.y0 / 2 ** l.z)
    gl.uniform1f(u("u_mercPerTexel"), 1 / (n * 2 ** l.z))
    gl.uniform1f(u("u_fineMax"), this.view.maxElev)
    const hasFar = this.far.ready
    const fl = this.far.layout
    gl.activeTexture(gl.TEXTURE1)
    // Something R32F is bound either way; the shader reads it only with u_hasFar.
    gl.bindTexture(gl.TEXTURE_2D, hasFar ? this.far.texture : this.view.texture)
    gl.uniform1i(u("u_far"), 1)
    gl.uniform1i(u("u_hasFar"), hasFar ? 1 : 0)
    if (hasFar && fl) {
      const t = farTransform(l, fl, n)
      gl.uniform2f(u("u_farSize"), this.far.width, this.far.height)
      gl.uniform1f(u("u_farScale"), t.scale)
      gl.uniform2f(u("u_farOffset"), t.offsetX, t.offsetY)
      gl.uniform1f(u("u_farMercY0"), fl.y0 / 2 ** fl.z)
      gl.uniform1f(u("u_farMercPerTexel"), 1 / (n * 2 ** fl.z))
    }
    gl.uniform1f(u("u_allMax"), Math.max(this.view.maxElev, hasFar ? this.far.maxElev : -Infinity))
    gl.activeTexture(gl.TEXTURE0)
    const [sx, sy] = sunStepVector(this.options.azimuthDeg)
    gl.uniform2f(u("u_sunStep"), sx, sy)
    gl.uniform1f(u("u_alt"), (this.options.altitudeDeg * Math.PI) / 180)
    gl.uniform1f(u("u_sunRadius"), this.options.soft === false ? 0 : (SUN_RADIUS_DEG * Math.PI) / 180)
    gl.uniform1f(u("u_curv"), CURVATURE_PER_M2)
    gl.uniform1f(u("u_opacity"), Math.max(0, Math.min(1, this.options.opacity)))
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  private unbindTextures(gl: WebGL2RenderingContext) {
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  prerender(gl: WebGL2RenderingContext) {
    if (this.failed || !this.map) return
    try {
      this.updateMosaics(gl)
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
      this.unbindTextures(gl)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    }
  }

  /** Terrain off (mercator or globe): the view mosaic's loaded tiles, flat. */
  render(glArg: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const gl = glArg as WebGL2RenderingContext
    if (!this.meshVao || !this.ready()) return
    try {
      let program = this.mapPrograms.get(args.shaderData.variantName)
      if (!program) {
        program = compileProgram(gl, mapTileVertexShader(args.shaderData.vertexShaderPrelude, args.shaderData.define), FRAGMENT_SHADER, "shadow-live-gl-layer")
        this.mapPrograms.set(args.shaderData.variantName, program)
      }
      const l = this.view.layout!
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
          if (!this.view.uploaded[j * l.nx + i]) continue
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
      this.unbindTextures(gl)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    }
  }
}
