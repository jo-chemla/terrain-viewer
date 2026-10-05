import { useEffect } from "react"
import { atom, useAtom, useSetAtom } from "jotai"
import customSources from "./custom-sources.json"
import { allmapsMeta, ALLMAPS_API } from "./coverage-overlays"
import { QMS_API, qmsDetailToBasemap, type QmsDetail } from "./qms"
import { eliLayerAsBasemap } from "./eli-timeline"
import { catalogPickRequestAtom } from "./timeline-catalogs"
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
  : overlay.startsWith("blib:") || overlay.startsWith("basemap:") || overlay.startsWith("eli:") || overlay.startsWith("allmaps:") || overlay.startsWith("qms:") || overlay.startsWith("catalog:") ? "basemap"
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
  const setCatalogPick = useSetAtom(catalogPickRequestAtom)

  useEffect(() => {
    if (!request) return
    setRequest(null)
    const { overlay } = request
    const [kind, ...rest] = overlay.split(":")
    const key = rest.join(":")

    if (overlay === "mapterhorn") { setState({ sourceA: "mapterhorn" }); return }
    // A historical catalog item (its footprint on the map): the timeline
    // panel holds the tick and puts it on the view.
    if (kind === "catalog") { setCatalogPick({ ref: key, nonce: Date.now() }); return }
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
    if (kind === "qms") {
      ;(async () => {
        const res = await fetch(`${QMS_API}${key}/`)
        if (!res.ok) throw new Error(`QMS service ${key}: ${res.status}`)
        const detail = (await res.json()) as QmsDetail
        const id = `custom-basemap-qms-${key}`
        const source: CustomBasemapSource = { id, ...qmsDetailToBasemap(detail), role: "basemap" }
        setBasemaps((prev) => (prev.some((x) => x.id === id) ? prev : [...prev, source]))
        activateBasemapSource(setState, source)
      })().catch((e) => console.error("[coverage] Use as basemap (QMS) failed:", e))
      return
    }
    if (kind === "allmaps") {
      // A georeferenced IIIF map: the annotation URL is the source, drawn by
      // Allmaps' warped layer (AllmapsOverlayLayer.tsx); always an overlay.
      const meta = allmapsMeta(key)
      const id = `custom-basemap-allmaps-${key}`
      const source: CustomBasemapSource = {
        id, name: meta?.label ?? `Allmaps map ${key}`, url: `${ALLMAPS_API}/maps/${key}`, type: "iiif", role: "overlay", stack: "top",
        description: `Georeferenced IIIF map, Allmaps annotation ${key}${meta ? ` · ${meta.detail}` : ""}`,
        infoUrl: meta?.pageUrl ?? `https://viewer.allmaps.org/?url=${encodeURIComponent(`${ALLMAPS_API}/maps/${key}`)}`, provider: "allmaps",
        bounds: meta?.bounds,
      }
      setBasemaps((prev) => (prev.some((x) => x.id === id) ? prev : [...prev, source]))
      activateBasemapSource(setState, source)
      return
    }
    if (kind === "eli") {
      eliLayerAsBasemap(key)
        .then((source) => {
          setBasemaps((prev) => (prev.some((x) => x.id === source.id) ? prev : [...prev, source]))
          activateBasemapSource(setState, source)
        })
        .catch((e) => console.error("[coverage] Use as basemap failed:", e))
    }
  }, [request, setRequest, setState, setTerrains, basemaps, setBasemaps, setCatalogPick])
}
