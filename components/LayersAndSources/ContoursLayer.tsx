"use client"

import { useEffect, useRef, useCallback } from "react"
import { useMap, Layer } from "react-map-gl/maplibre"
import type { LayerSpecification } from "react-map-gl/maplibre"
import maplibregl from "maplibre-gl"
import mlcontour from "maplibre-contour"
import { terrainSources } from "@/lib/terrain-sources"
import type { TerrainSource } from "@/lib/terrain-types"
import type { CustomTerrainSource } from "@/lib/settings-atoms"
import { resolveLocalFileUrl, localFileId, localFileVersionAtom } from "@/lib/local-file-store"
import { buildCogContourUrl } from "@/lib/cog-contour-protocol"
import { useAtomValue } from "jotai"
import {LAYER_SLOTS} from "./MapLayers"

// ─── Layer definitions (moved here from MapLayers.tsx) ───────────────────────

export const contourLinesLayerDef = (
  showContours: boolean,
  theme: string,
  // Multiplies both major (1px) and minor (0.5px) widths, keeping their ratio —
  // 1 is today's default, 2/4 make both proportionally bolder.
  weight: number = 1,
  // Explicit contour color (from the color picker). Empty/undefined falls back to
  // the theme-adaptive translucent black/white default.
  contourColor?: string,
): LayerSpecification => ({
  id: "contour-lines",
  type: "line",
  source: "contour-source",
  "source-layer": "contours",
  paint: {
    "line-color":
      contourColor || (theme === "light" ? "rgba(0,0,0, 50%)" : "rgba(255,255,255, 50%)"),
    "line-width": ["match", ["get", "level"], 1, weight, 0.5 * weight],
  },
  layout: {
    visibility: showContours ? "visible" : "none",
  },
})

export const contourLabelsLayerDef = (
  showContours: boolean,
  theme: string,
): LayerSpecification => ({
  id: "contour-labels",
  type: "symbol",
  source: "contour-source",
  "source-layer": "contours",
  filter: [">", ["get", "level"], 0],
  paint: {
    "text-halo-color": theme === "light" ? "#ffffff" : "#000000",
    "text-halo-width": 1,
    "text-color": theme === "light" ? "#000000" : "#ffffff",
  },
  layout: {
    "symbol-placement": "line",
    "text-size": 10,
    "text-field": ["concat", ["number-format", ["get", "ele"], {}], "m"],
    "text-font": ["Noto Sans Bold"],
    visibility: showContours ? "visible" : "none",
  },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function removeLayers(map: maplibregl.Map | undefined | null) {
  // `map` itself can be a live (non-null) object whose internal `.style` has
  // already been torn down by `map.remove()` — react-map-gl's own Map cleanup
  // runs in the same unmount pass as this component's, and effect cleanup
  // order across sibling/parent components isn't guaranteed, so this can race
  // in either direction (most visible when switching rapidly between BYOD
  // sources, e.g. testing several local COG files back to back). getLayer/
  // getSource dereference map.style internally and throw "Cannot read
  // properties of undefined" rather than returning null in that state, so a
  // truthy `map` check alone isn't enough — swallow the race instead of
  // crashing the whole map tree over an unmount that's already in progress.
  if (!map) return
  try {
    if (map.getLayer("contour-labels")) map.removeLayer("contour-labels")
    if (map.getLayer("contour-lines")) map.removeLayer("contour-lines")
    if (map.getSource("contour-source")) map.removeSource("contour-source")
  } catch {
    // Map already torn down — nothing left to clean up.
  }
}

function buildTileUrl(
  sourceId: string,
  customTerrainSources: CustomTerrainSource[],
  titilerEndpoint: string,
  mapboxKey: string,
  maptilerKey: string,
): { tileUrl: string; encoding: string; maxzoom: number } | null {
  const customSource = customTerrainSources.find((s) => s.id === sourceId)

  if (customSource) {
    if (customSource.type === "cog-local") {
      // Not handled here — maplibre-contour's DemSource does its own raw
      // fetch(url) for every tile (see defaultGetTile in maplibre-contour), which
      // never goes through maplibregl.addProtocol and so can't resolve a
      // `local://<id>` placeholder (or a blob: URL, which a worker thread can't
      // dereference back to this tab's in-memory File either way). Instead this
      // is handled by a separate path (see initCogLocalContourSource below) that
      // reuses @geomatico/maplibre-cog-protocol's own COG reader directly inside
      // a dedicated worker — see lib/cog-contour-worker.ts for the full story.
      return null
    }
    if (customSource.type === "cog") {
      return {
        tileUrl: `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=0&resampling=bilinear&algorithm=terrainrgb&url=${encodeURIComponent(customSource.url)}`,
        encoding: "mapbox",
        maxzoom: 14,
      }
    }
    if (customSource.type === "wms-raw") {
      // Needs the float32dem:// protocol prefix (registered in TerrainViewer.tsx) the
      // same way MapSources.tsx's cogTileUrl does — without it maplibre-contour would
      // fetch the raw WMS response as an ordinary image tile instead of routing it
      // through float32demProtocol's GeoTIFF decode. Re-encoded as Terrarium (see
      // float32dem-protocol.ts) for its ~4mm vs Terrain-RGB's 10cm precision.
      return {
        tileUrl: `float32dem://${customSource.url.replace(/^https?:\/\//, "")}`,
        encoding: "terrarium",
        maxzoom: 14,
      }
    }
    return {
      tileUrl: customSource.url,
      encoding: customSource.type === "terrarium" ? "terrarium" : "mapbox",
      maxzoom: 14,
    }
  }

  const source = (terrainSources as any)[sourceId as TerrainSource]
  if (!source?.sourceConfig?.tiles?.[0]) return null

  let tileUrl: string = source.sourceConfig.tiles[0]
  if (sourceId === "mapbox") tileUrl = tileUrl.replace("{API_KEY}", mapboxKey || "")
  else if (sourceId === "maptiler") tileUrl = tileUrl.replace("{API_KEY}", maptilerKey || "")

  return {
    tileUrl,
    encoding: source.encoding === "terrainrgb" ? "mapbox" : "terrarium",
    maxzoom: source.sourceConfig.maxzoom || 14,
  }
}

function buildThresholds(minor: number, major: number) {
  return {
    // low zoom: only major contours (level 0)
    2:  [major],
    // mid zoom: major (level 1) and minor (level 0)  
    10: [minor, major],
  };
}


function buildContourProtocolUrl(
  demSource: any,
  contourMinor: number,
  contourMajor: number,
): string {
  return demSource.contourProtocolUrl({
    multiplier: 1,
    // thresholds: {
    //   11: [contourMajor, contourMajor * 5],
    //   12: [contourMinor, contourMajor],
    //   14: [contourMinor / 2, contourMajor],
    //   15: [contourMinor / 5, contourMinor],
    // },
    thresholds: buildThresholds(contourMinor, contourMajor),

    contourLayer: "contours",
    elevationKey: "ele",
    levelKey: "level",
    extent: 4096,
    buffer: 1,
    overzoom: 1,
  })
}

// Same options as buildContourProtocolUrl above, just routed through the
// cog-contour:// protocol (lib/cog-contour-protocol.ts) instead of an
// mlcontour.DemSource instance — see its header comment for why "cog-local"
// needs its own path entirely.
function buildCogLocalContourUrl(blobUrl: string, contourMinor: number, contourMajor: number): string {
  return buildCogContourUrl(blobUrl, {
    multiplier: 1,
    thresholds: buildThresholds(contourMinor, contourMajor),
    contourLayer: "contours",
    elevationKey: "ele",
    levelKey: "level",
    extent: 4096,
    buffer: 1,
    overzoom: 1,
  })
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ContoursLayerProps {
  /** Whether the overall contours feature is toggled on */
  showContours: boolean
  /** Whether contour labels are visible */
  showContourLabels: boolean
  /** Active terrain source id — used to build tile URLs */
  sourceId: string
  contourMinor: number
  contourMajor: number
  contourWeight: number
  /** Explicit contour line color; empty/undefined = theme-adaptive default. */
  contourColor?: string
  /** Passed through to tile URL resolution */
  mapboxKey: string
  maptilerKey: string
  customTerrainSources: CustomTerrainSource[]
  titilerEndpoint: string
  /** Set to true once the parent map has fired its `load` event */
  mapLoaded: boolean
  theme: string
}

// ─── Component ────────────────────────────────────────────────────────────────

const MAX_INIT_ATTEMPTS = 5

export function ContoursLayer({
  showContours,
  showContourLabels,
  sourceId,
  contourMinor,
  contourMajor,
  contourWeight,
  contourColor,
  mapboxKey,
  maptilerKey,
  customTerrainSources,
  titilerEndpoint,
  mapLoaded,
  theme,
}: ContoursLayerProps) {
  const { current: mapRef } = useMap()

  const demSourceRef = useRef<any>(null)
  const initializedRef = useRef(false)
  const initAttemptsRef = useRef(0)

  // Track latest thresholds so the threshold-update effect can read them without
  // being listed as a dep of the init effect.
  const thresholdsRef = useRef({ contourMinor, contourMajor })
  thresholdsRef.current = { contourMinor, contourMajor }

  // Whether the shared ordering-slot marker layer (LayerOrderSlots in
  // MapLayers.tsx) has actually committed to the map style yet. The <Layer>
  // elements below pass beforeId={LAYER_SLOTS.CONTOURS}, and react-map-gl
  // mounts <Layer> in JSX/effect order — but that doesn't guarantee
  // LayerOrderSlots' own sibling effect has run first, so on a fresh load
  // this raced and threw "Cannot add layer 'contour-lines' before
  // non-existing layer 'slot-contours'". Same race MatcapLayer.tsx/
  // PhongLayer.tsx hit with their own imperative addLayer calls, fixed there
  // with an rAF poll before calling addLayer directly; mirrored here for the
  // declarative case by simply not rendering the <Layer>s until the
  // precondition is actually met.
  const [slotReady, setSlotReady] = useState(false)
  useEffect(() => {
    if (!mapRef) return
    const map = mapRef.getMap()
    if (!map) return
    let cancelled = false
    let rafId: number | null = null
    const poll = () => {
      if (cancelled) return
      if (map.getLayer(LAYER_SLOTS.CONTOURS)) {
        setSlotReady(true)
        return
      }
      rafId = requestAnimationFrame(poll)
    }
    poll()
    return () => {
      cancelled = true
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [mapRef])

  useEffect(() => {
    return () => {
      if (!mapRef) return
      const map = mapRef.getMap()
      if (!map) return  // Add this check
      removeLayers(map)
      demSourceRef.current = null
      initializedRef.current = false
    }
  }, [mapRef])

  // Whether the currently-initialized source went through the cog-local path
  // (no DemSource instance — see initCogLocalSource below) — read by the
  // threshold-update effect to know which URL builder to re-invoke.
  const isCogLocalRef = useRef(false)

  // A "cog-local" source's File only lives in this session's in-memory
  // local-file-store once (re-)picked or hydrated from OPFS — re-run init
  // whenever that happens, rather than waiting out the fixed retry schedule
  // below, so a slightly-delayed OPFS hydration doesn't need a few seconds to
  // be reflected here.
  const localFileVersion = useAtomValue(localFileVersionAtom)

  // ── Reset when terrain source (or a local file's availability) changes ─────
  useEffect(() => {
    initializedRef.current = false
    initAttemptsRef.current = 0
    demSourceRef.current = null
    isCogLocalRef.current = false
  }, [sourceId, localFileVersion])

  // ── Init: register DemSource (or the cog-local path) + add contour-source ──
  useEffect(() => {
    if (!mapRef || !mapLoaded) return
    if (initializedRef.current) return
    if (initAttemptsRef.current >= MAX_INIT_ATTEMPTS) return

    const map = mapRef.getMap()

    const tryInit = async () => {
      if (initializedRef.current) return
      if (initAttemptsRef.current >= MAX_INIT_ATTEMPTS) return

      initAttemptsRef.current += 1

      if (!map.isStyleLoaded()) {
        setTimeout(tryInit, 1000)
        return
      }

      const customSource = customTerrainSources.find((s) => s.id === sourceId)
      if (customSource?.type === "cog-local") {
        const blobUrl = resolveLocalFileUrl(localFileId(customSource.url))
        if (!blobUrl) {
          // File hasn't been (re-)picked/hydrated from OPFS yet this session —
          // transient, not a permanent "unsupported" state, so keep polling
          // within the normal retry budget (the localFileVersion effect above
          // also resets this the moment hydration actually completes).
          setTimeout(tryInit, 1000)
          return
        }

        removeLayers(map)
        const { contourMinor: minor, contourMajor: major } = thresholdsRef.current
        map.addSource("contour-source", {
          type: "vector",
          tiles: [buildCogLocalContourUrl(blobUrl, minor, major)],
          maxzoom: 15,
        })

        isCogLocalRef.current = true
        demSourceRef.current = null
        initializedRef.current = true
        forceUpdateRef.current?.()
        return
      }

      const resolved = buildTileUrl(
        sourceId,
        customTerrainSources,
        titilerEndpoint,
        mapboxKey,
        maptilerKey,
      )
      if (!resolved) {
        // Unsupported source type — permanent, not transient, so don't burn
        // through the retry budget polling for a style/tile-URL state that
        // will never resolve.
        initAttemptsRef.current = MAX_INIT_ATTEMPTS
        return
      }

      try {
        const DemSource =
          (mlcontour as any).DemSource ??
          (mlcontour as any).default?.DemSource ??
          mlcontour

        const dem = new DemSource({
          url: resolved.tileUrl,
          encoding: resolved.encoding,
          maxzoom: resolved.maxzoom,
          worker: true,
          cacheSize: 100,
          timeoutMs: 10000,
        })

        dem.setupMaplibre(maplibregl)
        demSourceRef.current = dem
        isCogLocalRef.current = false

        // Clean up any stale layers/source before adding fresh ones
        removeLayers(map)

        const { contourMinor: minor, contourMajor: major } = thresholdsRef.current

        map.addSource("contour-source", {
          type: "vector",
          tiles: [buildContourProtocolUrl(dem, minor, major)],
          maxzoom: 15,
        })

        // Layers are rendered declaratively via <Layer> below once initialized.
        initializedRef.current = true
        // Force a re-render so the Layer elements mount now that the source exists.
        // We do this by setting a piece of ref-free state — but since this component
        // intentionally avoids useState to prevent extra renders, we use a custom
        // trick: dispatch a no-op to trigger React reconciliation.
        // Actually the simplest approach: keep a tiny forceUpdate.
        forceUpdateRef.current?.()
      } catch (err) {
        console.error("[ContoursLayer] Init error:", err)
        if (initAttemptsRef.current < MAX_INIT_ATTEMPTS) {
          setTimeout(tryInit, 2000)
        }
      }
    }

    const timer = setTimeout(tryInit, 1000)
    return () => clearTimeout(timer)
  }, [mapLoaded, sourceId, mapboxKey, maptilerKey, customTerrainSources, titilerEndpoint, mapRef, localFileVersion])

  // ── Update thresholds when contourMinor/contourMajor change ───────────────
  useEffect(() => {
    if (!mapRef || !initializedRef.current) return
    if (!isCogLocalRef.current && !demSourceRef.current) return
    const map = mapRef.getMap()
    if (!map.isStyleLoaded()) return

    removeLayers(map)

    if (isCogLocalRef.current) {
      const customSource = customTerrainSources.find((s) => s.id === sourceId)
      const blobUrl = customSource?.type === "cog-local" ? resolveLocalFileUrl(localFileId(customSource.url)) : null
      if (!blobUrl) return
      map.addSource("contour-source", {
        type: "vector",
        tiles: [buildCogLocalContourUrl(blobUrl, contourMinor, contourMajor)],
        maxzoom: 15,
      })
    } else {
      map.addSource("contour-source", {
        type: "vector",
        tiles: [buildContourProtocolUrl(demSourceRef.current, contourMinor, contourMajor)],
        maxzoom: 15,
      })
    }

    // Re-add layers imperatively so they exist before the declarative <Layer>
    // elements re-mount (avoids a flash where source exists but layers don't).
    map.addLayer(contourLinesLayerDef(showContours, theme, contourWeight, contourColor) as any)
    map.addLayer(contourLabelsLayerDef(showContours && showContourLabels, theme) as any)
  }, [contourMinor, contourMajor]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (!mapRef) return
      const map = mapRef.getMap()
      removeLayers(map)
      demSourceRef.current = null
      initializedRef.current = false
    }
  }, [mapRef])

  // ── forceUpdate shim ───────────────────────────────────────────────────────
  // We need to trigger a re-render after async init so the <Layer> elements mount.
  const [, setTick] = useForceUpdate()
  const forceUpdateRef = useRef<(() => void) | null>(null)
  forceUpdateRef.current = () => setTick((n) => n + 1)

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!initializedRef.current || !slotReady) return null

  return (
    <>
      <Layer
        beforeId={LAYER_SLOTS.CONTOURS}
        {...contourLinesLayerDef(showContours, theme, contourWeight, contourColor)}
        key={"contour-lines-" + theme}
      />
      <Layer
        beforeId={LAYER_SLOTS.CONTOURS}
        {...contourLabelsLayerDef(showContours && showContourLabels, theme)}
        key={"contour-labels-" + theme}
      />
    </>
  )
}

// ─── Tiny hook to force re-render ─────────────────────────────────────────────
import { useState } from "react"
function useForceUpdate(): [number, React.Dispatch<React.SetStateAction<number>>] {
  return useState(0)
}