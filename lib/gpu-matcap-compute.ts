// GPU-accelerated replacement for the per-pixel JS loop in
// lib/matcap-protocol.ts — same math (rotate the normal's xy, look up the
// matcap material by the rotated (x, y) as UV), run once per pixel in a
// WebGL2 fragment shader instead of a JS `for` loop. This is the shading
// step ONLY — the per-tile normal map itself is still computed (and cached,
// independent of rotation) by lib/gpu-normal-compute.ts / normals-protocol.ts;
// this module just consumes that already-computed Uint8ClampedArray as its
// input texture, so dragging the "Sphere Rotation" slider never re-derives
// the surface normal, only re-shades from it.
//
// Reuses the exact rotation/exaggeration-correction math this session's
// (now-deleted) MatcapGlLayer fragment shader already had verified working —
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
let uRotationRad: WebGLUniformLocation | null = null
let uExaggeration: WebGLUniformLocation | null = null
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
uniform sampler2D u_matcap;
uniform float u_rotationRad;
uniform float u_exaggeration;
out vec4 fragColor;

void main() {
    ivec2 coord = ivec2(int(gl_FragCoord.x), int(gl_FragCoord.y));
    vec3 encoded = texelFetch(u_normalMap, coord, 0).rgb;
    vec3 n = encoded * 2.0 - 1.0;

    // The cached normal map encodes the RAW (unexaggerated) surface slope —
    // reapply the current exaggeration live, the same reasoning as this
    // session's mesh-based fragment shader had: dividing x,y by z exactly
    // recovers the original (-dzdx, -dzdy) since z cancels out of that ratio
    // by construction, letting exaggeration be reapplied and the normal
    // renormalized from scratch.
    vec2 slope = (n.xy / n.z) * u_exaggeration;
    n = normalize(vec3(slope, 1.0));

    // Only the material's apparent orientation rotates, never the surface
    // geometry itself — a raster tile is baked once per z/x/y with no live
    // camera bearing to react to, so (unlike the old mesh layer) there's no
    // bearing term here, matching the CPU version's own rotation-only design.
    float cb = cos(u_rotationRad);
    float sb = sin(u_rotationRad);
    vec2 nxy = vec2(n.x * cb + n.y * sb, -n.x * sb + n.y * cb);

    vec2 uv = nxy * 0.5 + 0.5;
    vec3 matcapColor = texture(u_matcap, uv).rgb;
    fragColor = vec4(matcapColor, 1.0);
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`[gpu-matcap-compute] shader compile failed: ${info}`)
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
      throw new Error(`[gpu-matcap-compute] program link failed: ${info}`)
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

    uRotationRad = gl.getUniformLocation(program, "u_rotationRad")
    uExaggeration = gl.getUniformLocation(program, "u_exaggeration")
  }
  if (currentSize !== n) {
    canvas!.width = n
    canvas!.height = n
    currentSize = n
  }
  return true
}

// One WebGL texture per distinct matcap material — same fixed curated list
// (lib/matcap-textures.ts) as matcap-protocol.ts's own CPU pixel cache, so
// this never meaningfully grows either. Textures are context-bound, so this
// cache is invalidated (cleared) if the shared context is ever recreated —
// in practice it never is, ensureContext only (re)creates it once.
const matcapTextureCache = new Map<string, WebGLTexture>()

async function getMatcapTexture(matcapUrl: string): Promise<WebGLTexture | null> {
  const cached = matcapTextureCache.get(matcapUrl)
  if (cached) return cached
  if (!gl) return null
  const res = await fetch(matcapUrl)
  const blob = await res.blob()
  const bitmap = await createImageBitmap(blob)
  const texture = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // Matches this session's (now-deleted) MatcapGlLayer's own upload
  // convention exactly (unflipped) — its uv = nxy*0.5+0.5 formula was
  // verified visually correct against that same convention, so this reuses
  // it as-is rather than re-deriving the orientation from scratch.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  bitmap.close()
  matcapTextureCache.set(matcapUrl, texture)
  return texture
}

/** Returns null if WebGL2 isn't available (caller should fall back to the
 *  CPU per-pixel loop) — same n*n*4 RGBA byte layout either way. */
export async function computeMatcapPixelsGPU(
  normalPixels: Uint8ClampedArray, n: number, matcapUrl: string, rotationRad: number, exaggeration: number,
): Promise<Uint8ClampedArray | null> {
  if (!ensureContext(n)) return null
  const ctx = gl!

  const matcapTexture = await getMatcapTexture(matcapUrl)
  if (!matcapTexture) return null

  ctx.viewport(0, 0, n, n)
  ctx.useProgram(program)

  ctx.bindBuffer(ctx.ARRAY_BUFFER, quadBuffer)
  const aPos = ctx.getAttribLocation(program!, "a_pos")
  ctx.enableVertexAttribArray(aPos)
  ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0)

  ctx.activeTexture(ctx.TEXTURE0)
  ctx.bindTexture(ctx.TEXTURE_2D, normalTexture)
  ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, false)
  ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, n, n, 0, ctx.RGBA, ctx.UNSIGNED_BYTE, normalPixels)
  ctx.uniform1i(ctx.getUniformLocation(program!, "u_normalMap"), 0)

  ctx.activeTexture(ctx.TEXTURE1)
  ctx.bindTexture(ctx.TEXTURE_2D, matcapTexture)
  ctx.uniform1i(ctx.getUniformLocation(program!, "u_matcap"), 1)

  ctx.uniform1f(uRotationRad, rotationRad)
  ctx.uniform1f(uExaggeration, exaggeration)

  ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4)

  const out = new Uint8Array(n * n * 4)
  ctx.readPixels(0, 0, n, n, ctx.RGBA, ctx.UNSIGNED_BYTE, out)
  return new Uint8ClampedArray(out.buffer)
}
