import { useEffect } from "react"
import { atom, useAtom, useSetAtom } from "jotai"
import customSources from "./custom-sources.json"
import { customTerrainSourcesAtom, customBasemapSourcesAtom, type CustomTerrainSource, type CustomBasemapSource } from "./settings-atoms"

/**
 * "Use this source for view A" from the coverage click modal (see
 * CoverageOverlayLayer). The modal lives inside a map view with no access to
 * the URL state, so it posts a request here and the control panel, which
 * owns setState, applies it: library entries are added to the BYOD list
 * first, Editor Layer Index layers are turned into a basemap the same way
 * the ELI search panel does, then the view-A field is pointed at the id.
 */
export const coverageUseRequestAtom = atom<{ overlay: string; nonce: number } | null>(null)

/** Which side of the app an overlay id selects. */
export const coverageUseKind = (overlay: string): "terrain" | "basemap" | null =>
  overlay === "mapterhorn" || overlay.startsWith("lib:") || overlay.startsWith("terrain:") ? "terrain"
  : overlay.startsWith("blib:") || overlay.startsWith("basemap:") || overlay.startsWith("eli:") ? "basemap"
  : null

export function useCoverageUseRequest(setState: (updates: Record<string, unknown>) => void) {
  const [request, setRequest] = useAtom(coverageUseRequestAtom)
  const setTerrains = useSetAtom(customTerrainSourcesAtom)
  const setBasemaps = useSetAtom(customBasemapSourcesAtom)

  useEffect(() => {
    if (!request) return
    setRequest(null)
    const { overlay } = request
    const [kind, ...rest] = overlay.split(":")
    const key = rest.join(":")
    const selectBasemap = (id: string) => setState({ basemapSource: id, basemapSourceA: id, showRasterBasemap: true })

    if (overlay === "mapterhorn") { setState({ sourceA: "mapterhorn" }); return }
    if (kind === "terrain") { setState({ sourceA: key }); return }
    if (kind === "basemap") { selectBasemap(key); return }
    if (kind === "lib") {
      const s = (customSources.SAMPLE_TERRAIN_SOURCES as CustomTerrainSource[]).find((x) => x.id === key)
      if (!s) return
      setTerrains((prev) => (prev.some((x) => x.id === key) ? prev : [...prev, s]))
      setState({ sourceA: key })
      return
    }
    if (kind === "blib") {
      const s = (customSources.SAMPLE_BASEMAPS_SOURCES as CustomBasemapSource[]).find((x) => x.id === key)
      if (!s) return
      setBasemaps((prev) => (prev.some((x) => x.id === key) ? prev : [...prev, s]))
      selectBasemap(key)
      return
    }
    if (kind === "eli") {
      ;(async () => {
        const eli = await import("@osm-editor-kit/maplibre-editor-layer-index")
        const layer = await eli.getLayerHydrated(key)
        if (!layer) return
        const spec = eli.getRasterSourceSpec(layer)
        if (!spec.tiles.length) return
        const id = `custom-basemap-eli-${key}`
        const source: CustomBasemapSource = {
          id, name: layer.name, url: spec.tiles[0], type: "tms", scheme: spec.scheme ?? "xyz",
          minzoom: spec.minzoom, maxzoom: spec.maxzoom, role: layer.overlay ? "overlay" : "basemap",
          description: `OSM Editor Layer Index id ${layer.id}`,
          attribution: layer.attributionText || undefined, licenseUrl: layer.licenseUrl || undefined,
          infoUrl: layer.attributionUrl || "https://osm-editor-kit.github.io/maplibre-editor-layer-index/", provider: "eli",
        }
        setBasemaps((prev) => (prev.some((x) => x.id === id) ? prev : [...prev, source]))
        selectBasemap(id)
      })().catch(() => {})
    }
  }, [request, setRequest, setState, setTerrains, setBasemaps])
}
