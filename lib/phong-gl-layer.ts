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
//
// Projection: positions vertices via maplibre's own `projectTileFor3D` GLSL
// helper (lib/custom-layer-projection.ts) rather than a hand-rolled flat-
// mercator matrix multiply — see that module's header for why the old
// `options.modelViewProjectionMatrix`-based approach rendered nothing at all
// under globe projection (it's documented as mercator-only).
import type maplibregl from "maplibre-gl"
import type { CustomRenderMethodInput } from "maplibre-gl"
import { NormalTileManager } from "./normal-tile-manager"
import type { UpstreamEncoding } from "./normal-derived-protocol"
import {
  buildProjectionAwareVertexShader,
  getProjectionUniformLocations,
  setProjectionUniforms,
  PROJECTION_AWARE_VERTEX_BODY,
  type ProjectionUniformLocations,
} from "./custom-layer-projection"

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
   *  call — applied both to this mesh's vertex height (matching the real
   *  extruded terrain beneath it) and, live, to the shading normals
   *  themselves (see the fragment shader below), so a taller/steeper-looking
   *  exaggerated surface shades with correspondingly steeper-looking
   *  lighting instead of the flatter, un-exaggerated contrast it would get
   *  from the cached normal map's own raw (unexaggerated) slope. */
  exaggeration: number
}

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

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_normalMap;
uniform float u_opacity;
uniform float u_diffuseStrength;
uniform float u_specularStrength;
uniform float u_exaggeration;
// Unit light direction, in the SAME un-rotated tile-pixel space the normal
// map itself is encoded in (see this module's header on the sign).
uniform vec3 u_lightDir;
in vec2 v_texCoord;
out vec4 fragColor;

const float AMBIENT = 0.35;
const float SHININESS = 32.0;

void main() {
    vec3 encoded = texture(u_normalMap, v_texCoord).rgb;
    vec3 raw = encoded * 2.0 - 1.0;

    // The cached normal map encodes the RAW (unexaggerated) surface slope —
    // recompute it live against the current exaggeration instead of baking a
    // fixed exaggeration into the cache (which would force a recompute of
    // every visible tile whenever the exaggeration slider moves, same
    // "instant uniform" reasoning as light direction). Since raw was built
    // as normalize(vec3(-dzdx, -dzdy, 1)), dividing x,y by z exactly recovers
    // the original (-dzdx, -dzdy) — the z cancels out of that ratio by
    // construction — letting the exaggeration be re-applied and the normal
    // re-normalized from scratch.
    vec2 slope = (raw.xy / raw.z) * u_exaggeration;
    vec3 n = normalize(vec3(slope, 1.0));

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

interface CompiledVariant {
  program: WebGLProgram
  projection: ProjectionUniformLocations
  uTileBounds: WebGLUniformLocation | null
  uExaggeration: WebGLUniformLocation | null
  uDrapeEnabled: WebGLUniformLocation | null
  uOpacity: WebGLUniformLocation | null
  uDiffuseStrength: WebGLUniformLocation | null
  uSpecularStrength: WebGLUniformLocation | null
  uLightDir: WebGLUniformLocation | null
  uNormalMap: WebGLUniformLocation | null
  aUv: number
  aElevation: number
}

export class PhongGlLayer implements maplibregl.CustomLayerInterface {
  id = "phong-terrain"
  type = "custom" as const
  renderingMode: "2d" | "3d"

  private opts: PhongLayerOptions
  private map: maplibregl.Map | null = null
  private gl: WebGL2RenderingContext | null = null
  // Keyed by options.shaderData.variantName ("mercator"/"globe") — the
  // projection prelude prepended to the vertex shader differs per variant,
  // so each needs its own compiled+linked program. See
  // lib/custom-layer-projection.ts's header for why.
  private variants = new Map<string, CompiledVariant>()

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
   *  Everything here (opacity, diffuse/specular strength, light direction,
   *  exaggeration) is a fragment/vertex-shader uniform applied on the next
   *  render(), so this never touches the tile cache. drapeEnabled is
   *  intentionally NOT accepted here — switching view modes recreates the
   *  whole layer via PhongLayer.tsx instead, since renderingMode can't
   *  change on a live instance. */
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

  private getVariant(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): CompiledVariant {
    const key = options.shaderData.variantName
    const cached = this.variants.get(key)
    if (cached) return cached

    const vertSrc = buildProjectionAwareVertexShader(options, PROJECTION_AWARE_VERTEX_BODY)
    const program = createProgram(gl, vertSrc, FRAGMENT_SHADER)
    const variant: CompiledVariant = {
      program,
      projection: getProjectionUniformLocations(gl, program),
      uTileBounds: gl.getUniformLocation(program, "u_tileBounds01"),
      uExaggeration: gl.getUniformLocation(program, "u_exaggeration"),
      uDrapeEnabled: gl.getUniformLocation(program, "u_drapeEnabled"),
      uOpacity: gl.getUniformLocation(program, "u_opacity"),
      uDiffuseStrength: gl.getUniformLocation(program, "u_diffuseStrength"),
      uSpecularStrength: gl.getUniformLocation(program, "u_specularStrength"),
      uLightDir: gl.getUniformLocation(program, "u_lightDir"),
      uNormalMap: gl.getUniformLocation(program, "u_normalMap"),
      aUv: gl.getAttribLocation(program, "a_uv"),
      aElevation: gl.getAttribLocation(program, "a_elevation"),
    }
    this.variants.set(key, variant)
    return variant
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (!(gl instanceof WebGL2RenderingContext)) {
      console.error("[PhongGlLayer] WebGL2 context required")
      return
    }
    this.map = map
    this.gl = gl
    // Programs are compiled lazily in render(), once the current projection's
    // shaderData is known — see getVariant().

    this.tiles.attach(map, gl)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vite/client types aren't in this tsconfig
    if ((import.meta as any).env?.DEV) (window as any).__phongLayer = this
  }

  onRemove() {
    this.tiles.detach()
    const gl = this.gl
    if (gl) {
      for (const variant of this.variants.values()) gl.deleteProgram(variant.program)
    }
    this.variants.clear()
    this.map = null
    this.gl = null
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (!(gl instanceof WebGL2RenderingContext)) return
    if (!this.map) return

    const visible = this.tiles.getVisibleTiles()
    if (visible.length === 0) return

    const uvBuffer = this.tiles.getUvBuffer()
    const indexBuffer = this.tiles.getIndexBuffer()
    const indexCount = this.tiles.getIndexCount()
    if (!uvBuffer || !indexBuffer) return

    const variant = this.getVariant(gl, options)
    gl.useProgram(variant.program)
    setProjectionUniforms(gl, variant.projection, options)
    gl.uniform1f(variant.uOpacity, this.opts.opacity)
    gl.uniform1f(variant.uDiffuseStrength, this.opts.diffuseStrength)
    gl.uniform1f(variant.uSpecularStrength, this.opts.specularStrength)
    gl.uniform1f(variant.uExaggeration, this.opts.exaggeration)
    gl.uniform1i(variant.uDrapeEnabled, this.opts.drapeEnabled ? 1 : 0)

    const azRad = (this.opts.lightDir * Math.PI) / 180
    const elRad = (this.opts.lightAlt * Math.PI) / 180
    const cosEl = Math.cos(elRad)
    gl.uniform3f(variant.uLightDir, -Math.sin(azRad) * cosEl, -Math.cos(azRad) * cosEl, Math.sin(elRad))

    // See lib/matcap-gl-layer.ts's identical comment: this mesh is
    // numerically coincident with maplibre's own terrain surface, so clear
    // the depth buffer right before drawing (keeping the depth test itself
    // ON) to resolve this mesh's own self-occlusion without competing
    // against pre-existing terrain depth the mesh was always going to
    // coincide with anyway.
    if (this.opts.drapeEnabled) gl.clear(gl.DEPTH_BUFFER_BIT)

    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
    gl.enableVertexAttribArray(variant.aUv)
    gl.vertexAttribPointer(variant.aUv, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)

    for (const entry of visible) {
      const n = 1 << entry.z
      const x0 = entry.x / n, x1 = (entry.x + 1) / n
      const y0 = entry.y / n, y1 = (entry.y + 1) / n
      gl.uniform4f(variant.uTileBounds, x0, y0, x1, y1)

      gl.bindBuffer(gl.ARRAY_BUFFER, entry.elevationBuffer)
      gl.enableVertexAttribArray(variant.aElevation)
      gl.vertexAttribPointer(variant.aElevation, 1, gl.FLOAT, false, 0, 0)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, entry.texture)
      gl.uniform1i(variant.uNormalMap, 0)

      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0)
    }
  }
}
