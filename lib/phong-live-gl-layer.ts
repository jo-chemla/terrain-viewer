// Live-uniform WebGL Phong terrain shading — the "Fast" alternative to
// lib/phong-protocol.ts's raster-tile pipeline. Renders per visible tile as a
// flat quad, sampling the SAME cached normal texture that protocol produces
// (lib/normals-protocol.ts's computeNormalPixels — DEM fetch + Horn-gradient
// normal compute is genuinely shared, never redone here), but shades it live
// in a fragment shader with light direction/diffuse/specular/exaggeration as
// plain uniforms. A slider drag is therefore a uniform write + repaint, never
// a tile re-fetch/PNG-encode/re-decode round trip.
//
// MERCATOR + GLOBE, flat (no terrain drape). Positioning goes through
// MapLibre's OWN projection code via the per-frame `shaderData.vertexShaderPrelude`
// (which defines `projectTile(a_pos)`) plus the projection uniforms from
// `map.transform.getProjectionData({overscaledTileID})` — so the same tile
// quad projects correctly under mercator AND globe, matching how MapLibre's
// own layers do it. Because the shader variant depends on the active
// projection (`shaderData.variantName` flips mercator↔globe), the GL program
// is compiled lazily per variant and cached (see `programs` below): the plain
// per-tile `u_matrix` approach used before only handled mercator, which is why
// globe used to be unavailable for "2D Fast".
//
// Still FLAT (no terrain drape) by design: a prior attempt at draping a
// custom-layer mesh onto MapLibre's OWN elevated terrain surface
// (projectTileFor3D + a hand-built elevation buffer) never reliably matched
// that surface and was abandoned; deep-diving MapLibre's actual render
// internals since confirmed there is no public hook for a `type: "custom"`
// layer to participate in MapLibre's terrain-drape/RenderToTexture pipeline
// at all (see project memory). So: correct and instant in flat 2D, tilted-3D-
// without-terrain-elevation, and globe, but renders as a flat plane (not
// draped) if terrain elevation is active — that's the explicit speed/
// correctness trade this "Fast" mode offers, with lib/phong-protocol.ts's
// raster pipeline remaining the "Accurate" (terrain-draped) alternative.
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap, OverscaledTileID } from "maplibre-gl"
import { createTileMesh } from "maplibre-gl"
import { computeNormalPixels } from "./normals-protocol"
import type { UpstreamEncoding } from "./normal-derived-protocol"

export type PhongLiveOptions = {
  upstreamTemplate: string
  encoding: UpstreamEncoding
  tileSize: number
  minzoom?: number
  maxzoom?: number
  /** Compass azimuth, degrees clockwise from north — same field/sign
   *  convention as phong-protocol.ts (state.illuminationDir). In
   *  camera-relative mode (below) this is the azimuth RELATIVE to the camera;
   *  the live map bearing is added per-frame inside render(). */
  lightDir: number
  /** Degrees above the horizon. */
  lightAlt: number
  /** When true, the light is fixed to the CAMERA (a headlamp): the current map
   *  bearing is added to lightDir every rendered frame, read live from the
   *  transform — so the light tracks continuously through a rotate gesture,
   *  not just after it settles (which is all the React `lightDir` prop could
   *  ever do, and why baking bearing in upstream felt broken). Absolute mode
   *  (false) leaves the light pinned to compass directions. */
  lightRelativeToCamera: boolean
  diffuseStrength: number
  specularStrength: number
  exaggeration: number
  opacity: number
}

// Evicted LRU-style once exceeded — bounds GPU texture memory during long
// pan/zoom sessions without needing a hard tile-count cap on `coveringTiles`.
const MAX_CACHED_TEXTURES = 96

// The vertex shader is assembled per projection variant from MapLibre's own
// `shaderData` (see render()): the prelude declares the u_projection_* uniforms
// and defines `projectTile(vec2)`, which projects tile-local 0..EXTENT coords
// to clip space correctly under BOTH mercator and globe. `a_pos` is forced to
// attribute location 0 (bindAttribLocation, see compileProgram) so the single
// shared VAO works for every compiled variant.
function buildVertexShader(prelude: string, define: string): string {
  return `#version 300 es
${prelude}
${define}
in vec2 a_pos;
out vec2 v_uv;
const float TILE_EXTENT = 8192.0;
void main() {
  v_uv = a_pos / TILE_EXTENT;
  gl_Position = projectTile(a_pos);
}
`
}

// Same Blinn-Phong math/encoding as gpu-phong-compute.ts's fragment shader
// (kept byte-for-byte equivalent — see that file for the derivation/rationale
// of the two-regime multiply-darken/screen-brighten alpha encoding), except
// output is premultiplied — CustomLayerInterface.render's default blend func
// is `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`, which expects that.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_normalMap;
uniform vec3 u_lightDir;
uniform float u_diffuseStrength;
uniform float u_specularStrength;
uniform float u_exaggeration;
uniform float u_opacity;
out vec4 fragColor;

const float AMBIENT = 0.35;
const float SHININESS = 32.0;

void main() {
  vec3 encoded = texture(u_normalMap, v_uv).rgb;
  vec3 raw = encoded * 2.0 - 1.0;

  vec2 slope = (raw.xy / raw.z) * u_exaggeration;
  vec3 n = normalize(vec3(slope, 1.0));

  vec3 L = u_lightDir;
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
  fragColor = vec4(color * alpha, alpha);
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`[phong-live-gl-layer] shader compile failed: ${info}`)
  }
  return shader
}

function compileProgram(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const program = gl.createProgram()!
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSrc))
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc))
  // Pin a_pos to location 0 for every variant so the single shared VAO (set up
  // once in onAdd against index 0) stays valid no matter which program is bound.
  gl.bindAttribLocation(program, 0, "a_pos")
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`[phong-live-gl-layer] program link failed: ${info}`)
  }
  return program
}

// One compiled program per projection variant (mercator vs globe), each with
// its own uniform locations — see render()'s getProgram().
interface ProgramBundle {
  program: WebGLProgram
  uProjectionMatrix: WebGLUniformLocation | null
  uProjectionTileMercatorCoords: WebGLUniformLocation | null
  uProjectionClippingPlane: WebGLUniformLocation | null
  uProjectionTransition: WebGLUniformLocation | null
  uProjectionFallbackMatrix: WebGLUniformLocation | null
  uNormalMap: WebGLUniformLocation | null
  uLightDir: WebGLUniformLocation | null
  uDiffuseStrength: WebGLUniformLocation | null
  uSpecularStrength: WebGLUniformLocation | null
  uExaggeration: WebGLUniformLocation | null
  uOpacity: WebGLUniformLocation | null
}

interface TextureEntry {
  texture: WebGLTexture
  lastUsed: number
}

export class PhongLiveLayer implements CustomLayerInterface {
  id: string
  type: "custom" = "custom"
  renderingMode: "2d" = "2d"
  options: PhongLiveOptions

  private map: MapLibreMap | null = null
  private gl: WebGL2RenderingContext | null = null
  // Compiled programs keyed by shaderData.variantName (mercator vs globe) —
  // MapLibre hands us a different prelude per projection, so we can't compile
  // a single program up front in onAdd (which has no shaderData); we compile
  // lazily on first render for each variant and reuse thereafter.
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

  constructor(id: string, options: PhongLiveOptions) {
    this.id = id
    this.options = options
  }

  /** Live parameter update — no remount, no tile refetch, just a repaint with
   *  fresh uniform values (the whole point of this layer over the raster
   *  protocol). Changing upstreamTemplate/encoding/tileSize here would NOT
   *  invalidate already-cached textures (they're keyed only by z/x/y) — the
   *  React wrapper remounts a fresh instance instead for those. */
  updateOptions(patch: Partial<PhongLiveOptions>) {
    this.options = { ...this.options, ...patch }
    this.map?.triggerRepaint()
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    this.gl = gl
    // Programs are compiled lazily per projection variant in render() (we need
    // MapLibre's per-frame shaderData for the prelude, which onAdd doesn't get).

    // A single shared quad mesh (granularity higher than 1 so globe projection
    // has enough vertices to curve the tile across the sphere instead of a flat
    // chord — a 1×1 quad would visibly cut the corner under globe) reused for
    // every tile: only the per-tile projection uniforms differ between draw
    // calls, never the geometry itself. a_pos is bound to attribute location 0
    // for every program variant (see compileProgram), so this one VAO is valid
    // no matter which program is bound at draw time.
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
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.disposed = true
    for (const entry of this.textures.values()) gl.deleteTexture(entry.texture)
    this.textures.clear()
    this.pending.clear()
    for (const bundle of this.programs.values()) gl.deleteProgram(bundle.program)
    this.programs.clear()
    if (this.vao) gl.deleteVertexArray(this.vao)
    this.vao = null
    this.gl = null
    this.map = null
  }

  // Compile (once) and return the program for the current projection variant.
  // shaderData.variantName changes whenever the prelude/projection changes, so
  // it's the correct cache key (MapLibre's own docs recommend exactly this).
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
      uLightDir: gl.getUniformLocation(program, "u_lightDir"),
      uDiffuseStrength: gl.getUniformLocation(program, "u_diffuseStrength"),
      uSpecularStrength: gl.getUniformLocation(program, "u_specularStrength"),
      uExaggeration: gl.getUniformLocation(program, "u_exaggeration"),
      uOpacity: gl.getUniformLocation(program, "u_opacity"),
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
        // Was silently swallowed — an abort during pan is normal, but a real
        // fetch/compute failure here is exactly what leaves the layer white
        // with no clue why, so surface the first one.
        if (err?.name !== "AbortError" && !this.loggedFetchError) {
          this.loggedFetchError = true
          console.error(`[phong-live-gl-layer] normal-tile fetch/compute failed (z${z}/${x}/${y}); template=${this.options.upstreamTemplate}`, err)
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
    // This layer's shaders are #version 300 es (WebGL2-only) — onAdd already
    // requires a WebGL2RenderingContext to compile them, so by the time
    // render() runs, glArg is always actually a WebGL2RenderingContext too
    // (the same context instance); this cast just satisfies the wider
    // CustomLayerInterface signature (which also allows plain WebGL1).
    const gl = glArg as WebGL2RenderingContext
    const map = this.map
    if (!map || !this.vao) return

    // render() runs every single frame with no isolation from MapLibre's own
    // render loop — an uncaught exception here (e.g. from calling a
    // transform/projection method before the style has fully finished
    // loading) wouldn't just skip this layer, it could abort the whole
    // frame's remaining draw calls, which reads as "the entire map went
    // blank/white" rather than "this one overlay didn't render." try/finally
    // guarantees GL state (program/VAO binding) is always restored too, so a
    // failure here can't leave state that corrupts whatever layer MapLibre
    // draws next even if this layer's own draw calls didn't all complete.
    try {
      // Mercator AND globe are both handled: the program for the current
      // projection variant is compiled from MapLibre's own per-frame
      // shaderData (prelude + define), and projectTile() inside it does the
      // right thing for whichever projection is active. No projection bail.
      const bundle = this.getProgram(gl, args.shaderData)
      this.frameCounter++

      // Divide the covering tileSize by devicePixelRatio so a retina screen
      // pulls a higher zoom level (more, sharper tiles) — matching what
      // MapLibre's own native raster pipeline (3D Slow) does automatically, so
      // 2D Fast is no longer visibly softer than 3D Slow on hi-dpi displays.
      const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1
      const tileIDs = map.coveringTiles({
        tileSize: Math.max(1, Math.round(this.options.tileSize / dpr)),
        minzoom: this.options.minzoom,
        maxzoom: this.options.maxzoom,
      })

      // Compass azimuth + altitude -> unit light vector in the SAME (x=east,
      // y=south, z=up) space the normal map is encoded in — byte-for-byte the
      // same formula/empirically-verified signs as phong-protocol.ts (see its
      // header comment for how these signs were pinned against maplibre's own
      // hillshade shader).
      // Camera-relative: add the LIVE map bearing (read straight from the
      // transform this frame, not from a settled React prop) so the light
      // tracks smoothly as the map rotates, like a headlamp fixed to the view.
      const azDeg = this.options.lightDir + (this.options.lightRelativeToCamera ? map.getBearing() : 0)
      const azRad = (azDeg * Math.PI) / 180
      const elRad = (this.options.lightAlt * Math.PI) / 180
      const cosEl = Math.cos(elRad)
      const lx = -Math.sin(azRad) * cosEl
      const ly = -Math.cos(azRad) * cosEl
      const lz = Math.sin(elRad)

      gl.useProgram(bundle.program)
      gl.bindVertexArray(this.vao)
      gl.uniform1i(bundle.uNormalMap, 0)
      gl.uniform3f(bundle.uLightDir, lx, ly, lz)
      gl.uniform1f(bundle.uDiffuseStrength, this.options.diffuseStrength)
      gl.uniform1f(bundle.uSpecularStrength, this.options.specularStrength)
      gl.uniform1f(bundle.uExaggeration, this.options.exaggeration)
      gl.uniform1f(bundle.uOpacity, this.options.opacity)
      gl.activeTexture(gl.TEXTURE0)

      for (const tileID of tileIDs) {
        const key = tileID.key
        const entry = this.textures.get(key)
        if (!entry) {
          this.fetchTile(tileID, key)
          continue
        }
        entry.lastUsed = this.frameCounter

        // Per-tile projection uniforms from MapLibre's own projection code.
        // These are exactly what shaderData.vertexShaderPrelude's projectTile()
        // consumes, so the SAME shader handles mercator and globe — the whole
        // point of routing through the prelude instead of a bare u_matrix.
        // applyGlobeMatrix:true so globe gets the sphere transform (ignored,
        // harmlessly, under mercator).
        const p = map.transform.getProjectionData({ overscaledTileID: tileID, applyGlobeMatrix: true })
        gl.uniformMatrix4fv(bundle.uProjectionMatrix, false, p.mainMatrix)
        gl.uniform4f(bundle.uProjectionTileMercatorCoords, p.tileMercatorCoords[0], p.tileMercatorCoords[1], p.tileMercatorCoords[2], p.tileMercatorCoords[3])
        gl.uniform4f(bundle.uProjectionClippingPlane, p.clippingPlane[0], p.clippingPlane[1], p.clippingPlane[2], p.clippingPlane[3])
        gl.uniform1f(bundle.uProjectionTransition, p.projectionTransition)
        gl.uniformMatrix4fv(bundle.uProjectionFallbackMatrix, false, p.fallbackMatrix)
        gl.bindTexture(gl.TEXTURE_2D, entry.texture)
        gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0)
      }

      this.pruneTextures()
    } catch (err) {
      if (!this.loggedError) {
        console.error("[phong-live-gl-layer] render() failed — disabling further logging for this instance:", err)
        this.loggedError = true
      }
    } finally {
      gl.bindVertexArray(null)
      gl.useProgram(null)
    }
  }
}
