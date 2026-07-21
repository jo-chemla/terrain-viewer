// GPU-accelerated replacement for the per-pixel JS loop in
// lib/phong-protocol.ts — same Blinn-Phong math (ambient+diffuse+specular
// against a compass-fixed light, multiply-darken/screen-brighten blend), run
// once per pixel in a WebGL2 fragment shader instead of a JS `for` loop. This
// is the shading step ONLY — the per-tile normal map itself is still
// computed (and cached, independent of light direction) by
// lib/gpu-normal-compute.ts / normals-protocol.ts; this module just consumes
// that already-computed Uint8ClampedArray as its input texture, so dragging
// the light-direction pad never re-derives the surface normal, only
// re-shades from it.
//
// Reuses the exact blend/exaggeration-correction math this session's
// (now-deleted) PhongGlLayer fragment shader already had verified working —
// see git history for that file if the derivation ever needs re-checking.
//
// Row-order: identical reasoning to gpu-normal-compute.ts's header comment —
// the input normal texture is uploaded un-flipped (row 0 = north/top,
// matching computeNormalPixels's own array layout), and `gl_FragCoord.y`
// used directly as the texel row index — render's bottom-up viewport-Y and
// gl.readPixels's own bottom-up row order cancel out, producing a correct
// top-down output buffer with no explicit flip needed, exactly like that
// module.
let gl: WebGL2RenderingContext | null = null
let canvas: OffscreenCanvas | null = null
let program: WebGLProgram | null = null
let quadBuffer: WebGLBuffer | null = null
let normalTexture: WebGLTexture | null = null
let uDiffuseStrength: WebGLUniformLocation | null = null
let uSpecularStrength: WebGLUniformLocation | null = null
let uExaggeration: WebGLUniformLocation | null = null
let uLightDir: WebGLUniformLocation | null = null
let currentSize = 0

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform highp sampler2D u_normalMap;
uniform float u_diffuseStrength;
uniform float u_specularStrength;
uniform float u_exaggeration;
uniform vec3 u_lightDir;
out vec4 fragColor;

const float AMBIENT = 0.35;
const float SHININESS = 32.0;

void main() {
    ivec2 coord = ivec2(int(gl_FragCoord.x), int(gl_FragCoord.y));
    vec3 encoded = texelFetch(u_normalMap, coord, 0).rgb;
    vec3 raw = encoded * 2.0 - 1.0;

    // Same live exaggeration re-derivation as lib/gpu-matcap-compute.ts —
    // see its identical comment for the derivation.
    vec2 slope = (raw.xy / raw.z) * u_exaggeration;
    vec3 n = normalize(vec3(slope, 1.0));

    vec3 L = u_lightDir;
    // Viewer looking straight down — same simplification the CPU version used.
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);

    float diffuse = u_diffuseStrength * max(dot(n, L), 0.0);
    float diffuseIntensity = clamp(AMBIENT + diffuse, 0.0, 1.0);
    float specDot = max(dot(n, H), 0.0);
    float specular = u_specularStrength * pow(specDot, SHININESS);
    float total = diffuseIntensity + specular;

    // Same two-regime multiply-darken/screen-brighten encoding as the CPU
    // version — see lib/phong-protocol.ts's header for the full rationale.
    // Straight (non-premultiplied) alpha out, matching what a PNG/ImageData
    // needs — color is either flatly black or white, so multiplying it by
    // alpha here would be wrong (black*alpha is still black either way, but
    // white*alpha would silently darken the highlight instead of leaving it
    // to alpha compositing).
    vec3 color;
    float alpha;
    if (total <= 1.0) {
        color = vec3(0.0);
        alpha = 1.0 - total;
    } else {
        color = vec3(1.0);
        alpha = min(total - 1.0, 1.0);
    }
    fragColor = vec4(color, alpha);
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`[gpu-phong-compute] shader compile failed: ${info}`)
  }
  return shader
}

function ensureContext(n: number): boolean {
  if (gl && canvas && program && currentSize === n) return true
  if (!gl) {
    canvas = new OffscreenCanvas(n, n)
    const ctx = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, alpha: true })
    if (!ctx) return false
    gl = ctx

    program = gl.createProgram()!
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program)
      gl = null
      throw new Error(`[gpu-phong-compute] program link failed: ${info}`)
    }

    quadBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, "a_pos")
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    normalTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, normalTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    uDiffuseStrength = gl.getUniformLocation(program, "u_diffuseStrength")
    uSpecularStrength = gl.getUniformLocation(program, "u_specularStrength")
    uExaggeration = gl.getUniformLocation(program, "u_exaggeration")
    uLightDir = gl.getUniformLocation(program, "u_lightDir")
  }
  if (currentSize !== n) {
    canvas!.width = n
    canvas!.height = n
    currentSize = n
  }
  return true
}

/** Returns null if WebGL2 isn't available (caller should fall back to the
 *  CPU per-pixel loop) — same n*n*4 RGBA byte layout either way. */
export function computePhongPixelsGPU(
  normalPixels: Uint8ClampedArray, n: number,
  diffuseStrength: number, specularStrength: number, lightDir: [number, number, number], exaggeration: number,
): Uint8ClampedArray | null {
  if (!ensureContext(n)) return null
  const ctx = gl!

  ctx.viewport(0, 0, n, n)
  ctx.useProgram(program)
  // This pass's own straight-alpha output must land in the color buffer
  // untouched by WebGL's compositing — disable blending explicitly rather
  // than rely on the default (blending is off by default, but this context
  // is a long-lived module singleton reused across calls, so don't assume no
  // other code path ever flips it on).
  ctx.disable(ctx.BLEND)

  ctx.bindBuffer(ctx.ARRAY_BUFFER, quadBuffer)
  const aPos = ctx.getAttribLocation(program!, "a_pos")
  ctx.enableVertexAttribArray(aPos)
  ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0)

  ctx.activeTexture(ctx.TEXTURE0)
  ctx.bindTexture(ctx.TEXTURE_2D, normalTexture)
  ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, false)
  ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, n, n, 0, ctx.RGBA, ctx.UNSIGNED_BYTE, normalPixels)
  ctx.uniform1i(ctx.getUniformLocation(program!, "u_normalMap"), 0)

  ctx.uniform1f(uDiffuseStrength, diffuseStrength)
  ctx.uniform1f(uSpecularStrength, specularStrength)
  ctx.uniform1f(uExaggeration, exaggeration)
  ctx.uniform3f(uLightDir, lightDir[0], lightDir[1], lightDir[2])

  ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4)

  const out = new Uint8Array(n * n * 4)
  ctx.readPixels(0, 0, n, n, ctx.RGBA, ctx.UNSIGNED_BYTE, out)
  return new Uint8ClampedArray(out.buffer)
}
