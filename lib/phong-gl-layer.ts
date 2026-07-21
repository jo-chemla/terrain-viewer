// A maplibre CustomLayerInterface implementing real ambient+diffuse+specular
// (Blinn-Phong) terrain shading from a movable compass-direction light, using
// the same per-pixel surface normals (lib/normals-protocol.ts) as
// lib/matcap-gl-layer.ts.
//
// Second time this class has existed this session: the raster-tile version
// (lib/phong-protocol.ts on main) bakes the ENTIRE Phong computation
// (light dot product, diffuse, specular) into each tile's own pixels, which
// means changing light direction/diffuse/specular strength re-fetches and
// recomputes every visible tile from scratch — this was the actual
// complaint that led to this rebuild: dragging the light-direction pad felt
// nowhere near as responsive as MapLibre's own hillshade illumination-
// direction (a pure GPU uniform update, zero recompute). Here, light
// direction/diffuse/specular/opacity are all live fragment-shader uniforms;
// only PANNING TO A NEW TILE costs anything (fetching + GPU-computing its
// normal map via NormalTileManager) — dragging the light pad is now just a
// uniform update + repaint, as fast as MapLibre's own shader.
//
// Unlike MatcapGlLayer, this does NOT rotate the sampled normal by bearing:
// a matcap's highlight is deliberately camera-relative (an artistic choice),
// whereas a Phong light direction is meant to behave like real sunlight,
// fixed to compass directions the same way maplibre's own hillshade-
// illumination-direction is — panning/rotating the map must NOT spin the
// light. The raw (unrotated) normal-map encoding is already compass-aligned
// (see normals-protocol.ts's header), so the light vector is built directly
// in that same space with no rotation needed.
//
// Blend: MapLibre raster/custom layers only composite via standard "over"
// alpha blending — no multiply-blend mode exists to paint. Below "neutral"
// brightness (diffuseIntensity + specular <= 1) this draws a BLACK overlay
// whose alpha carries the darkening (alpha = 1-total): over-compositing
// gives result = background*(1-alpha) = background*total, a true multiply-
// darken, transparent (background untouched) at full brightness. Above
// neutral — reachable only via specular, since ordinary diffuse lighting
// alone is capped at 1 and never "blows out" on its own — this switches to
// a WHITE overlay whose alpha ramps with the excess, a screen-like
// brightening that lets a strong highlight actually paint brighter than the
// terrain, not just "not darkened".
//
// Light-direction sign: NOT derived from first principles (an earlier
// attempt to derive it via lib/aspect-protocol.ts's own dx/dy-to-compass
// formula as "ground truth" produced a plausible-looking but WRONG answer).
// Pinned instead by direct empirical measurement against maplibre's own
// (independently implemented) native hillshade shader: added a real
// `type: "hillshade"` layer at a known illumination-direction/altitude
// pointed at the same DEM, captured both renders' pixels via gl.readPixels,
// and computed the Pearson correlation of their luminance over the same
// viewport. The x (east/west) sign was backwards (r ~ -0.89 at due-east
// light) while y (north/south) was already correct — flipping x alone gives
// r ~ +0.93 at both due-east and due-north against maplibre's own shader.
import type maplibregl from "maplibre-gl"
import type { CustomRenderMethodInput } from "maplibre-gl"
import { NormalTileManager } from "./normal-tile-manager"
import type { UpstreamEncoding } from "./normal-derived-protocol"

export interface PhongLayerOptions {
  upstreamTemplate: string
  encoding: UpstreamEncoding
  tileSize: number
  maxzoom: number
  opacity: number
  diffuseStrength: number
  specularStrength: number
  /** Compass azimuth of the light, degrees clockwise from north (same
   *  convention as the on-map "hold L, drag" light control). */
  lightDir: number
  /** Light elevation above the horizon, degrees (90 = straight down/zenith). */
  lightAlt: number
  /** Baked in at construction — true in 3D/globe view mode (real native
   *  terrain extruded). Determines renderingMode, which can't change on a
   *  live CustomLayerInterface instance. */
  drapeEnabled: boolean
  /** Same exaggeration factor driving maplibre's own native `setTerrain()`
   *  call, kept identical so this layer's drape aligns with the real
   *  extruded terrain beneath it. */
  exaggeration: number
}

const EARTH_RADIUS_M = 6371008.8
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * EARTH_RADIUS_M

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`[PhongGlLayer] shader compile failed: ${info}`)
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
    throw new Error(`[PhongGlLayer] program link failed: ${info}`)
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
uniform float u_opacity;
uniform float u_diffuseStrength;
uniform float u_specularStrength;
// Unit light direction, in the SAME un-rotated tile-pixel space the normal
// map itself is encoded in (see this module's header on the sign).
uniform vec3 u_lightDir;
in vec2 v_texCoord;
out vec4 fragColor;

const float AMBIENT = 0.35;
const float SHININESS = 32.0;

void main() {
    vec3 encoded = texture(u_normalMap, v_texCoord).rgb;
    vec3 n = normalize(encoded * 2.0 - 1.0);

    vec3 L = u_lightDir;
    // Viewer looking straight down — a reasonable approximation for this
    // mostly-top-down/oblique map camera.
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
    // Premultiplied alpha — matches the gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA)
    // maplibre sets up before calling a custom layer's render().
    fragColor = vec4(color * alpha, alpha);
}
`

export class PhongGlLayer implements maplibregl.CustomLayerInterface {
  id = "phong-terrain"
  type = "custom" as const
  renderingMode: "2d" | "3d"

  private opts: PhongLayerOptions
  private map: maplibregl.Map | null = null
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private uMatrix: WebGLUniformLocation | null = null
  private uTileBounds: WebGLUniformLocation | null = null
  private uPixelPerMeter: WebGLUniformLocation | null = null
  private uOpacity: WebGLUniformLocation | null = null
  private uDiffuseStrength: WebGLUniformLocation | null = null
  private uSpecularStrength: WebGLUniformLocation | null = null
  private uLightDir: WebGLUniformLocation | null = null
  private uNormalMap: WebGLUniformLocation | null = null
  private aUv = -1
  private aElevation = -1

  private tiles: NormalTileManager

  constructor(opts: PhongLayerOptions) {
    this.opts = opts
    this.renderingMode = opts.drapeEnabled ? "3d" : "2d"
    this.tiles = new NormalTileManager(
      { upstreamTemplate: opts.upstreamTemplate, encoding: opts.encoding, tileSize: opts.tileSize, maxzoom: opts.maxzoom },
      () => this.map?.triggerRepaint(),
    )
  }

  /** Live-updates options without recreating the layer (or its tile cache).
   *  Everything here (opacity, diffuse/specular strength, light direction)
   *  is a fragment-shader uniform applied on the next render(), so this
   *  never touches the tile cache — dragging the light-direction pad is
   *  just a uniform update + repaint. drapeEnabled is intentionally NOT
   *  accepted here — switching view modes recreates the whole layer via
   *  PhongLayer.tsx instead, since renderingMode can't change on a live
   *  instance. */
  updateOptions(next: Partial<Omit<PhongLayerOptions, "drapeEnabled">>) {
    this.opts = { ...this.opts, ...next }
    this.tiles.updateOptions({
      upstreamTemplate: this.opts.upstreamTemplate,
      encoding: this.opts.encoding,
      tileSize: this.opts.tileSize,
      maxzoom: this.opts.maxzoom,
    })
    this.map?.triggerRepaint()
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (!(gl instanceof WebGL2RenderingContext)) {
      console.error("[PhongGlLayer] WebGL2 context required")
      return
    }
    this.map = map
    this.gl = gl
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
    this.uMatrix = gl.getUniformLocation(this.program, "u_matrix")
    this.uTileBounds = gl.getUniformLocation(this.program, "u_tileBounds")
    this.uPixelPerMeter = gl.getUniformLocation(this.program, "u_pixelPerMeter")
    this.uOpacity = gl.getUniformLocation(this.program, "u_opacity")
    this.uDiffuseStrength = gl.getUniformLocation(this.program, "u_diffuseStrength")
    this.uSpecularStrength = gl.getUniformLocation(this.program, "u_specularStrength")
    this.uLightDir = gl.getUniformLocation(this.program, "u_lightDir")
    this.uNormalMap = gl.getUniformLocation(this.program, "u_normalMap")
    this.aUv = gl.getAttribLocation(this.program, "a_uv")
    this.aElevation = gl.getAttribLocation(this.program, "a_elevation")

    this.tiles.attach(map, gl)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vite/client types aren't in this tsconfig
    if ((import.meta as any).env?.DEV) (window as any).__phongLayer = this
  }

  onRemove() {
    this.tiles.detach()
    const gl = this.gl
    if (gl && this.program) gl.deleteProgram(this.program)
    this.map = null
    this.gl = null
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (!(gl instanceof WebGL2RenderingContext)) return
    if (!this.program || !this.map) return

    const visible = this.tiles.getVisibleTiles()
    if (visible.length === 0) return

    const uvBuffer = this.tiles.getUvBuffer()
    const indexBuffer = this.tiles.getIndexBuffer()
    const indexCount = this.tiles.getIndexCount()
    if (!uvBuffer || !indexBuffer) return

    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.uMatrix, false, options.modelViewProjectionMatrix as unknown as Float32Array)
    gl.uniform1f(this.uOpacity, this.opts.opacity)
    gl.uniform1f(this.uDiffuseStrength, this.opts.diffuseStrength)
    gl.uniform1f(this.uSpecularStrength, this.opts.specularStrength)

    const azRad = (this.opts.lightDir * Math.PI) / 180
    const elRad = (this.opts.lightAlt * Math.PI) / 180
    const cosEl = Math.cos(elRad)
    gl.uniform3f(this.uLightDir, -Math.sin(azRad) * cosEl, -Math.cos(azRad) * cosEl, Math.sin(elRad))

    const worldSize = 512 * Math.pow(2, this.map.getZoom())
    const latRad = (this.map.getCenter().lat * Math.PI) / 180
    const pixelPerMeter = this.opts.drapeEnabled
      ? (worldSize / (EARTH_CIRCUMFERENCE_M * Math.cos(latRad))) * this.opts.exaggeration
      : 0
    gl.uniform1f(this.uPixelPerMeter, pixelPerMeter)

    // See lib/matcap-gl-layer.ts's identical comment: this mesh is
    // numerically coincident with maplibre's own terrain surface, so clear
    // the depth buffer right before drawing (keeping the depth test itself
    // ON) to resolve this mesh's own self-occlusion without competing
    // against terrain depth it was always going to coincide with anyway.
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
