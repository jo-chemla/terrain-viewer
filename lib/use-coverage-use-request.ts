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

/** Overlay-role sources stack on the active basemap (overlayBasemapIds)
 *  instead of replacing it: selecting one as the basemap would point the
 *  picker at an id its list does not contain and look like nothing happened. */
export function activateBasemapSource(
  setState: (updates: Record<string, unknown> | ((prev: Record<string, any>) => Record<string, unknown>)) => void,
  source: Pick<CustomBasemapSource, "id" | "role">,
) {
  if (source.role === "overlay") {
    setState((prev) => {
      const ids: string[] = prev.overlayBasemapIds ?? []
      return { overlayBasemapIds: ids.includes(source.id) ? ids : [...ids, source.id], showRasterBasemap: true }
    })
  } else {
    setState({ basemapSource: source.id, basemapSourceA: source.id, showRasterBasemap: true })
  }
}

export function useCoverageUseRequest(setState: (updates: Record<string, unknown> | ((prev: Record<string, any>) => Record<string, unknown>)) => void) {
  const [request, setRequest] = useAtom(coverageUseRequestAtom)
  const setTerrains = useSetAtom(customTerrainSourcesAtom)
  const [basemaps, setBasemaps] = useAtom(customBasemapSourcesAtom)

  useEffect(() => {
    if (!request) return
    setRequest(null)
    const { overlay } = request
    const [kind, ...rest] = overlay.split(":")
    const key = rest.join(":")

    if (overlay === "mapterhorn") { setState({ sourceA: "mapterhorn" }); return }
    if (kind === "terrain") { setState({ sourceA: key }); return }
    if (kind === "basemap") {
      // Built-in ids (esri, google, ...) are not in the custom list: plain basemaps.
      activateBasemapSource(setState, basemaps.find((x) => x.id === key) ?? { id: key })
      return
    }
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
      activateBasemapSource(setState, s)
      return
    }
    if (kind === "eli") {
      ;(async () => {
        const eli = await import("@osm-editor-kit/maplibre-editor-layer-index")
        const layer = await eli.getLayerHydrated(key)
        if (!layer) throw new Error(`ELI layer ${key}: tile URLs could not be loaded`)
        // The search panel disables these; here the modal already hides the
        // button (see CoverageOverlayLayer), so this is only a backstop.
        if (layer.requiresKeys.length > 0) throw new Error(`ELI layer ${key} needs an API key (${layer.requiresKeys.join(", ")})`)
        const spec = eli.getRasterSourceSpec(layer)
        if (!spec.tiles.length) throw new Error(`ELI layer ${key} has no tile URL`)
        const id = `custom-basemap-eli-${key}`
        const source: CustomBasemapSource = {
          id, name: layer.name, url: spec.tiles[0], type: "tms", scheme: spec.scheme ?? "xyz",
          minzoom: spec.minzoom, maxzoom: spec.maxzoom, role: layer.overlay ? "overlay" : "basemap",
          description: `OSM Editor Layer Index id ${layer.id}`,
          attribution: layer.attributionText || undefined, licenseUrl: layer.licenseUrl || undefined,
          infoUrl: layer.attributionUrl || "https://osm-editor-kit.github.io/maplibre-editor-layer-index/", provider: "eli",
        }
        setBasemaps((prev) => (prev.some((x) => x.id === id) ? prev : [...prev, source]))
        activateBasemapSource(setState, source)
      })().catch((e) => console.error("[coverage] Use as basemap failed:", e))
    }
  }, [request, setRequest, setState, setTerrains, basemaps, setBasemaps])
}
