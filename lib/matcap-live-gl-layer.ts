// Live-uniform WebGL Matcap shading — the "Fast" alternative to
// lib/matcap-protocol.ts's raster-tile pipeline. Tiles, textures and the two
// draw paths (flat onto the map with terrain off; MapLibre's
// renderToTerrainTile per terrain tile with terrain on) are shared with the
// live Phong layer in lib/live-dem-gl-layer.ts; this file is the shading.
// The output is opaque material colour at the layer opacity, premultiplied
// (MapLibre's default blend), so it composites the same in any terrain stack.
//
// A matcap samples the material image by the surface normal, in one of two
// frames:
//  - "Camera" (default): the CLASSIC matcap lookup — the normal projected
//    onto the camera's own right/up basis (view-space normal), so the
//    material reads like a sphere held up to the current camera and tracks
//    live through rotate/tilt gestures. The right/up basis is derived
//    ANALYTICALLY from bearing/pitch (see setShadingUniforms) — an earlier
//    unprojection-based basis had a bearing-handedness flip in the
//    left-handed tile frame that mirrored the matcap's U axis facing
//    east/west. View dependent: with terrain on, the draped tiles are
//    redrawn whenever the bearing or pitch moves (terrainTileRevision).
//  - "Absolute": the tile-space orthographic lookup, UV = N.xy*0.5+0.5 —
//    identical to the raster pipeline (gpu-matcap-compute.ts /
//    matcap-protocol.ts), pinned to compass directions and unaffected by
//    camera orientation. The two conventions coincide exactly at a
//    top-down, north-up camera.
// A previous iteration instead built a per-fragment view ray (gl_FragCoord
// + FOV, or an inverse-projection unproject) and sampled by
// reflect(viewRay, N) — deliberately, chasing perspective ray divergence
// away from the optical axis. That construction is wrong for a matcap on
// two counts: reflect() doubles the angular response (the whole material
// compresses into the ±45° slope band, everything steeper clamps to the
// texture rim), and on flat/low-relief terrain reflect(I, +Z).xy == I.xy —
// the ray's own screen position — which painted a screen-locked radial
// blob of the matcap's center (its brightest region on most materials)
// glued to the middle of the viewport, sliding with the camera instead of
// the ground. That's the "weird fade-in at the center of the screen".
import type { Map as MapLibreMap } from "maplibre-gl"
import { DEM_NORMAL_GLSL, LiveDemGlLayer, type LiveDemOptions } from "./live-dem-gl-layer"

export type MatcapLiveOptions = LiveDemOptions & {
  /** Material-capture image URL (lib/matcap-textures.ts). */
  matcapUrl: string
  /** Spins the material's apparent orientation only (never the surface
   *  geometry) — same "Sphere Rotation" convention as matcap-protocol.ts /
   *  gpu-matcap-compute.ts. */
  rotationDeg: number
  exaggeration: number
  opacity: number
  /** "Light Anchor", ported from phong-live-gl-layer.ts's own
   *  lightRelativeToCamera: true ("Camera" / attached to camera, the
   *  default) samples the matcap by the VIEW-SPACE normal — the normal
   *  projected onto the camera's live right/up basis (analytic from
   *  bearing/pitch — see setShadingUniforms) — the classic matcap look,
   *  tracking rotate/tilt gestures. false ("Absolute") samples by the
   *  tile-space normal directly (UV = N.xy*0.5+0.5), identical to the
   *  raster pipeline: pinned to compass directions,
   *  camera-orientation-agnostic. See the header comment for why the older
   *  per-fragment reflect() construction was scrapped. */
  lightRelativeToCamera: boolean
}

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_matcap;
uniform float u_rotationRad;
uniform float u_exaggeration;
uniform float u_opacity;
uniform bool u_lightRelativeToCamera;
// Camera basis in the same tile-local (x=east, y=south, z=up) frame the
// normals live in — computed once per draw CPU-side from bearing/pitch
// and constant across fragments; NOT per-fragment. A matcap is defined by
// the normal's orientation relative to the camera, not by which pixel the
// fragment lands on.
uniform vec3 u_cameraRight;
uniform vec3 u_cameraUp;
out vec4 fragColor;
${DEM_NORMAL_GLSL}

void main() {
  // Per-fragment Horn normal straight from the Float32 DEM (DEM_NORMAL_GLSL,
  // live-dem-gl-layer.ts). Exaggeration applies live.
  vec3 n = demNormal(v_uv, u_exaggeration);

  // Only the material's apparent orientation rotates (Sphere Rotation),
  // never the surface itself.
  float cb = cos(u_rotationRad);
  float sb = sin(u_rotationRad);
  vec3 rotatedN = vec3(n.x * cb + n.y * sb, -n.x * sb + n.y * cb, n.z);

  vec2 uv;
  if (u_lightRelativeToCamera) {
    // "Camera": classic view-space matcap — the normal projected onto the
    // camera's live right/up axes. Screen-right-facing slopes sample the
    // material sphere's right, screen-up-facing its top (v flipped: image
    // v grows downward).
    //
    // nGeo: the shared hornGradient's axes have ASYMMETRIC sign
    // conventions — dy is (south − north), the standard row-axis
    // derivative, but dx is (west − east), NEGATED vs standard — so the
    // normal's y component is geometrically correct while its x component
    // points uphill instead of out. Every downstream consumer is
    // calibrated to that flip (phong's empirically-pinned light signs,
    // the Absolute branch's raster-parity lookup), so it is corrected
    // HERE, at the one consumer that projects the normal onto real
    // camera axes — not in the kernel. Symptom fixed: facing east/west,
    // screen-up is dominated by n.x, and the flipped sign put the clay
    // matcap's under-sphere shadow on up-screen slopes (correct facing
    // north/south, where screen axes are driven by the correct n.y).
    vec3 nGeo = vec3(-rotatedN.x, rotatedN.y, rotatedN.z);
    uv = vec2(0.5 + 0.5 * dot(nGeo, u_cameraRight),
              0.5 - 0.5 * dot(nGeo, u_cameraUp));
  } else {
    // "Absolute": tile-space orthographic lookup, byte-identical in
    // convention to gpu-matcap-compute.ts / matcap-protocol.ts — pinned to
    // compass directions (east slopes sample the sphere's right, south its
    // bottom), unaffected by camera orientation.
    uv = rotatedN.xy * 0.5 + 0.5;
  }
  vec3 matcapColor = texture(u_matcap, uv).rgb;
  // Premultiplied, at the layer opacity.
  fragColor = vec4(matcapColor * u_opacity, u_opacity);
}
`

export class MatcapLiveLayer extends LiveDemGlLayer<MatcapLiveOptions> {
  protected readonly tag = "matcap-live-gl-layer"
  protected readonly fragmentShader = FRAGMENT_SHADER

  // The material image is independent of the DEM tile pyramid, so a
  // matcapUrl change needs no remount: ready() notices the mismatch and
  // swaps the texture when the new image arrives.
  private matcapTexture: WebGLTexture | null = null
  private matcapTextureUrl: string | null = null
  private matcapTextureLoading = false
  private loggedMatcapError = false

  protected viewDependent(): boolean {
    return this.options.lightRelativeToCamera
  }

  onRemove(map: MapLibreMap, gl: WebGL2RenderingContext) {
    if (this.matcapTexture) gl.deleteTexture(this.matcapTexture)
    this.matcapTexture = null
    this.matcapTextureUrl = null
    super.onRemove(map, gl)
  }

  /** Kicks off the material image load when the URL changed; nothing is
   *  drawn until the first image is in. */
  protected ready(gl: WebGL2RenderingContext): boolean {
    if (this.options.matcapUrl !== this.matcapTextureUrl && !this.matcapTextureLoading) {
      this.loadMatcapTexture(gl, this.options.matcapUrl)
    }
    return !!this.matcapTexture
  }

  /** Fetches + uploads the material image for a new matcapUrl — mirrors
   *  gpu-matcap-compute.ts's getMatcapTexture, instance-scoped here. */
  private loadMatcapTexture(gl: WebGL2RenderingContext, url: string) {
    this.matcapTextureLoading = true
    fetch(url)
      .then((res) => res.blob())
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        this.matcapTextureLoading = false
        if (this.disposed || !this.gl) return
        const texture = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        bitmap.close()
        if (this.matcapTexture) gl.deleteTexture(this.matcapTexture)
        this.matcapTexture = texture
        this.matcapTextureUrl = url
        this.changed()
      })
      .catch((err) => {
        this.matcapTextureLoading = false
        if (!this.loggedMatcapError) {
          this.loggedMatcapError = true
          console.error(`[matcap-live-gl-layer] material image fetch failed: ${url}`, err)
        }
      })
  }

  protected setShadingUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
    const map = this.map!
    const u = (name: string) => this.uniform(gl, program, name)
    gl.uniform1i(u("u_matcap"), 2)
    gl.uniform1f(u("u_rotationRad"), (this.options.rotationDeg * Math.PI) / 180)
    gl.uniform1f(u("u_exaggeration"), this.options.exaggeration)
    gl.uniform1f(u("u_opacity"), this.options.opacity)
    gl.uniform1i(u("u_lightRelativeToCamera"), this.options.lightRelativeToCamera ? 1 : 0)

    // Camera basis for the view-space ("Camera") lookup — ANALYTIC from
    // bearing/pitch, not unprojected from the tile matrix. The previous
    // computeCameraBasis-derived right vector had a bearing-handedness
    // flip (tile-local x=east/y=south/z=up is a LEFT-handed frame, which
    // the Gram-Schmidt unprojection didn't account for): correct facing
    // north/south (sin β = 0) but U-mirrored facing east/west — a clay
    // matcap's under-sphere shadow landed on the up-facing slopes there
    // (user-reported 2026-08-21). Derivation in right-handed ENU
    // (x=east, y=north, z=up), then converted to tile coords (negate y):
    //   screen-right = (cos β, −sin β, 0)_ENU   → (cos β, sin β, 0)_tile
    //   screen-up    = (sin β·cos p, cos β·cos p, sin p)_ENU
    //                → (sin β·cos p, −cos β·cos p, sin p)_tile
    // β=0 reduces to right=east/up=north(+zenith with pitch), the
    // Absolute-coincident orientation; β=90 yields right=south (tile +y),
    // un-mirroring east/west. Roll is ignored (the app never sets one).
    if (this.options.lightRelativeToCamera) {
      const bRad = (map.getBearing() * Math.PI) / 180
      const pRad = (map.getPitch() * Math.PI) / 180
      gl.uniform3f(u("u_cameraRight"), Math.cos(bRad), Math.sin(bRad), 0)
      gl.uniform3f(u("u_cameraUp"), Math.sin(bRad) * Math.cos(pRad), -Math.cos(bRad) * Math.cos(pRad), Math.sin(pRad))
    } else {
      // Unused by the Absolute branch — keep well-defined values anyway.
      gl.uniform3f(u("u_cameraRight"), 1, 0, 0)
      gl.uniform3f(u("u_cameraUp"), 0, -1, 0)
    }

    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.matcapTexture)
  }

  protected drawPasses(gl: WebGL2RenderingContext, _program: WebGLProgram, drawAll: () => void) {
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    drawAll()
  }
}
