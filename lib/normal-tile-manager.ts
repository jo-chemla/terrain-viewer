// Shared tile management for the "normal-map driven" custom WebGL layers
// (lib/matcap-gl-layer.ts, lib/phong-gl-layer.ts) — both need the exact same
// thing (fetch normals + an elevation grid for whatever's currently visible,
// build a terrain-following mesh per tile, keep it all as GL resources,
// evict/queue sanely) and differ only in what they DO with it once drawn (a
// matcap sphere lookup vs a Phong light calculation), so this is pulled out
// once instead of being copy-pasted between the two layer classes.
//
// This is the SECOND time this module has existed: an earlier version this
// session was deleted in favor of making Matcap/Phong plain `raster` tile
// sources/layers (see lib/matcap-protocol.ts / lib/phong-protocol.ts on
// main), since that let MapLibre's terrain renderer drape them automatically
// with no custom mesh at all. That works, but bakes every light-direction/
// rotation/diffuse/specular change into the tile's own pixels — meaning
// changing any of those re-fetches and recomputes every visible tile, which
// cannot keep up with a live-dragged light-direction pad or rotation slider
// the way MapLibre's own hillshade shader (a pure GPU uniform update) can.
// This version keeps the tile-fetch/mesh-building piece (still needed for
// draping, and still exactly this expensive) but moves the actual shading
// back into a live fragment-shader uniform, so only PANNING TO A NEW TILE
// costs anything — dragging light direction or rotation is now just a
// uniform update + repaint, as fast as MapLibre's own shader.
//
// Normal-map texture upload skips the PNG entirely this time: normals-
// protocol.ts's computeNormalPixels() already returns raw RGBA bytes (GPU-
// computed, see gpu-normal-compute.ts), which get handed straight to
// gl.texImage2D — no encode-to-PNG-then-decode-back-to-pixels round trip
// the old (pre-refactor) custom layer and the current raster-tile protocols
// both still pay for.
//
// Mesh, not a flat quad: each tile is a GRID_SIZE x GRID_SIZE grid of
// terrain-following vertices (not 2 flat triangles) — the whole point of
// draping is that the surface bends to match the DEM, which a single flat
// quad per tile can't do regardless of what depth value its corners get.
// Vertex data is split into a SHARED (u, v) buffer + index buffer (built
// once — the grid topology is identical for every tile) and a PER-TILE
// elevation buffer (real meters, tiny — (GRID_SIZE+1)^2 floats) uploaded once
// per tile fetch; a layer's vertex shader combines them with live
// exaggeration/pixelPerMeter uniforms, so panning/zooming or changing
// exaggeration never needs re-fetching or rebuilding any tile's geometry.
import type maplibregl from "maplibre-gl"
import { lngLatToTile } from "./source-provenance"
import { computeNormalPixels } from "./normals-protocol"
import { bilinearSamplePadded, type UpstreamEncoding } from "./normal-derived-protocol"

export interface NormalTileManagerOptions {
  upstreamTemplate: string
  encoding: UpstreamEncoding
  tileSize: number
  maxzoom: number
}

export interface NormalTileEntry {
  texture: WebGLTexture
  elevationBuffer: WebGLBuffer
  z: number
  x: number
  y: number
}

const MAX_TILE_TEXTURES = 256
/** Quads per tile edge — 33x33 vertices, 2048 triangles. Smooth enough for
 *  typical terrain at the zooms this renders at without per-pixel vertex
 *  density (which the *shading*, not the mesh, is responsible for). */
export const GRID_SIZE = 32

export class NormalTileManager {
  private opts: NormalTileManagerOptions
  private map: maplibregl.Map | null = null
  private gl: WebGL2RenderingContext | null = null
  private readonly onTileLoaded: () => void

  private tileTextures = new Map<string, NormalTileEntry>()
  private pendingFetches = new Set<string>()
  private visibleKeys = new Set<string>()
  private fetchQueue: Array<{ z: number; x: number; y: number; key: string }> = []
  private activeFetchCount = 0
  private static readonly MAX_CONCURRENT_FETCHES = 4

  // Shared across every tile — same (u, v) grid topology regardless of which
  // tile is being drawn, so this is built once in attach() rather than per tile.
  private uvBuffer: WebGLBuffer | null = null
  private indexBuffer: WebGLBuffer | null = null
  private indexCount = 0

  constructor(opts: NormalTileManagerOptions, onTileLoaded: () => void) {
    this.opts = opts
    this.onTileLoaded = onTileLoaded
  }

  attach(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map
    this.gl = gl
    this.buildSharedGridGeometry(gl)
    map.on("move", this.handleViewChange)
    map.on("zoom", this.handleViewChange)
    this.updateVisibleTiles()
  }

  detach() {
    this.map?.off("move", this.handleViewChange)
    this.map?.off("zoom", this.handleViewChange)
    const gl = this.gl
    if (gl) {
      for (const entry of this.tileTextures.values()) {
        gl.deleteTexture(entry.texture)
        gl.deleteBuffer(entry.elevationBuffer)
      }
      if (this.uvBuffer) gl.deleteBuffer(this.uvBuffer)
      if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer)
    }
    this.tileTextures.clear()
    this.pendingFetches.clear()
    this.fetchQueue = []
    this.uvBuffer = null
    this.indexBuffer = null
    this.map = null
    this.gl = null
  }

  /** Re-fetches everything if the upstream DEM identity actually changed. */
  updateOptions(next: Partial<NormalTileManagerOptions>) {
    const upstreamChanged =
      (next.upstreamTemplate !== undefined && next.upstreamTemplate !== this.opts.upstreamTemplate) ||
      (next.encoding !== undefined && next.encoding !== this.opts.encoding) ||
      (next.tileSize !== undefined && next.tileSize !== this.opts.tileSize)
    this.opts = { ...this.opts, ...next }
    if (!upstreamChanged) return
    const gl = this.gl
    if (gl) for (const entry of this.tileTextures.values()) {
      gl.deleteTexture(entry.texture)
      gl.deleteBuffer(entry.elevationBuffer)
    }
    this.tileTextures.clear()
    this.pendingFetches.clear()
    this.fetchQueue = []
    this.updateVisibleTiles()
  }

  /** Every currently-visible tile's mesh resources — safe to call from render(). */
  getVisibleTiles(): NormalTileEntry[] {
    const out: NormalTileEntry[] = []
    for (const entry of this.tileTextures.values()) {
      if (this.visibleKeys.has(`${entry.z}/${entry.x}/${entry.y}`)) out.push(entry)
    }
    return out
  }

  getUvBuffer(): WebGLBuffer | null { return this.uvBuffer }
  getIndexBuffer(): WebGLBuffer | null { return this.indexBuffer }
  getIndexCount(): number { return this.indexCount }

  private buildSharedGridGeometry(gl: WebGL2RenderingContext) {
    const n = GRID_SIZE
    const verts = (n + 1) * (n + 1)
    const uv = new Float32Array(verts * 2)
    let vi = 0
    for (let gy = 0; gy <= n; gy++) {
      for (let gx = 0; gx <= n; gx++) {
        uv[vi++] = gx / n
        uv[vi++] = gy / n
      }
    }
    this.uvBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW)

    const indices = new Uint16Array(n * n * 6)
    let ii = 0
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const i0 = gy * (n + 1) + gx
        const i1 = i0 + 1
        const i2 = i0 + (n + 1)
        const i3 = i2 + 1
        indices[ii++] = i0; indices[ii++] = i2; indices[ii++] = i1
        indices[ii++] = i1; indices[ii++] = i2; indices[ii++] = i3
      }
    }
    this.indexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
    this.indexCount = indices.length
  }

  private handleViewChange = () => this.updateVisibleTiles()

  private updateVisibleTiles() {
    const map = this.map
    if (!map) return
    const zoom = Math.min(Math.max(Math.floor(map.getZoom()), 0), this.opts.maxzoom)
    const n = 1 << zoom
    const bounds = map.getBounds()
    const nw = lngLatToTile(bounds.getWest(), bounds.getNorth(), zoom)
    const se = lngLatToTile(bounds.getEast(), bounds.getSouth(), zoom)

    const visible = new Set<string>()
    for (let ty = nw.y; ty <= se.y; ty++) {
      if (ty < 0 || ty >= n) continue
      for (let tx = nw.x; tx <= se.x; tx++) {
        const wrappedX = ((tx % n) + n) % n
        const key = `${zoom}/${wrappedX}/${ty}`
        visible.add(key)
        if (!this.tileTextures.has(key) && !this.pendingFetches.has(key)) {
          // Marked pending immediately (not just when the fetch actually
          // starts) so a tile already sitting in the queue isn't enqueued
          // a second time by the next 'move' tick before its turn comes up.
          this.pendingFetches.add(key)
          this.fetchQueue.push({ z: zoom, x: wrappedX, y: ty, key })
        }
      }
    }
    this.visibleKeys = visible
    this.processFetchQueue()
  }

  private processFetchQueue() {
    while (this.activeFetchCount < NormalTileManager.MAX_CONCURRENT_FETCHES && this.fetchQueue.length > 0) {
      const next = this.fetchQueue.shift()!
      if (!this.visibleKeys.has(next.key)) {
        // Panned/zoomed past before its turn came up — never fetched, no
        // point paying for it now.
        this.pendingFetches.delete(next.key)
        continue
      }
      this.activeFetchCount++
      this.fetchTile(next.z, next.x, next.y, next.key).finally(() => {
        this.activeFetchCount--
        this.processFetchQueue()
      })
    }
  }

  private async fetchTile(z: number, x: number, y: number, key: string) {
    try {
      const abortController = new AbortController()
      const { pixels, grid } = await computeNormalPixels(
        this.opts.upstreamTemplate, this.opts.encoding, z, x, y, this.opts.tileSize, abortController.signal,
      )

      const gl = this.gl
      if (!gl) return // manager was detached while this fetch was in flight

      // Straight to a texture — pixels is already RGBA bytes (GPU-computed,
      // see gpu-normal-compute.ts), no PNG encode/decode round trip needed
      // since we're already in a live GL context on the main thread.
      const texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, this.opts.tileSize, this.opts.tileSize, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, pixels,
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

      // Mesh elevation — same padded elevation grid the normal computation
      // itself used, resampled at the (coarser) mesh resolution. A terrain
      // MESH doesn't need per-pixel density the way the *shading* does to
      // look smooth.
      const elevations = new Float32Array((GRID_SIZE + 1) * (GRID_SIZE + 1))
      for (let gy = 0; gy <= GRID_SIZE; gy++) {
        const py = (gy / GRID_SIZE) * this.opts.tileSize
        for (let gx = 0; gx <= GRID_SIZE; gx++) {
          const px = (gx / GRID_SIZE) * this.opts.tileSize
          elevations[gy * (GRID_SIZE + 1) + gx] = bilinearSamplePadded(grid, px, py)
        }
      }
      const elevationBuffer = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, elevationBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, elevations, gl.STATIC_DRAW)

      if (this.tileTextures.size >= MAX_TILE_TEXTURES) {
        const oldestKey = this.tileTextures.keys().next().value
        if (oldestKey !== undefined) {
          const oldest = this.tileTextures.get(oldestKey)!
          gl.deleteTexture(oldest.texture)
          gl.deleteBuffer(oldest.elevationBuffer)
          this.tileTextures.delete(oldestKey)
        }
      }
      this.tileTextures.set(key, { texture, elevationBuffer, z, x, y })
      this.onTileLoaded()
    } catch (e) {
      console.error("[NormalTileManager] failed to fetch normal tile", key, e)
    } finally {
      this.pendingFetches.delete(key)
    }
  }
}
