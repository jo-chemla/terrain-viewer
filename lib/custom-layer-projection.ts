// Shared machinery letting a hand-written maplibre CustomLayerInterface (see
// matcap-gl-layer.ts, phong-gl-layer.ts) draw correctly under BOTH mercator
// (2D/3D) and globe projection, instead of the flat-mercator-only
// `options.modelViewProjectionMatrix` those layers originally used — its own
// type doc says outright: "A projection matrix is sufficient for simple
// custom layers that also only support mercator projection." Under globe
// projection the earth is curved, so a flat `u_matrix * vec4(pos, z, 1)`
// multiply places geometry nowhere near the visible sphere — this was why
// Matcap/Phong rendered nothing at all in globe view.
//
// MapLibre's own fix for this (used internally by every built-in layer,
// including its `hillshade`/`color-relief` terrain-draped layers) is to
// inject a per-projection GLSL prelude via `options.shaderData` that provides
// a `projectTileFor3D(vec2 posInTile_0to1, float elevationMeters)` function —
// implemented very differently per projection (a flat matrix multiply under
// mercator; a sphere projection + elevation-along-the-surface-normal under
// globe, see node_modules/maplibre-gl/src/shaders/_projection_{mercator,globe}
// .vertex.glsl) but with an IDENTICAL signature either way, so a layer's own
// shader source never needs an #ifdef for projection — it just always calls
// projectTileFor3D(...) and gets the right behavior depending on which
// prelude got compiled in.
//
// Because the prelude text differs per projection, a DIFFERENT WebGL program
// is needed per prelude — `options.shaderData.variantName` is exactly the
// cache key MapLibre itself recommends for this (changes only when the
// prelude/define pair changes — in practice just "mercator" and "globe").
//
// The prelude declares 5 uniforms (u_projection_matrix/_tile_mercator_coords/
// _clipping_plane/_transition/_fallback_matrix) that must be set every frame
// from `options.defaultProjectionData` — see maplibre-gl's own
// src/render/program/projection_program.ts for the canonical field→uniform
// mapping this mirrors. `defaultProjectionData` (as opposed to a per-tile
// `map.transform.getProjectionData({overscaledTileID})`) is the whole-world
// variant: `projectTileFor3D` takes tile position normalized to plain 0..1
// mercator (not 0..EXTENT tile-local), which is exactly the convenient form
// for a layer like this one that draws many different tiles in a single
// render() call without needing a fresh ProjectionData per tile.
import type { CustomRenderMethodInput } from "maplibre-gl"

export interface ProjectionUniformLocations {
  uProjectionMatrix: WebGLUniformLocation | null
  uProjectionTileMercatorCoords: WebGLUniformLocation | null
  uProjectionClippingPlane: WebGLUniformLocation | null
  uProjectionTransition: WebGLUniformLocation | null
  uProjectionFallbackMatrix: WebGLUniformLocation | null
}

export function getProjectionUniformLocations(gl: WebGL2RenderingContext, program: WebGLProgram): ProjectionUniformLocations {
  return {
    uProjectionMatrix: gl.getUniformLocation(program, "u_projection_matrix"),
    uProjectionTileMercatorCoords: gl.getUniformLocation(program, "u_projection_tile_mercator_coords"),
    uProjectionClippingPlane: gl.getUniformLocation(program, "u_projection_clipping_plane"),
    uProjectionTransition: gl.getUniformLocation(program, "u_projection_transition"),
    uProjectionFallbackMatrix: gl.getUniformLocation(program, "u_projection_fallback_matrix"),
  }
}

export function setProjectionUniforms(
  gl: WebGL2RenderingContext,
  locations: ProjectionUniformLocations,
  options: CustomRenderMethodInput,
) {
  const d = options.defaultProjectionData
  gl.uniformMatrix4fv(locations.uProjectionMatrix, false, d.mainMatrix as unknown as Float32Array)
  gl.uniform4f(locations.uProjectionTileMercatorCoords, ...d.tileMercatorCoords)
  gl.uniform4f(locations.uProjectionClippingPlane, ...d.clippingPlane)
  gl.uniform1f(locations.uProjectionTransition, d.projectionTransition)
  gl.uniformMatrix4fv(locations.uProjectionFallbackMatrix, false, d.fallbackMatrix as unknown as Float32Array)
}

// Prepended to every projection-aware vertex shader, in the exact order
// MapLibre's own docs specify: `#version` first (must be the literal first
// line of a GLES 3.00 shader), then the prelude, then the projection's own
// #define (e.g. `#define GLOBE`), then the layer's own shader body.
export function buildProjectionAwareVertexShader(options: CustomRenderMethodInput, body: string): string {
  return `#version 300 es\n${options.shaderData.vertexShaderPrelude}\n${options.shaderData.define}\n${body}`
}

// The vertex shader BODY (post-prelude) is identical between MatcapGlLayer
// and PhongGlLayer — both draw the same subdivided per-tile mesh
// (NormalTileManager) and only differ in their fragment shader. `a_elevation`
// is real meters (unexaggerated); exaggeration is applied here, live, the
// same way maplibre's own native terrain exaggeration is — so this mesh's
// height always matches the real terrain surface beneath it regardless of
// the current exaggeration slider value.
//
// u_drapeEnabled (not a zeroed-out u_exaggeration) is what flattens the mesh
// in 2D view mode: u_exaggeration is also read by the fragment shader to
// re-derive live-exaggerated shading normals from the cached (unexaggerated)
// normal map (see either layer's fragment shader), and that shading should
// stay exaggeration-responsive even in flat 2D mode — zeroing exaggeration
// itself to flatten the mesh would have silently flattened every normal to
// (0,0,1) too, wiping out all relief shading in 2D.
export const PROJECTION_AWARE_VERTEX_BODY = `
uniform vec4 u_tileBounds01;
uniform float u_exaggeration;
uniform bool u_drapeEnabled;
in vec2 a_uv;
in float a_elevation;
out vec2 v_texCoord;
void main() {
    vec2 posInTile = mix(u_tileBounds01.xy, u_tileBounds01.zw, a_uv);
    v_texCoord = a_uv;
    float z = u_drapeEnabled ? a_elevation * u_exaggeration : 0.0;
    gl_Position = projectTileFor3D(posInTile, z);
}
`
