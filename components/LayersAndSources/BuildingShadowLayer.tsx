// Cast shadows of OSM buildings, the fast flat-ground way, on the GPU: each
// building's footprint is swept away from the sun by height / tan(altitude)
// (walls as quads from foot to tip, the roof outline at the tip), the union
// of the sweeps is drawn once into an offscreen mask (so overlapping shadows
// never darken twice), the footprints are cut back out (roofs stay lit), and
// the mask is composited over the map. Heights come from OpenFreeMap's
// OpenMapTiles "building" layer (render_height, from OSM height or levels),
// through z14 tiles this layer fetches and decodes itself
// (lib/building-tiles.ts), over the viewport widened by the longest shadow
// a building can cast at the current sun height: the OSM vector basemap
// need not be on, and a tower just off screen towards the sun still casts
// its shadow in (MapLibre's own vector source only holds the tiles under
// the viewport, each cut at its edge).
//
// The geometry (positions in Web Mercator, each vertex's sweep length per
// unit of 1/tan) is rebuilt only when the map settles or building tiles
// arrive; the light is two uniforms, so moving it costs one repaint, and
// panning costs nothing. Mercator only (not globe); over 3D terrain the
// shadows stay on the flat plane the buildings' feet are drawn on. For
// shadows cast by real shapes (a spire, a dome) and falling on slopes, the
// terrain Shadows mode with a surface model (DSM) source is the way.
import { memo, useEffect, useRef } from "react"
import { useMap } from "react-map-gl/maplibre"
import * as maplibregl from "maplibre-gl"
import type { CustomLayerInterface, CustomRenderMethodInput } from "maplibre-gl"
import earcut, { flatten } from "earcut"
import { LAYER_SLOTS } from "./MapLayers"
import { BUILDING_TILE_BUFFER, BUILDING_TILE_ZOOM, abortBuildingTilesExcept, cachedBuildingTile, requestBuildingTile, tileKey, type BuildingPolygon } from "@/lib/building-tiles"

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

// The z14 tiles cut buildings at tile edges plus a buffer: those cut edges
// are not walls. They run exactly along a z14 tile line offset by the
// buffer, which a real wall practically never does. (Both halves of a cut
// building come from the two tiles, so their sweeps union to the whole.)
function isClipEdge(x0: number, y0: number, x1: number, y1: number): boolean {
  const onCut = (v: number) => {
    const u = v * 2 ** BUILDING_TILE_ZOOM, d = Math.abs(u - Math.round(u))
    return d < 1e-3 || Math.abs(d - BUILDING_TILE_BUFFER) < 1e-3
  }
  return (x0 === x1 && onCut(x0)) || (y0 === y1 && onCut(y0))
}

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
 * The z14 tiles whose buildings can shade the viewport: its bounds widened
 * by the longest shadow at this sun height, in tile units, clamped to
 * MAX_TILES around the centre.
 */
function neededTiles(map: maplibregl.Map, altitude: number): TileRange | null {
  if (map.getZoom() < MIN_ZOOM - 0.5) return null
  const n = 2 ** BUILDING_TILE_ZOOM
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
function buildGeometry(map: maplibregl.Map, tiles: BuildingPolygon[][]): Geometry | null {
  const c = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter())
  const origin: [number, number] = [c.x, c.y]
  const sweep: number[] = [], roof: number[] = []
  const seen = new Set<string>()
  for (const tile of tiles) {
    for (const { rings: absRings, height: h } of tile) {
      // Mercator units per metre at this latitude (cos(lat) from the
      // Mercator y): the vertex's sweep per unit of 1/tan(altitude).
      const cosLat = 1 / Math.cosh(Math.PI * (1 - 2 * absRings[0][0][1]))
      const s = Math.min(MAX_SHADOW_M, h) / (40075016.686 * cosLat)
      const rings = absRings.map((ring) => ring.map(([x, y]) => [x - origin[0], y - origin[1]] as [number, number]))
      // A building inside two tiles' buffers comes whole from both.
      const key = `${rings[0][0][0].toFixed(9)},${rings[0][0][1].toFixed(9)},${rings[0].length},${h}`
      if (seen.has(key)) continue
      seen.add(key)
      for (const ring of rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [x0, y0] = ring[i], [x1, y1] = ring[i + 1]
          if ((x0 === x1 && y0 === y1) || isClipEdge(x0 + origin[0], y0 + origin[1], x1 + origin[0], y1 + origin[1])) continue
          // Two triangles: foot-foot-tip, foot-tip-tip.
          sweep.push(x0, y0, 0, x1, y1, 0, x1, y1, s, x0, y0, 0, x1, y1, s, x0, y0, s)
        }
      }
      // The roof outline at the tip (swept) and at the foot (the cut).
      const flat = flatten(rings)
      for (const idx of earcut(flat.vertices, flat.holes, flat.dimensions)) {
        const x = flat.vertices[idx * 2], y = flat.vertices[idx * 2 + 1]
        sweep.push(x, y, s)
        roof.push(x, y, 0)
      }
    }
  }
  if (!sweep.length) return null
  return { origin, sweep: new Float32Array(sweep), sweepCount: sweep.length / 3, roof: new Float32Array(roof), roofCount: roof.length / 3 }
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
  private geometry: Geometry | null = null
  private drawn = false
  // The tiles the last rebuild asked for (a fetch finishing outside it is stale).
  private range: TileRange | null = null
  private timer: ReturnType<typeof setTimeout> | undefined

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map; this.gl = gl
    this.maskProgram = compile(gl, MASK_VS, MASK_FS)
    this.blitProgram = compile(gl, BLIT_VS, BLIT_FS)
    this.sweepBuf = gl.createBuffer(); this.roofBuf = gl.createBuffer(); this.quadBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.fbo = gl.createFramebuffer(); this.tex = gl.createTexture()
  }
  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) {
    for (const b of [this.sweepBuf, this.roofBuf, this.quadBuf]) if (b) gl.deleteBuffer(b)
    if (this.fbo) gl.deleteFramebuffer(this.fbo)
    if (this.tex) gl.deleteTexture(this.tex)
    if (this.maskProgram) gl.deleteProgram(this.maskProgram)
    if (this.blitProgram) gl.deleteProgram(this.blitProgram)
    this.map = null; this.gl = null
    this.dispose()
  }
  dispose() {
    clearTimeout(this.timer)
    this.range = null
    abortBuildingTilesExcept(this, new Set())
  }
  /** A rebuild once things settle (the map, a burst of arriving tiles). */
  schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.rebuild(), 150)
  }
  /** The light moved: a lower sun may need buildings from further away. */
  setLight(azimuth: number, altitude: number) {
    this.azimuth = azimuth; this.altitude = altitude
    const map = this.map
    if (!map) return
    const range = neededTiles(map, altitude)
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
    const range = (this.range = neededTiles(map, this.altitude))
    const tiles: BuildingPolygon[][] = []
    const keep = new Set<string>()
    if (range) {
      for (let x = range.x0; x <= range.x1; x++) for (let y = range.y0; y <= range.y1; y++) {
        const key = tileKey(x, y)
        keep.add(key)
        const tile = cachedBuildingTile(x, y)
        if (tile) tiles.push(tile)
        else void requestBuildingTile(x, y, this).then((result) => {
          const r = this.range
          if (result && this.map && r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) this.schedule()
        })
      }
    }
    abortBuildingTilesExcept(this, keep)
    this.geometry = tiles.length ? buildGeometry(map, tiles) : null
    if (this.geometry) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sweepBuf); gl.bufferData(gl.ARRAY_BUFFER, this.geometry.sweep, gl.STATIC_DRAW)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.roofBuf); gl.bufferData(gl.ARRAY_BUFFER, this.geometry.roof, gl.STATIC_DRAW)
    }
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

export const BuildingShadowLayer = memo(({ enabled, opacity, sunAzimuth, sunAltitude, color = "#000000" }: {
  enabled: boolean
  opacity: number
  /** Compass bearing toward the sun, degrees. */
  sunAzimuth: number
  /** Sun height above the horizon, degrees. */
  sunAltitude: number
  color?: string
}) => {
  const { current: mapRef } = useMap()
  const layerRef = useRef<ShadowLayer | null>(null)

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!enabled || !map) return
    const layer = new ShadowLayer()
    layerRef.current = layer
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
      layer.dispose()
    }
  }, [enabled, mapRef])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.setLight(sunAzimuth, sunAltitude)
    const [r, g, b] = hexToRgb(color)
    layer.color = [r, g, b, opacity]
    mapRef?.getMap()?.triggerRepaint()
  }, [sunAzimuth, sunAltitude, opacity, color, mapRef, enabled])

  // The tiles are fetched by the layer itself: nothing to mount in the style.
  return null
})
BuildingShadowLayer.displayName = "BuildingShadowLayer"
