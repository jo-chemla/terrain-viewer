// Ready-to-copy addresses of the tile service (tile-server/), built from its
// base address: the desktop app's Settings > Desktop: local tile service
// lists them, and the service's own docs page (Scalar, /docs) can show the
// same list (tile-server/app-lib.ts re-exports it for Node). One list, so
// the two never disagree. Plain data, no React, no DOM.

export interface TileServiceQuickstartUrl {
  /** Short name, shown above the address. */
  label: string
  /** Where it goes: the client and how it reads it. */
  hint: string
  url: string
}

/** The service's base address for a port on this computer. */
export const tileServiceBase = (port: number): string => `http://localhost:${port}`

/** The quick-start addresses under a base address (no trailing slash needed). */
export function tileServiceQuickstart(base: string): TileServiceQuickstartUrl[] {
  const b = base.replace(/\/+$/, "")
  return [
    {
      label: "Slope, Mapterhorn (XYZ tiles)",
      hint: "QGIS XYZ Tiles, MapLibre raster source, any XYZ client",
      url: `${b}/terrain-tiles/{z}/{x}/{y}.png?modes=slope&terrainSource=mapterhorn`,
    },
    {
      label: "Sky-view factor, IGN LiDAR HD DTM (XYZ tiles, France)",
      hint: "QGIS XYZ Tiles, MapLibre raster source, any XYZ client",
      url: `${b}/terrain-tiles/{z}/{x}/{y}.png?modes=svf&terrainSource=custom-ign-lidarhd-dtm-wms-raw`,
    },
    {
      label: "Terrain mesh, Mapterhorn (quantized-mesh layer.json)",
      hint: "CesiumJS CesiumTerrainProvider, Blender terrain add-ons",
      url: `${b}/quantized-mesh/mapterhorn/layer.json`,
    },
  ]
}
