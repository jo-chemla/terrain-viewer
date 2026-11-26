// The River REM's jump flood (JFA) on the GPU: for every cell of the trend
// grid, the label of the nearest seed cell, the same answer as
// labelNearestSeed (lib/river-rem.ts) by another road.
//
// The seeds (the centerline burned into the grid, each cell holding the index
// of its segment) go up as one RGBA32F texture: seed column, seed row, label,
// 1. Each pass looks at the eight cells `step` away and keeps the nearest
// seed any of them knows; with steps n/2, n/4 ... 1 every cell has heard of
// its nearest seed after log2(n) passes (Rong and Tan, 2006). One pass of
// step 1 before and one after ("1+JFA+1") remove nearly all of the
// algorithm's known misses; the few left are a seed that is not the nearest
// but next to it, which refineNearest's search around the label absorbs.
//
// What comes back is only the label: the level and the distance are worked
// out on the CPU from the segment itself (refineNearest), because the tiles
// are computed on the CPU and need the grid as an array anyway.
//
// WebGL2 with EXT_color_buffer_float (rendering to float textures); without
// it the caller falls back to the distance transform, which gives the same
// labels.

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`

const FLOOD = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_src;
uniform int u_step;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(u_src, 0);
  vec4 best = texelFetch(u_src, p, 0);
  vec2 here = vec2(p);
  float bestD = best.a > 0.5 ? dot(best.xy - here, best.xy - here) : 1e30;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      ivec2 q = p + ivec2(dx, dy) * u_step;
      if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
      vec4 c = texelFetch(u_src, q, 0);
      if (c.a < 0.5) continue;
      float d = dot(c.xy - here, c.xy - here);
      if (d < bestD) { bestD = d; best = c; }
    }
  }
  o = best;
}`

interface Gpu { canvas: OffscreenCanvas | HTMLCanvasElement; gl: WebGL2RenderingContext; program: WebGLProgram; uSrc: WebGLUniformLocation | null; uStep: WebGLUniformLocation | null; vao: WebGLVertexArrayObject }
let gpu: Gpu | null | undefined

function init(): Gpu | null {
  if (gpu !== undefined) return gpu
  gpu = null
  try {
    const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas")
    const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) return null
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader")
      return shader
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FLOOD))
    gl.bindAttribLocation(program, 0, "a_pos")
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link")
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    canvas.addEventListener?.("webglcontextlost", () => { gpu = undefined })
    gpu = { canvas, gl, program, uSrc: gl.getUniformLocation(program, "u_src"), uStep: gl.getUniformLocation(program, "u_step"), vao }
  } catch {
    gpu = null
  }
  return gpu
}

/** True when the jump flood can run here. */
export function riverRemGpuAvailable(): boolean { return init() !== null }

/** The label of the nearest seed for every cell, or null when the GPU cannot
 *  do it (no WebGL2, no float render targets, a grid larger than the largest
 *  texture, a lost context). `seeds` as burnCenterline gives them: a label
 *  (>= 0) on the centerline's cells, -1 elsewhere. Blocks until the GPU has
 *  finished (readPixels), so the time measured around it is the whole cost. */
export function jumpFloodLabels(seeds: Int32Array, w: number, h: number): { labels: Int32Array; passes: number } | null {
  const g = init()
  if (!g) return null
  const { gl } = g
  if (gl.isContextLost() || Math.max(w, h) > (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number)) return null
  const textures: WebGLTexture[] = []
  const framebuffers: WebGLFramebuffer[] = []
  try {
    const initial = new Float32Array(w * h * 4)
    let any = false
    for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
      const label = seeds[row * w + col]
      if (label < 0) continue
      const at = (row * w + col) * 4
      initial[at] = col; initial[at + 1] = row; initial[at + 2] = label; initial[at + 3] = 1
      any = true
    }
    if (!any) return { labels: new Int32Array(w * h).fill(-1), passes: 0 }
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, i === 0 ? initial : null)
      const framebuffer = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null
      textures.push(texture); framebuffers.push(framebuffer)
    }
    gl.useProgram(g.program)
    gl.bindVertexArray(g.vao)
    gl.viewport(0, 0, w, h)
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(g.uSrc, 0)
    const steps = [1]
    for (let step = 2 ** Math.ceil(Math.log2(Math.max(w, h))) / 2; step >= 1; step /= 2) steps.push(step)
    steps.push(1)
    let source = 0
    for (const step of steps) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[1 - source])
      gl.bindTexture(gl.TEXTURE_2D, textures[source])
      gl.uniform1i(g.uStep, step)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      source = 1 - source
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[source])
    const out = new Float32Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out)
    if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) return null
    const labels = new Int32Array(w * h)
    for (let i = 0; i < labels.length; i++) labels[i] = out[i * 4 + 3] > 0.5 ? out[i * 4 + 2] : -1
    return { labels, passes: steps.length }
  } catch {
    return null
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    for (const texture of textures) gl.deleteTexture(texture)
    for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer)
  }
}
