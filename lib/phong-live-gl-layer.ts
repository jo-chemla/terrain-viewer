// Live-uniform WebGL Phong terrain shading — the "Fast" alternative to
// lib/phong-protocol.ts's raster-tile pipeline. Renders per visible tile as a
// flat quad, sampling the SAME cached normal texture that protocol produces
// (lib/normals-protocol.ts's computeNormalPixels — DEM fetch + Horn-gradient
// normal compute is genuinely shared, never redone here), but shades it live
// in a fragment shader with light direction/diffuse/specular/exaggeration as
// plain uniforms. A slider drag is therefore a uniform write + repaint, never
// a tile re-fetch/PNG-encode/re-decode round trip.
//
// FLAT ONLY, by design: this positions each tile using
// `map.transform.getProjectionData({overscaledTileID})`'s `mainMatrix` alone
// (the same per-tile matrix MapLibre's own hillshade/raster renderers use for
// mercator projection), with no elevation displacement at all. That matrix is
// documented as sufficient for "simple custom layers that also only support
// mercator projection" (see maplibre-gl's own CustomRenderMethodInput docs) —
// deliberately skipping globe support (no `shaderData.vertexShaderPrelude`)
// and, more importantly, deliberately skipping terrain drape. A prior attempt
// at draping a custom-layer mesh onto MapLibre's OWN elevated terrain surface
// (projectTileFor3D + a hand-built elevation buffer) never reliably matched
// that surface and was abandoned; deep-diving MapLibre's actual render
// internals since confirmed there is no public hook for a `type: "custom"`
// layer to participate in MapLibre's terrain-drape/RenderToTexture pipeline
// at all (see project memory). So: correct and instant in flat 2D/tilted-3D-
// without-terrain-elevation and even globe's OWN flat mercator fallback, but
// will render as a flat plane (not draped) if terrain elevation is active —
// that's the explicit speed/correctness trade this "Fast" mode offers, with
// lib/phong-protocol.ts's raster pipeline remaining the "Accurate" (terrain-
// and globe-correct) alternative.
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
   *  convention as phong-protocol.ts (state.illuminationDir). */
  lightDir: number
  /** Degrees above the horizon. */
  lightAlt: number
  diffuseStrength: number
  specularStrength: number
  exaggeration: number
  opacity: number
}

// Evicted LRU-style once exceeded — bounds GPU texture memory during long
// pan/zoom sessions without needing a hard tile-count cap on `coveringTiles`.
const MAX_CACHED_TEXTURES = 96

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
uniform mat4 u_matrix;
out vec2 v_uv;
const float TILE_EXTENT = 8192.0;
void main() {
  v_uv = a_pos / TILE_EXTENT;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}
`

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
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`[phong-live-gl-layer] program link failed: ${info}`)
  }
  return program
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
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private indexCount = 0
  private indexType = 0
  private uMatrix: WebGLUniformLocation | null = null
  private uNormalMap: WebGLUniformLocation | null = null
  private uLightDir: WebGLUniformLocation | null = null
  private uDiffuseStrength: WebGLUniformLocation | null = null
  private uSpecularStrength: WebGLUniformLocation | null = null
  private uExaggeration: WebGLUniformLocation | null = null
  private uOpacity: WebGLUniformLocation | null = null
  private textures = new Map<string, TextureEntry>()
  private pending = new Set<string>()
  private frameCounter = 0
  private disposed = false
  private loggedError = false

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
    this.program = compileProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
    this.uMatrix = gl.getUniformLocation(this.program, "u_matrix")
    this.uNormalMap = gl.getUniformLocation(this.program, "u_normalMap")
    this.uLightDir = gl.getUniformLocation(this.program, "u_lightDir")
    this.uDiffuseStrength = gl.getUniformLocation(this.program, "u_diffuseStrength")
    this.uSpecularStrength = gl.getUniformLocation(this.program, "u_specularStrength")
    this.uExaggeration = gl.getUniformLocation(this.program, "u_exaggeration")
    this.uOpacity = gl.getUniformLocation(this.program, "u_opacity")

    // A single shared quad mesh (granularity 1 — no subdivision needed for
    // flat mercator content) reused for every tile: only the per-tile
    // `u_matrix` differs between draw calls, never the geometry itself.
    const mesh = createTileMesh({ granularity: 1 }, "16bit")
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    const vertexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(this.program, "a_pos")
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.SHORT, false, 0, 0)
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
    if (this.program) gl.deleteProgram(this.program)
    if (this.vao) gl.deleteVertexArray(this.vao)
    this.program = null
    this.vao = null
    this.gl = null
    this.map = null
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
      .catch(() => { this.pending.delete(key) })
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

  render(glArg: WebGLRenderingContext | WebGL2RenderingContext, _args: CustomRenderMethodInput) {
    // This layer's shaders are #version 300 es (WebGL2-only) — onAdd already
    // requires a WebGL2RenderingContext to compile them, so by the time
    // render() runs, glArg is always actually a WebGL2RenderingContext too
    // (the same context instance); this cast just satisfies the wider
    // CustomLayerInterface signature (which also allows plain WebGL1).
    const gl = glArg as WebGL2RenderingContext
    const map = this.map
    if (!map || !this.program || !this.vao) return

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
      // Deliberately flat-only (see file header) — under globe projection
      // this layer would need shaderData.vertexShaderPrelude's projectTile()
      // instead of a plain per-tile matrix, which isn't implemented here; the
      // React wrapper is expected to keep this option unavailable while
      // viewMode is "globe", but bail defensively here too in case that ever
      // drifts.
      if (map.getProjection()?.type !== "mercator") return
      this.frameCounter++

      const tileIDs = map.coveringTiles({
        tileSize: this.options.tileSize,
        minzoom: this.options.minzoom,
        maxzoom: this.options.maxzoom,
      })

      // Compass azimuth + altitude -> unit light vector in the SAME (x=east,
      // y=south, z=up) space the normal map is encoded in — byte-for-byte the
      // same formula/empirically-verified signs as phong-protocol.ts (see its
      // header comment for how these signs were pinned against maplibre's own
      // hillshade shader).
      const azRad = (this.options.lightDir * Math.PI) / 180
      const elRad = (this.options.lightAlt * Math.PI) / 180
      const cosEl = Math.cos(elRad)
      const lx = -Math.sin(azRad) * cosEl
      const ly = -Math.cos(azRad) * cosEl
      const lz = Math.sin(elRad)

      gl.useProgram(this.program)
      gl.bindVertexArray(this.vao)
      gl.uniform1i(this.uNormalMap, 0)
      gl.uniform3f(this.uLightDir, lx, ly, lz)
      gl.uniform1f(this.uDiffuseStrength, this.options.diffuseStrength)
      gl.uniform1f(this.uSpecularStrength, this.options.specularStrength)
      gl.uniform1f(this.uExaggeration, this.options.exaggeration)
      gl.uniform1f(this.uOpacity, this.options.opacity)
      gl.activeTexture(gl.TEXTURE0)

      for (const tileID of tileIDs) {
        const key = tileID.key
        const entry = this.textures.get(key)
        if (!entry) {
          this.fetchTile(tileID, key)
          continue
        }
        entry.lastUsed = this.frameCounter

        // Per-tile matrix from MapLibre's own projection code — this alone is
        // "sufficient for simple custom layers that also only support mercator
        // projection" per maplibre-gl's own docs (CustomRenderMethodInput's
        // defaultProjectionData comment), which is exactly this layer's scope.
        const projectionData = map.transform.getProjectionData({ overscaledTileID: tileID })
        gl.uniformMatrix4fv(this.uMatrix, false, projectionData.mainMatrix)
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
