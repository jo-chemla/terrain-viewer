// GPU-accelerated replacement for the per-pixel JS loop in
// lib/normals-protocol.ts's computeNormalPixels — same Horn-gradient math,
// same output encoding (R/G/B = nx/ny/nz * 0.5 + 0.5), just run once per
// pixel in a WebGL2 fragment shader instead of a JS `for` loop with a
// sqrt+several multiplies per pixel. This is the expensive, shared step
// behind both lib/matcap-protocol.ts and lib/phong-protocol.ts, so
// accelerating it here speeds up both.
//
// Row-order note (the one genuinely easy way to get this wrong): the
// elevation grid is uploaded row-major, top-down (row 0 = north), matching
// every other consumer in this codebase (computeNormalPixels's own
// `pixels[(row*n+col)*4]`). Rather than fighting WebGL's bottom-up render/
// readback conventions with an explicit flip, this uses gl_FragCoord.y
// directly as the elevation row index: rendering is bottom-up (GL viewport
// row 0 = bottom) and gl.readPixels is ALSO bottom-up (returned row 0 =
// bottom) — those two bottom-up conventions cancel out, so "row = int(
// gl_FragCoord.y)" during render already produces a top-down buffer after
// readback, with no separate flip pass needed. Verified against
// computeNormalPixels's CPU output on a real tile before wiring this in.
let gl: WebGL2RenderingContext | null = null
let canvas: OffscreenCanvas | null = null
let program: WebGLProgram | null = null
let quadBuffer: WebGLBuffer | null = null
let elevationTexture: WebGLTexture | null = null
let uInvScale: WebGLUniformLocation | null = null
let uStride: WebGLUniformLocation | null = null
let uHalo: WebGLUniformLocation | null = null
let currentSize = 0

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform highp sampler2D u_elevation;
uniform float u_invScale;
uniform int u_stride;
uniform int u_halo;
out vec4 fragColor;

float sampleElev(int row, int col) {
    return texelFetch(u_elevation, ivec2(col, row), 0).r;
}

void main() {
    // See module header: this cancels GL's bottom-up render/readback
    // convention against this codebase's top-down row-major arrays.
    int row = int(gl_FragCoord.y);
    int col = int(gl_FragCoord.x);
    int pr = row + u_halo;
    int pc = col + u_halo;

    float a0 = sampleElev(pr - 1, pc - 1);
    float a1 = sampleElev(pr - 1, pc);
    float a2 = sampleElev(pr - 1, pc + 1);
    float a3 = sampleElev(pr, pc - 1);
    float a5 = sampleElev(pr, pc + 1);
    float a6 = sampleElev(pr + 1, pc - 1);
    float a7 = sampleElev(pr + 1, pc);
    float a8 = sampleElev(pr + 1, pc + 1);

    float dx = (a0 + 2.0 * a3 + a6 - (a2 + 2.0 * a5 + a8)) * u_invScale;
    float dy = (a6 + 2.0 * a7 + a8 - (a0 + 2.0 * a1 + a2)) * u_invScale;

    float invLen = 1.0 / sqrt(dx * dx + dy * dy + 1.0);
    float nx = -dx * invLen;
    float ny = -dy * invLen;
    float nz = invLen;

    fragColor = vec4(nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5, 1.0);
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`[gpu-normal-compute] shader compile failed: ${info}`)
  }
  return shader
}

function ensureContext(n: number): boolean {
  if (gl && canvas && program && currentSize === n) return true
  if (!gl) {
    canvas = new OffscreenCanvas(n, n)
    const ctx = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, alpha: false })
    if (!ctx) return false
    gl = ctx

    program = gl.createProgram()!
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program)
      gl = null
      throw new Error(`[gpu-normal-compute] program link failed: ${info}`)
    }

    quadBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, "a_pos")
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    elevationTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, elevationTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    uInvScale = gl.getUniformLocation(program, "u_invScale")
    uStride = gl.getUniformLocation(program, "u_stride")
    uHalo = gl.getUniformLocation(program, "u_halo")
  }
  if (currentSize !== n) {
    canvas!.width = n
    canvas!.height = n
    currentSize = n
  }
  return true
}

/** Returns null if WebGL2 isn't available (caller should fall back to the
 *  CPU computeNormalPixels loop) — same n*n*4 RGBA byte layout either way. */
export function computeNormalPixelsGPU(
  padded: Float32Array, stride: number, n: number, invScale: number, halo = 1,
): Uint8ClampedArray | null {
  if (!ensureContext(n)) return null
  const ctx = gl!

  ctx.viewport(0, 0, n, n)
  ctx.useProgram(program)

  ctx.bindBuffer(ctx.ARRAY_BUFFER, quadBuffer)
  const aPos = ctx.getAttribLocation(program!, "a_pos")
  ctx.enableVertexAttribArray(aPos)
  ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0)

  ctx.activeTexture(ctx.TEXTURE0)
  ctx.bindTexture(ctx.TEXTURE_2D, elevationTexture)
  // R32F, uploaded exactly as stored (no UNPACK_FLIP_Y) — texelFetch(x, y)
  // then addresses padded[y*stride+x] directly, no row-order surprises.
  ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.R32F, stride, stride, 0, ctx.RED, ctx.FLOAT, padded)
  ctx.uniform1i(ctx.getUniformLocation(program!, "u_elevation"), 0)
  ctx.uniform1f(uInvScale, invScale)
  ctx.uniform1i(uStride, stride)
  ctx.uniform1i(uHalo, halo)

  ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4)

  const out = new Uint8Array(n * n * 4)
  ctx.readPixels(0, 0, n, n, ctx.RGBA, ctx.UNSIGNED_BYTE, out)
  return new Uint8ClampedArray(out.buffer)
}
