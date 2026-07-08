// Shared elevation <-> RGBA packing helpers, factored out of MapSources.tsx so that
// non-component modules (e.g. lib/slope-protocol.ts) can reuse them without importing
// a "use client" react-map-gl component file.
// Inspired by https://github.com/geomatico/maplibre-cog-protocol/blob/main/src/render/renderTerrain.ts

export function elevationToTerrainrgb(elevation: number): [number, number, number, number] {
  const base = -10000
  const interval = 0.1
  const v = (elevation - base) / interval
  return [
    Math.floor(v / 256 / 256) % 256,
    Math.floor(v / 256) % 256,
    Math.floor(v) % 256,
    255,
  ]
}

export function elevationToTerrarium(elevation: number): [number, number, number, number] {
  const v = elevation + 32768
  return [
    Math.floor(v / 256),
    Math.floor(v % 256),
    Math.floor((v - Math.floor(v)) * 256),
    255,
  ]
}
