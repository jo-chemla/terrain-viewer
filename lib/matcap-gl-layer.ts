// A maplibre CustomLayerInterface implementing "matcap" (material-capture)
// terrain shading: instead of a directional-light Lambertian model (what
// maplibre's own hillshade layer does), it looks up a color directly from a
// pre-rendered sphere-under-studio-lighting image (the matcap texture) using
// the surface normal's own (x, y) as UV coordinates — the standard technique
// from 3D sculpting/viewer tools (ZBrush, Blender, and this feature's own
// inspiration, Potree's point-cloud matcap shading).
//
// Second time this class has existed this session: the raster-tile version
// (lib/matcap-protocol.ts on main) bakes the matcap lookup into each tile's
// own pixels, so changing the "Sphere Rotation" slider re-fetches/recomputes
// every visible tile — fine for an occasional adjustment, but nowhere near
// as responsive as dragging feels for MapLibre's own hillshade illumination-
// direction (a pure paint-property/uniform update). Rotation is a fragment-
// shader uniform here instead: only PANNING TO A NEW TILE costs anything
// (fetching + GPU-computing its normal map, via NormalTileManager); rotating
// the material just changes a uniform and repaints, instantly.
//
// Terrain draping: shares lib/normal-tile-manager.ts's NormalTileManager
// with PhongGlLayer, which fetches a per-tile elevation grid (real meters)
// alongside each tile's normal texture and hands back a shared UV+index
// buffer for a subdivided (not flat) tile mesh. See that module's header for
// the full mesh/buffer design, and this class's `drapeEnabled` option for
// when draping is actually applied vs. rendered flat at Z=0 (2D view mode,
// matching the flat un-terrained basemap beneath it).
import type maplibregl from "maplibre-gl"
import type { CustomRenderMethodInput } from "maplibre-gl"
import { NormalTileManager } from "./normal-tile-manager"
import type { UpstreamEncoding } from "./normal-derived-protocol"

export interface MatcapLayerOptions {
  upstreamTemplate: string
  encoding: UpstreamEncoding
  tileSize: number
  maxzoom: number
  matcapUrl: string
  opacity: number
  /** Degrees — spins the matcap lookup independently of the map's own
   *  bearing. A live uniform, so dragging this is instant. */
  rotationDeg: number
  /** Bypasses the matcap lookup entirely and draws the raw encoded normal-map
   *  tiles as-is (R/G/B = nx/ny/nz * 0.5 + 0.5) — a debugging aid to check
   *  whether tile fetch/positioning is correct independently of the matcap
   *  texture step. Default off. */
  debugNormals: boolean
  /** Baked in at construction — true in 3D/globe view mode (real native
   *  terrain extruded). Determines renderingMode, which can't change on a
   *  live CustomLayerInterface instance. */
  drapeEnabled: boolean
  /** Same exaggeration factor driving maplibre's own native `setTerrain()`
   *  call, kept identical so this layer's drape aligns with the real
   *  extruded terrain beneath it. */
  exaggeration: number
}

// WGS84 mean radius — matches maplibre's own geo/lng_lat.ts `earthRadius` exactly.
const EARTH_RADIUS_M = 6371008.8
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * EARTH_RADIUS_M

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`[MatcapGlLayer] shader compile failed: ${info}`)
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const program = gl.createProgram()!
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertSrc))
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragSrc))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`[MatcapGlLayer] program link failed: ${info}`)
  }
  return program
}

const VERTEX_SHADER = `#version 300 es
uniform mat4 u_matrix;
uniform vec4 u_tileBounds;
uniform float u_pixelPerMeter;
in vec2 a_uv;
in float a_elevation;
out vec2 v_texCoord;
void main() {
    vec2 pos = mix(u_tileBounds.xy, u_tileBounds.zw, a_uv);
    float worldZ = a_elevation * u_pixelPerMeter;
    v_texCoord = a_uv;
    gl_Position = u_matrix * vec4(pos, worldZ, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_normalMap;
uniform sampler2D u_matcap;
uniform float u_opacity;
uniform float u_bearingRad;
uniform float u_rotationRad;
uniform bool u_debugNormals;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
    vec3 encoded = texture(u_normalMap, v_texCoord).rgb;

    if (u_debugNormals) {
        fragColor = vec4(encoded * u_opacity, u_opacity);
        return;
    }

    vec3 n = encoded * 2.0 - 1.0;

    // Rotate the normal's xy by -(bearing + user rotation) so the matcap's
    // apparent light source stays fixed relative to the screen/camera (not
    // the map's north) while ALSO letting the user spin the material
    // independently via the "Sphere Rotation" slider — a live uniform, so
    // dragging it is instant (no tile refetch).
    float theta = u_bearingRad + u_rotationRad;
    float cb = cos(theta);
    float sb = sin(theta);
    vec2 nxy = vec2(n.x * cb + n.y * sb, -n.x * sb + n.y * cb);

    vec2 uv = nxy * 0.5 + 0.5;
    vec3 matcapColor = texture(u_matcap, uv).rgb;
    // Premultiplied alpha — matches the gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA)
    // maplibre sets up before calling a custom layer's render().
    fragColor = vec4(matcapColor * u_opacity, u_opacity);
}
`

export class MatcapGlLayer implements maplibregl.CustomLayerInterface {
  id = "matcap-terrain"
  type = "custom" as const
  renderingMode: "2d" | "3d"

  private opts: MatcapLayerOptions
  private map: maplibregl.Map | null = null
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private uMatrix: WebGLUniformLocation | null = null
  private uTileBounds: WebGLUniformLocation | null = null
  private uPixelPerMeter: WebGLUniformLocation | null = null
  private uOpacity: WebGLUniformLocation | null = null
  private uBearing: WebGLUniformLocation | null = null
  private uRotation: WebGLUniformLocation | null = null
  private uNormalMap: WebGLUniformLocation | null = null
  private uMatcap: WebGLUniformLocation | null = null
  private uDebugNormals: WebGLUniformLocation | null = null
  private aUv = -1
  private aElevation = -1

  private matcapTexture: WebGLTexture | null = null
  private tiles: NormalTileManager

  constructor(opts: MatcapLayerOptions) {
    this.opts = opts
    this.renderingMode = opts.drapeEnabled ? "3d" : "2d"
    this.tiles = new NormalTileManager(
      { upstreamTemplate: opts.upstreamTemplate, encoding: opts.encoding, tileSize: opts.tileSize, maxzoom: opts.maxzoom },
      () => this.map?.triggerRepaint(),
    )
  }

  /** Live-updates options without recreating the layer — re-fetches tiles
   *  only if the upstream DEM changed, reloads the matcap texture only if it
   *  changed. Everything else (opacity, rotationDeg, debugNormals) is a
   *  fragment-shader uniform applied on the next render(), so this never
   *  touches the tile cache for those. drapeEnabled is intentionally NOT
   *  accepted here — switching view modes recreates the whole layer via
   *  MatcapLayer.tsx instead, since renderingMode can't change on a live
   *  instance. */
  updateOptions(next: Partial<Omit<MatcapLayerOptions, "drapeEnabled">>) {
    const matcapChanged = next.matcapUrl !== undefined && next.matcapUrl !== this.opts.matcapUrl
    this.opts = { ...this.opts, ...next }
    this.tiles.updateOptions({
      upstreamTemplate: this.opts.upstreamTemplate,
      encoding: this.opts.encoding,
      tileSize: this.opts.tileSize,
      maxzoom: this.opts.maxzoom,
    })
    if (matcapChanged) this.loadMatcapTexture()
    this.map?.triggerRepaint()
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (!(gl instanceof WebGL2RenderingContext)) {
      console.error("[MatcapGlLayer] WebGL2 context required")
      return
    }
    this.map = map
    this.gl = gl
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
    this.uMatrix = gl.getUniformLocation(this.program, "u_matrix")
    this.uTileBounds = gl.getUniformLocation(this.program, "u_tileBounds")
    this.uPixelPerMeter = gl.getUniformLocation(this.program, "u_pixelPerMeter")
    this.uOpacity = gl.getUniformLocation(this.program, "u_opacity")
    this.uBearing = gl.getUniformLocation(this.program, "u_bearingRad")
    this.uRotation = gl.getUniformLocation(this.program, "u_rotationRad")
    this.uNormalMap = gl.getUniformLocation(this.program, "u_normalMap")
    this.uMatcap = gl.getUniformLocation(this.program, "u_matcap")
    this.uDebugNormals = gl.getUniformLocation(this.program, "u_debugNormals")
    this.aUv = gl.getAttribLocation(this.program, "a_uv")
    this.aElevation = gl.getAttribLocation(this.program, "a_elevation")

    this.tiles.attach(map, gl)
    this.loadMatcapTexture()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vite/client types aren't in this tsconfig
    if ((import.meta as any).env?.DEV) (window as any).__matcapLayer = this
  }

  onRemove() {
    this.tiles.detach()
    const gl = this.gl
    if (gl) {
      if (this.matcapTexture) gl.deleteTexture(this.matcapTexture)
      if (this.program) gl.deleteProgram(this.program)
    }
    this.map = null
    this.gl = null
  }

  private async loadMatcapTexture() {
    const url = this.opts.matcapUrl
    let img: HTMLImageElement
    try {
      img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.crossOrigin = "anonymous"
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error(`failed to load ${url}`))
        el.src = url
      })
    } catch (e) {
      console.error("[MatcapGlLayer] failed to load matcap texture", url, e)
      return
    }
    if (this.opts.matcapUrl !== url) return // superseded while loading
    const gl = this.gl
    if (!gl) return
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    if (this.matcapTexture) gl.deleteTexture(this.matcapTexture)
    this.matcapTexture = texture
    this.map?.triggerRepaint()
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (!(gl instanceof WebGL2RenderingContext)) return
    if (!this.program || !this.map) return
    if (!this.opts.debugNormals && !this.matcapTexture) return

    const visible = this.tiles.getVisibleTiles()
    if (visible.length === 0) return

    const uvBuffer = this.tiles.getUvBuffer()
    const indexBuffer = this.tiles.getIndexBuffer()
    const indexCount = this.tiles.getIndexCount()
    if (!uvBuffer || !indexBuffer) return

    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.uMatrix, false, options.modelViewProjectionMatrix as unknown as Float32Array)
    gl.uniform1f(this.uOpacity, this.opts.opacity)
    gl.uniform1f(this.uBearing, (this.map.getBearing() * Math.PI) / 180)
    gl.uniform1f(this.uRotation, (this.opts.rotationDeg * Math.PI) / 180)
    gl.uniform1i(this.uDebugNormals, this.opts.debugNormals ? 1 : 0)

    if (this.matcapTexture) {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.matcapTexture)
      gl.uniform1i(this.uMatcap, 1)
    }

    // options.modelViewProjectionMatrix expects vertex XY in mercator_0..1 *
    // worldSize (not raw 0..1) — see the mercator_transform.ts derivation
    // this class's earlier incarnation worked out this session.
    const worldSize = 512 * Math.pow(2, this.map.getZoom())
    const latRad = (this.map.getCenter().lat * Math.PI) / 180
    const pixelPerMeter = this.opts.drapeEnabled
      ? (worldSize / (EARTH_CIRCUMFERENCE_M * Math.cos(latRad))) * this.opts.exaggeration
      : 0
    gl.uniform1f(this.uPixelPerMeter, pixelPerMeter)

    // This mesh's elevation is numerically coincident with maplibre's own
    // terrain surface (same DEM, same pixelPerMeter scale) — the 3D custom-
    // layer depth test would otherwise see a tie almost everywhere and lose
    // it to floating-point noise, depth-testing this layer invisible despite
    // drawing real geometry. Clearing the depth buffer right before drawing
    // (keeping the depth test itself ON) resolves this mesh's own self-
    // occlusion correctly without competing against terrain depth this
    // layer was always going to coincide with anyway.
    if (this.opts.drapeEnabled) gl.clear(gl.DEPTH_BUFFER_BIT)

    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
    gl.enableVertexAttribArray(this.aUv)
    gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)

    for (const entry of visible) {
      const n = 1 << entry.z
      const x0 = (entry.x / n) * worldSize, x1 = ((entry.x + 1) / n) * worldSize
      const y0 = (entry.y / n) * worldSize, y1 = ((entry.y + 1) / n) * worldSize
      gl.uniform4f(this.uTileBounds, x0, y0, x1, y1)

      gl.bindBuffer(gl.ARRAY_BUFFER, entry.elevationBuffer)
      gl.enableVertexAttribArray(this.aElevation)
      gl.vertexAttribPointer(this.aElevation, 1, gl.FLOAT, false, 0, 0)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, entry.texture)
      gl.uniform1i(this.uNormalMap, 0)

      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0)
    }
  }
}
