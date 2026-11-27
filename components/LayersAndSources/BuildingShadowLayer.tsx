// Cast shadows of buildings, the fast flat-ground way, on the GPU: each
// building's footprint is swept away from the sun by height / tan(altitude)
// (walls as quads from foot to tip, the roof outline at the tip), the union
// of the sweeps is drawn once into an offscreen mask (so overlapping shadows
// never darken twice), the footprints are cut back out (roofs stay lit), and
// the mask is composited over the map. Footprints and heights come from a
// vector source with a height field, chosen in the panel
// (?buildingShadowSource=): OpenFreeMap's OpenMapTiles "building" layer by
// default (render_height, from OSM height or levels), Overture's buildings
// (height, floors, building parts), or a source the user added. The layer
// fetches and decodes the source's tiles itself (lib/building-tiles.ts),
// over the viewport widened by the longest shadow a building can cast at
// the current sun height: no vector overlay or basemap need be on, and a
// tower just off screen towards the sun still casts its shadow in
// (MapLibre's own vector source only holds the tiles under the viewport,
// each cut at its edge). A raised part (a base above the ground) sweeps
// from its base to its top and leaves the ground under it to the others.
//
// The geometry (positions in Web Mercator, each vertex's sweep length per
// unit of 1/tan) is rebuilt only when the map settles or building tiles
// arrive; the light is two uniforms, so moving it costs one repaint, and
// panning costs nothing. Mercator only (not globe). With terrain on, MapLibre
// 6.13's experimental renderToTerrainTile hook is used instead of render():
// the same mask is drawn per terrain tile, in that tile's flat clip space,
// and MapLibre drapes it over the relief with its fills and lines; the
// footprints and sweeps still sit on the flat plane the buildings' feet are
// drawn on (a shadow falling up a slope is not shortened). For shadows cast
// by real shapes (a spire, a dome) and falling on slopes, the terrain Shadows
// mode with a surface model (DSM) source is the way.
import { memo, useEffect, useId, useRef } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { Layer, Source, useMap } from "react-map-gl/maplibre"
import * as maplibregl from "maplibre-gl"
import type { CustomLayerInterface, CustomRenderMethodInput } from "maplibre-gl"
import earcut from "earcut"
import { LAYER_SLOTS } from "./MapLayers"
import { abortBuildingTilesExcept, buildingSourceEntry, cachedBuildingTile, openBuildingSource, requestBuildingTile, tileKey, type BuildingSource, type BuildingTile } from "@/lib/building-tiles"
import { buildingShadowStatsAtom, customVectorSourcesAtom, type BuildingShadowStats } from "@/lib/settings-atoms"
import { sourceCredit } from "@/lib/source-credit"
import type { VectorSourceEntry } from "@/lib/source-schema"

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] }

const LAYER_ID = "osm-building-shadows"
const MIN_ZOOM = 13
// Past this, a low sun's shadow is longer than anything useful to draw.
const MAX_SHADOW_M = 600
// How far past the viewport buildings are fetched: the longest shadow at
// the current sun height, capped (a sun near the horizon would otherwise
// ask for the whole city).
const MAX_REACH_M = 3000
// Tiles per rebuild at most: a tilted view's bounds can reach the horizon.
// 16 (a 4 x 4 window around the centre) is what a z17 view needs with the
// sun at 10 degrees (3 km reach, z14 tiles of about 1.9 km): Jonathan,
// 2026-10-12, "16 tiles at a sun as low as 10 degrees, not more".
const MAX_TILES = 16

const MASK_VS = `#version 300 es
precision highp float;
in vec2 a_pos;      // mercator, relative to the geometry's origin
in float a_sweep;   // mercator units per unit of 1/tan(altitude), 0 at the foot
uniform mat4 u_matrix;
uniform vec2 u_dir;  // away from the sun, times 1/tan(altitude)
void main() {
  gl_Position = u_matrix * vec4(a_pos + a_sweep * u_dir, 0.0, 1.0);
}`
const MASK_FS = `#version 300 es
precision mediump float;
uniform float u_value;
out vec4 fragColor;
void main() { fragColor = vec4(u_value); }`
const BLIT_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`
const BLIT_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_mask;
uniform vec4 u_color;
out vec4 fragColor;
void main() { float a = u_color.a * texture(u_mask, v_uv).r; fragColor = vec4(u_color.rgb * a, a); }`

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader")
    return s
  }
  const p = gl.createProgram()!
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program")
  return p
}

type Geometry = { origin: [number, number]; sweep: Float32Array; sweepCount: number; roof: Float32Array; roofCount: number }
type TileRange = { x0: number; x1: number; y0: number; y1: number }

const contains = (outer: TileRange, inner: TileRange) => outer.x0 <= inner.x0 && outer.x1 >= inner.x1 && outer.y0 <= inner.y0 && outer.y1 >= inner.y1

/**
 * The source's tiles (at `zoom`, 14 for the built-in sources) whose
 * buildings can shade the viewport: its bounds widened by the longest
 * shadow at this sun height, in tile units, clamped to MAX_TILES around
 * the centre.
 */
function neededTiles(map: maplibregl.Map, altitude: number, zoom: number): TileRange | null {
  if (map.getZoom() < MIN_ZOOM - 0.5) return null
  const n = 2 ** zoom
  const b = map.getBounds()
  const sw = maplibregl.MercatorCoordinate.fromLngLat(b.getSouthWest()), ne = maplibregl.MercatorCoordinate.fromLngLat(b.getNorthEast())
  const c = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter())
  const reachM = Math.min(MAX_REACH_M, MAX_SHADOW_M / Math.tan((Math.max(altitude, 1) * Math.PI) / 180))
  const reach = reachM / (40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180))
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, v))
  const range: TileRange = {
    x0: clamp(Math.floor((sw.x - reach) * n)), x1: clamp(Math.floor((ne.x + reach) * n)),
    y0: clamp(Math.floor((ne.y - reach) * n)), y1: clamp(Math.floor((sw.y + reach) * n)),
  }
  const side = Math.floor(Math.sqrt(MAX_TILES))
  if ((range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) > MAX_TILES) {
    const cx = Math.floor(c.x * n), cy = Math.floor(c.y * n), half = Math.floor(side / 2)
    range.x0 = Math.max(range.x0, cx - half); range.x1 = Math.min(range.x1, cx - half + side - 1)
    range.y0 = Math.max(range.y0, cy - half); range.y1 = Math.min(range.y1, cy - half + side - 1)
  }
  return range
}

/** Sweep geometry for the buildings of the given tiles. */
function buildGeometry(map: maplibregl.Map, tiles: BuildingTile[]): Geometry | null {
  const c = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter())
  const origin: [number, number] = [c.x, c.y]
  const [ox, oy] = origin
  // Straight into Float32Arrays that double when full: the same float32
  // values as a number[] converted at the end, without the number[] (16
  // central-Paris tiles make 15 million numbers, 120 MB of doubles).
  let sweep = new Float32Array(1 << 16), sn = 0
  let roof = new Float32Array(1 << 14), rn = 0
  const grow = (a: Float32Array<ArrayBuffer>, used: number, more: number): Float32Array<ArrayBuffer> => {
    if (used + more <= a.length) return a
    const next = new Float32Array(Math.max(a.length * 2, used + more))
    next.set(a.subarray(0, used))
    return next
  }
  // Only a building at a tile's edge can come from two tiles (whole, from
  // both buffers): the others need no key.
  const seen = new Set<string>()
  // The building's rings relative to the origin, flat as earcut takes them,
  // refilled building after building; holes[k] is ring k+1's first vertex.
  const vertices: number[] = [], holes: number[] = []
  for (const tile of tiles) {
    const { coords, cut, ringStart, polyStart, height, base, edge } = tile
    for (let p = 0; p < tile.count; p++) {
      const r0 = polyStart[p], r1 = polyStart[p + 1]
      const first = ringStart[r0]
      const h = height[p], b = base[p]
      if (edge[p]) {
        const key = `${(coords[first * 2] - ox).toFixed(9)},${(coords[first * 2 + 1] - oy).toFixed(9)},${ringStart[r0 + 1] - first},${h},${b}`
        if (seen.has(key)) continue
        seen.add(key)
      }
      // Mercator units per metre at this latitude (cos(lat) from the
      // Mercator y): the vertex's sweep per unit of 1/tan(altitude), at the
      // top (s) and at the base (s0, 0 for a building on the ground).
      const cosLat = 1 / Math.cosh(Math.PI * (1 - 2 * coords[first * 2 + 1]))
      const s = Math.min(MAX_SHADOW_M, h) / (40075016.686 * cosLat), s0 = Math.min(MAX_SHADOW_M, b) / (40075016.686 * cosLat)
      vertices.length = 0
      holes.length = 0
      for (let r = r0; r < r1; r++) {
        const v0 = ringStart[r], v1 = ringStart[r + 1]
        if (r > r0) holes.push(vertices.length / 2)
        let x0 = coords[v0 * 2] - ox, y0 = coords[v0 * 2 + 1] - oy
        vertices.push(x0, y0)
        for (let v = v0 + 1; v < v1; v++) {
          const x1 = coords[v * 2] - ox, y1 = coords[v * 2 + 1] - oy
          vertices.push(x1, y1)
          // A cut along the tile's clip line is not a wall (both halves of a
          // cut building come from the two tiles: their sweeps union to the whole).
          if (!((x0 === x1 && y0 === y1) || cut[v])) {
            // Two triangles: foot-foot-tip, foot-tip-tip.
            sweep = grow(sweep, sn, 18)
            const w = sweep
            w[sn] = x0; w[sn + 1] = y0; w[sn + 2] = s0; w[sn + 3] = x1; w[sn + 4] = y1; w[sn + 5] = s0
            w[sn + 6] = x1; w[sn + 7] = y1; w[sn + 8] = s; w[sn + 9] = x0; w[sn + 10] = y0; w[sn + 11] = s0
            w[sn + 12] = x1; w[sn + 13] = y1; w[sn + 14] = s; w[sn + 15] = x0; w[sn + 16] = y0; w[sn + 17] = s
            sn += 18
          }
          x0 = x1; y0 = y1
        }
      }
      // The roof outline at the tip (swept) and, for a building standing on
      // the ground, at the foot (the cut: its roof stays lit). A raised part
      // cuts nothing: what stands under it does, or the ground is shaded.
      const tri = earcut(vertices, holes, 2)
      sweep = grow(sweep, sn, 3 * tri.length)
      if (!b) roof = grow(roof, rn, 3 * tri.length)
      for (const idx of tri) {
        const x = vertices[idx * 2], y = vertices[idx * 2 + 1]
        sweep[sn++] = x; sweep[sn++] = y; sweep[sn++] = s
        if (!b) { roof[rn++] = x; roof[rn++] = y; roof[rn++] = 0 }
      }
    }
  }
  if (!sn) return null
  return { origin, sweep: sweep.subarray(0, sn), sweepCount: sn / 3, roof: roof.subarray(0, rn), roofCount: rn / 3 }
}

class ShadowLayer implements CustomLayerInterface {
  id = LAYER_ID
  type = "custom" as const
  renderingMode = "2d" as const
  azimuth = 315
  altitude = 45
  color: [number, number, number, number] = [0, 0, 0, 0.5]
  private map: maplibregl.Map | null = null
  private gl: WebGL2RenderingContext | null = null
  private maskProgram: WebGLProgram | null = null
  private blitProgram: WebGLProgram | null = null
  private sweepBuf: WebGLBuffer | null = null
  private roofBuf: WebGLBuffer | null = null
  private quadBuf: WebGLBuffer | null = null
  private fbo: WebGLFramebuffer | null = null
  private tex: WebGLTexture | null = null
  private texSize: [number, number] = [0, 0]
  // The per-tile mask for renderToTerrainTile (the screen mask above is sized to the canvas).
  private tileFbo: WebGLFramebuffer | null = null
  private tileTex: WebGLTexture | null = null
  private tileTexSize: [number, number] = [0, 0]
  // Bumped whenever the drape would change (geometry, light, colour), so
  // MapLibre redraws its terrain tiles; read by MapLibre, see the interface.
  terrainTileRevision = 0
  private geometry: Geometry | null = null
  private drawn = false
  // The tiles the last rebuild asked for (a fetch finishing outside it is stale).
  private range: TileRange | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  // The vector source the buildings come from: the entry asked for, and its
  // opened form (TileJSON, archive or release resolved) once it answers.
  private entry: VectorSourceEntry | null = null
  private source: BuildingSource | null = null
  /** Told after each rebuild what the loaded tiles hold (the panel's line on heights). */
  onStats: ((stats: BuildingShadowStats) => void) | null = null
  /** The last of them. */
  stats: BuildingShadowStats | null = null
  /** Milliseconds from the source being set to the first shadows and to
   *  every tile of the view being in, and the tiles' own timings: read by
   *  the timing checks through map.getLayer(id).implementation. */
  timings: { sourceId: string; firstMs: number | null; completeMs: number | null; tiles: number; fetchMs: number[]; decodeMs: number[]; geometryMs: number } | null = null
  private sourceSetAt = 0

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map; this.gl = gl
    this.maskProgram = compile(gl, MASK_VS, MASK_FS)
    this.blitProgram = compile(gl, BLIT_VS, BLIT_FS)
    this.sweepBuf = gl.createBuffer(); this.roofBuf = gl.createBuffer(); this.quadBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.fbo = gl.createFramebuffer(); this.tex = gl.createTexture()
    this.tileFbo = gl.createFramebuffer(); this.tileTex = gl.createTexture()
  }
  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) {
    for (const b of [this.sweepBuf, this.roofBuf, this.quadBuf]) if (b) gl.deleteBuffer(b)
    if (this.fbo) gl.deleteFramebuffer(this.fbo)
    if (this.tex) gl.deleteTexture(this.tex)
    if (this.tileFbo) gl.deleteFramebuffer(this.tileFbo)
    if (this.tileTex) gl.deleteTexture(this.tileTex)
    if (this.maskProgram) gl.deleteProgram(this.maskProgram)
    if (this.blitProgram) gl.deleteProgram(this.blitProgram)
    this.map = null; this.gl = null
    this.dispose()
  }
  dispose() {
    clearTimeout(this.timer)
    this.range = null
    this.entry = null; this.source = null
    abortBuildingTilesExcept(this, new Set())
  }
  /**
   * The buildings come from another source: its fetches replace the old
   * ones, and the shadows are rebuilt from what is cached of it as soon as
   * it is opened (the old source's shadows stay until then).
   */
  setSource(entry: VectorSourceEntry) {
    if (this.entry && this.entry.id === entry.id && this.entry.url === entry.url && this.entry.heightField === entry.heightField) return
    this.entry = entry
    this.sourceSetAt = performance.now()
    this.timings = { sourceId: entry.id, firstMs: null, completeMs: null, tiles: 0, fetchMs: [], decodeMs: [], geometryMs: 0 }
    openBuildingSource(entry).then((source) => {
      if (this.entry !== entry) return
      this.source = source
      this.rebuild()
    }, (e) => {
      if (this.entry !== entry) return
      console.warn(`[building-shadows] ${entry.id}:`, e)
      this.source = null
      this.rebuild()
      this.onStats?.({ sourceId: entry.id, tiles: 0, pending: 0, buildings: 0, stated: 0, floors: 0, error: e instanceof Error ? e.message : String(e) })
    })
  }
  /** A rebuild once things settle (the map, a burst of arriving tiles). */
  schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.rebuild(), 150)
  }
  /** The light moved: a lower sun may need buildings from further away. */
  setLight(azimuth: number, altitude: number) {
    this.azimuth = azimuth; this.altitude = altitude
    this.terrainTileRevision++
    const map = this.map
    if (!map) return
    if (!this.source) return
    const range = neededTiles(map, altitude, this.source.zoom)
    if (range && (!this.range || !contains(this.range, range))) this.schedule()
  }
  /**
   * The map settled or building tiles arrived: build the geometry from the
   * cached tiles over the widened viewport, fetching the missing ones (each
   * arrival schedules another rebuild; fetches no longer needed are aborted).
   */
  rebuild() {
    const map = this.map, gl = this.gl
    if (!map || !gl) return
    const source = this.source
    const range = (this.range = source ? neededTiles(map, this.altitude, source.zoom) : null)
    const tiles: BuildingTile[] = []
    const keep = new Set<string>()
    let pending = 0
    if (source && range) {
      for (let x = range.x0; x <= range.x1; x++) for (let y = range.y0; y <= range.y1; y++) {
        const key = tileKey(source, x, y)
        keep.add(key)
        const tile = cachedBuildingTile(source, x, y)
        if (tile) tiles.push(tile)
        else {
          pending++
          void requestBuildingTile(source, x, y, this).then((result) => {
            const r = this.range
            if (!result || !this.map || this.source !== source) return
            this.timings?.fetchMs.push(result.fetchMs); this.timings?.decodeMs.push(result.decodeMs)
            if (r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) this.schedule()
          })
        }
      }
    }
    abortBuildingTilesExcept(this, keep)
    const t0 = performance.now()
    this.geometry = tiles.length ? buildGeometry(map, tiles) : null
    if (source) {
      const timings = this.timings
      if (timings && range) {
        const now = performance.now()
        timings.geometryMs = now - t0
        timings.tiles = tiles.length
        if (this.geometry && timings.firstMs === null) timings.firstMs = now - this.sourceSetAt
        if (!pending && timings.completeMs === null) timings.completeMs = now - this.sourceSetAt
      }
      let buildings = 0, stated = 0, floors = 0
      for (const tile of tiles) { buildings += tile.buildings; stated += tile.stated; floors += tile.floors }
      this.stats = { sourceId: source.entry.id, tiles: tiles.length, pending, buildings, stated, floors }
      this.onStats?.(this.stats)
    }
    if (this.geometry) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sweepBuf); gl.bufferData(gl.ARRAY_BUFFER, this.geometry.sweep, gl.STATIC_DRAW)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.roofBuf); gl.bufferData(gl.ARRAY_BUFFER, this.geometry.roof, gl.STATIC_DRAW)
    }
    this.terrainTileRevision++
    map.triggerRepaint()
  }
  private ensureTexture(gl: WebGL2RenderingContext) {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
    if (this.texSize[0] === w && this.texSize[1] === h) return
    this.texSize = [w, h]
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0)
  }
  // The mask, before MapLibre's own passes (prerender is where a custom
  // layer may draw to its own framebuffer).
  prerender(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const g = this.geometry
    this.drawn = false
    if (!g || this.altitude <= 0.5 || (this.map?.getProjection?.() as any)?.type === "globe") return
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING)
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array
    this.ensureTexture(gl)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.viewport(0, 0, this.texSize[0], this.texSize[1])
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    // The projection matrix translated to the geometry's origin, in float64:
    // mercator coordinates at street zoom are beyond float32.
    const m = options.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>
    const t = new Float32Array(16)
    for (let i = 0; i < 16; i++) t[i] = m[i]
    const [ox, oy] = g.origin
    t[12] = m[0] * ox + m[4] * oy + m[12]; t[13] = m[1] * ox + m[5] * oy + m[13]
    t[14] = m[2] * ox + m[6] * oy + m[14]; t[15] = m[3] * ox + m[7] * oy + m[15]
    const away = ((this.azimuth + 180) * Math.PI) / 180
    const k = 1 / Math.tan((this.altitude * Math.PI) / 180)
    const p = this.maskProgram!
    gl.useProgram(p)
    gl.uniformMatrix4fv(gl.getUniformLocation(p, "u_matrix"), false, t)
    gl.uniform2f(gl.getUniformLocation(p, "u_dir"), Math.sin(away) * k, -Math.cos(away) * k)
    const aPos = gl.getAttribLocation(p, "a_pos"), aSweep = gl.getAttribLocation(p, "a_sweep")
    const draw = (buf: WebGLBuffer | null, count: number, value: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0)
      gl.enableVertexAttribArray(aSweep); gl.vertexAttribPointer(aSweep, 1, gl.FLOAT, false, 12, 8)
      gl.uniform1f(gl.getUniformLocation(p, "u_value"), value)
      gl.drawArrays(gl.TRIANGLES, 0, count)
    }
    draw(this.sweepBuf, g.sweepCount, 1)
    draw(this.roofBuf, g.roofCount, 0)
    gl.disableVertexAttribArray(aPos); gl.disableVertexAttribArray(aSweep)
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo)
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3])
    this.drawn = true
  }
  /** The mask of the sweeps minus the footprints, into the bound framebuffer, with u_matrix given. */
  private drawMask(gl: WebGL2RenderingContext, g: Geometry, matrix: Float32Array) {
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    const away = ((this.azimuth + 180) * Math.PI) / 180
    const k = 1 / Math.tan((this.altitude * Math.PI) / 180)
    const p = this.maskProgram!
    gl.useProgram(p)
    gl.uniformMatrix4fv(gl.getUniformLocation(p, "u_matrix"), false, matrix)
    gl.uniform2f(gl.getUniformLocation(p, "u_dir"), Math.sin(away) * k, -Math.cos(away) * k)
    const aPos = gl.getAttribLocation(p, "a_pos"), aSweep = gl.getAttribLocation(p, "a_sweep")
    const draw = (buf: WebGLBuffer | null, count: number, value: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0)
      gl.enableVertexAttribArray(aSweep); gl.vertexAttribPointer(aSweep, 1, gl.FLOAT, false, 12, 8)
      gl.uniform1f(gl.getUniformLocation(p, "u_value"), value)
      gl.drawArrays(gl.TRIANGLES, 0, count)
    }
    draw(this.sweepBuf, g.sweepCount, 1)
    draw(this.roofBuf, g.roofCount, 0)
    gl.disableVertexAttribArray(aPos); gl.disableVertexAttribArray(aSweep)
  }
  /** The mask composited in the shadow colour over whatever framebuffer is bound (the canvas, or a terrain tile). */
  private blit(gl: WebGL2RenderingContext, tex: WebGLTexture | null) {
    const p = this.blitProgram!
    gl.useProgram(p)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(gl.getUniformLocation(p, "u_mask"), 0)
    gl.uniform4fv(gl.getUniformLocation(p, "u_color"), this.color)
    const aPos = gl.getAttribLocation(p, "a_pos")
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.disableVertexAttribArray(aPos)
  }
  /**
   * With terrain on, MapLibre calls this per terrain tile instead of render():
   * the tile's framebuffer is bound, clip (-1, -1) is its south-west corner
   * and (1, 1) its north-east. The sweep geometry is in Mercator units
   * relative to its origin, so the matrix is a plain scale and offset from
   * the tile's Mercator bounds, composed in float64 before it is stored. The
   * mask goes through the per-tile texture first, as on screen, so overlapping
   * sweeps never darken twice; then it is composited into the tile.
   */
  renderToTerrainTile(gl: WebGL2RenderingContext, { tileID, width, height }: { tileID: { canonical: { z: number; x: number; y: number } }; width: number; height: number }) {
    const g = this.geometry
    if (!g || this.altitude <= 0.5) return
    const { z, x, y } = tileID.canonical
    const size = 1 / 2 ** z
    const sx = 2 / size, sy = -2 / size
    const [ox, oy] = g.origin
    const matrix = new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, (ox - x * size) * sx - 1, (oy - y * size) * sy + 1, 0, 1])
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING)
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array
    if (this.tileTexSize[0] !== width || this.tileTexSize[1] !== height) {
      this.tileTexSize = [width, height]
      gl.bindTexture(gl.TEXTURE_2D, this.tileTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.tileFbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tileTex, 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tileFbo)
    gl.viewport(0, 0, width, height)
    this.drawMask(gl, g, matrix)
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo)
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3])
    this.blit(gl, this.tileTex)
  }
  render(gl: WebGL2RenderingContext) {
    if (!this.drawn) return
    const p = this.blitProgram!
    gl.useProgram(p)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.uniform1i(gl.getUniformLocation(p, "u_mask"), 0)
    gl.uniform4fv(gl.getUniformLocation(p, "u_color"), this.color)
    const aPos = gl.getAttribLocation(p, "a_pos")
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.disableVertexAttribArray(aPos)
  }
}

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const v = m ? parseInt(m[1], 16) : 0
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

export const BuildingShadowLayer = memo(({ enabled, opacity, sunAzimuth, sunAltitude, color = "#000000", sourceId }: {
  enabled: boolean
  opacity: number
  /** Compass bearing toward the sun, degrees. */
  sunAzimuth: number
  /** Sun height above the horizon, degrees. */
  sunAltitude: number
  color?: string
  /** The vector source the buildings come from, by id (default OpenFreeMap's OSM tiles). */
  sourceId?: string
}) => {
  const { current: mapRef } = useMap()
  const layerRef = useRef<ShadowLayer | null>(null)
  const customs = useAtomValue(customVectorSourcesAtom)
  const entry = buildingSourceEntry(sourceId, customs)
  const entryRef = useRef(entry)
  entryRef.current = entry
  // What this view's tiles hold, for the panel (one record per view).
  const setStats = useSetAtom(buildingShadowStatsAtom)
  const viewKey = useId()

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!enabled || !map) return
    const layer = new ShadowLayer()
    layerRef.current = layer
    layer.onStats = (stats) => setStats((all) => ({ ...all, [viewKey]: stats }))
    layer.setSource(entryRef.current)
    const schedule = () => layer.schedule()
    const add = () => {
      if (map.getLayer(LAYER_ID) || !map.getLayer(LAYER_SLOTS.SHADOWS)) return
      map.addLayer(layer, LAYER_SLOTS.SHADOWS)
      schedule()
    }
    add()
    map.on("styledata", add)
    map.on("moveend", schedule)
    return () => {
      map.off("styledata", add); map.off("moveend", schedule)
      layerRef.current = null
      if (map.style && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
      layer.onStats = null
      layer.dispose()
      setStats((all) => { const { [viewKey]: _gone, ...rest } = all; return rest })
    }
  }, [enabled, mapRef, setStats, viewKey])

  // Another source: the same layer and map, other tiles.
  useEffect(() => { layerRef.current?.setSource(entry) }, [entry, enabled])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.setLight(sunAzimuth, sunAltitude)
    const [r, g, b] = hexToRgb(color)
    layer.color = [r, g, b, opacity]
    layer.terrainTileRevision++
    mapRef?.getMap()?.triggerRepaint()
  }, [sunAzimuth, sunAltitude, opacity, color, mapRef, enabled])

  // The tiles are fetched by the layer itself: nothing of them to mount in
  // the style. MapLibre's attribution line only knows sources of the style
  // that a visible layer uses, so the buildings' credit rides on an empty
  // GeoJSON source with a line layer that draws nothing, mounted while the
  // shadows are on (lib/source-credit.ts: the same short, linked credit the
  // source gets as a vector overlay).
  const credit = enabled ? sourceCredit(entry) : undefined
  if (!credit) return null
  return (
    <Source key={credit} id={`building-shadow-credit${viewKey}`} type="geojson" data={EMPTY_COLLECTION} attribution={credit}>
      <Layer id={`building-shadow-credit${viewKey}-layer`} type="line" paint={{ "line-opacity": 0 }} />
    </Source>
  )
})
BuildingShadowLayer.displayName = "BuildingShadowLayer"
