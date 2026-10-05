// Cast shadows of OSM buildings, the fast flat-ground way, on the GPU: each
// building's footprint is swept away from the sun by height / tan(altitude)
// (walls as quads from foot to tip, the roof outline at the tip), the union
// of the sweeps is drawn once into an offscreen mask (so overlapping shadows
// never darken twice), the footprints are cut back out (roofs stay lit), and
// the mask is composited over the map. Heights come from OpenFreeMap's
// OpenMapTiles "building" layer (render_height, from OSM height or levels),
// available from z13, through a vector source of this layer's own: the OSM
// vector basemap need not be on.
//
// The geometry (positions in Web Mercator, each vertex's sweep length per
// unit of 1/tan) is rebuilt only when the map settles or building tiles
// arrive; the light is two uniforms, so moving it costs one repaint, and
// panning costs nothing. Mercator only (not globe); over 3D terrain the
// shadows stay on the flat plane the buildings' feet are drawn on. For
// shadows cast by real shapes (a spire, a dome) and falling on slopes, the
// terrain Shadows mode with a surface model (DSM) source is the way.
import { memo, useEffect, useRef } from "react"
import { Layer, Source, useMap } from "react-map-gl/maplibre"
import * as maplibregl from "maplibre-gl"
import type { CustomLayerInterface, CustomRenderMethodInput } from "maplibre-gl"
import earcut, { flatten } from "earcut"
import { LAYER_SLOTS } from "./MapLayers"

const SRC = "osm-buildings-for-shadows"
const PROBE_LAYER = "osm-buildings-for-shadows-probe"
const LAYER_ID = "osm-building-shadows"
// OpenFreeMap's TileJSON: a versioned tile URL behind a stable name.
const OPENFREEMAP_TILEJSON = "https://tiles.openfreemap.org/planet"
const MIN_ZOOM = 13
// Past this, a low sun's shadow is longer than anything useful to draw.
const MAX_SHADOW_M = 600

// Vector tiles cut buildings at tile edges plus a buffer, and MapLibre cuts
// the z14 data again for each overzoomed tile: those cut edges are not walls.
// They run exactly along a tile line (z14 and up) offset by the buffer, 1/128
// of a z14 tile, which a real wall practically never does.
function isClipEdge(x0: number, y0: number, x1: number, y1: number): boolean {
  const onCut = (v: number) => {
    for (let z = 14; z <= 22; z++) {
      const u = v * 2 ** z, d = Math.abs(u - Math.round(u)), buffer = 2 ** (z - 14) / 128
      if (buffer >= 0.5) break
      if (d < 1e-3 || Math.abs(d - buffer) < 1e-3) return true
    }
    return false
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

/** Sweep geometry for the buildings in the loaded tiles. */
function buildGeometry(map: maplibregl.Map): Geometry | null {
  const features = map.querySourceFeatures(SRC, { sourceLayer: "building" })
  if (!features.length) return null
  const c = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter())
  const origin: [number, number] = [c.x, c.y]
  const sweep: number[] = [], roof: number[] = []
  const seen = new Set<string>()
  for (const f of features) {
    const g = f.geometry
    if (g.type !== "Polygon" && g.type !== "MultiPolygon") continue
    const h = Number(f.properties?.render_height ?? 0)
    if (!(h > 0)) continue
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates
    for (const poly of polys) {
      const outer = poly[0]
      if (!outer?.length) continue
      // Mercator units per metre at this latitude: the vertex's sweep per
      // unit of 1/tan(altitude).
      const lat = outer[0][1]
      const s = Math.min(MAX_SHADOW_M, h) / (40075016.686 * Math.cos((lat * Math.PI) / 180))
      const rings = poly.map((ring) => ring.map(([lng, la]) => { const m = maplibregl.MercatorCoordinate.fromLngLat([lng, la]); return [m.x - origin[0], m.y - origin[1]] as [number, number] }))
      // The same building piece can come from two overzoomed tiles.
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
  }
  /** The map settled or building tiles arrived: read the buildings again. */
  rebuild() {
    const map = this.map, gl = this.gl
    if (!map || !gl) return
    this.geometry = map.getZoom() >= MIN_ZOOM - 0.5 && map.getSource(SRC) ? buildGeometry(map) : null
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
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => layer.rebuild(), 150) }
    const onData = (e: any) => { if (e.sourceId === SRC && e.isSourceLoaded) schedule() }
    const add = () => {
      if (map.getLayer(LAYER_ID) || !map.getLayer(LAYER_SLOTS.SHADOWS)) return
      map.addLayer(layer, LAYER_SLOTS.SHADOWS)
      schedule()
    }
    add()
    map.on("styledata", add)
    map.on("moveend", schedule)
    map.on("sourcedata", onData)
    return () => {
      clearTimeout(timer)
      map.off("styledata", add); map.off("moveend", schedule); map.off("sourcedata", onData)
      layerRef.current = null
      if (map.style && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
    }
  }, [enabled, mapRef])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.azimuth = sunAzimuth; layer.altitude = sunAltitude
    const [r, g, b] = hexToRgb(color)
    layer.color = [r, g, b, opacity]
    mapRef?.getMap()?.triggerRepaint()
  }, [sunAzimuth, sunAltitude, opacity, color, mapRef, enabled])

  if (!enabled) return null
  return (
    // The buildings themselves, drawn invisibly so their tiles load and
    // querySourceFeatures can read them.
    <Source id={SRC} type="vector" url={OPENFREEMAP_TILEJSON}>
      <Layer id={PROBE_LAYER} type="fill" source-layer="building" minzoom={MIN_ZOOM} beforeId={LAYER_SLOTS.SHADOWS} paint={{ "fill-opacity": 0 }} />
    </Source>
  )
})
BuildingShadowLayer.displayName = "BuildingShadowLayer"
