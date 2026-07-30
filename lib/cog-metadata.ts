import { useEffect, useState } from "react"
import { getCogMetadata } from '@geomatico/maplibre-cog-protocol'

// The package exports getCogMetadata but not its return type — derive it instead
// of hand-duplicating the shape (images[].zoom/.isMask, scale, offset, noData),
// so a future geomatico upgrade can't silently drift out of sync with a stale copy.
export type CogMetadata = Awaited<ReturnType<typeof getCogMetadata>>

// "loading" and "error" used to collapse into the same `null` value — a caller
// couldn't tell a fetch that's still in flight apart from one that permanently
// failed (e.g. a server without CORS headers, seen in practice on a Spain/
// Andalucía COG endpoint), so a real failure looked identical to "still
// detecting…" forever instead of surfacing something actionable.
export type AsyncStatus = "idle" | "loading" | "error" | "ready"
export interface AsyncResource<T> {
    data: T | null
    status: AsyncStatus
}

export function useCogMetadata(cogUrl: string | null): AsyncResource<CogMetadata> {
    const [state, setState] = useState<AsyncResource<CogMetadata>>({ data: null, status: "idle" })
    useEffect(() => {
        // Without this reset, switching from a COG source to any other type (e.g. a
        // wms-raw IGN source) left `metadata` holding the PREVIOUS COG's bbox/zoom
        // images — callers that don't gate on some "isCogProtocol"-equivalent flag
        // would otherwise report that stale COG's zoom range as if it belonged to
        // the newly-selected (unrelated) source.
        if (!cogUrl) { setState({ data: null, status: "idle" }); return }
        let cancelled = false
        setState({ data: null, status: "loading" })
        getCogMetadata(cogUrl)
            .then((m) => { if (!cancelled) setState({ data: m, status: "ready" }) })
            .catch(() => { if (!cancelled) setState({ data: null, status: "error" }) })
        return () => { cancelled = true }
    }, [cogUrl])
    return state
}

// geomatico's zoomFromResolution (log2(earthCircumference / (256 * resolutionM)))
// is uncapped — a real sub-meter/cm-resolution COG (a drone DSM/ortho export is
// the common case for a *local* file) can estimate a "native" zoom well past
// MapLibre's hard z25 tile-coordinate limit. Requesting DEM tiles that deep for
// `map.setTerrain()`'s elevation sampling throws "z=27 outside of bounds...",
// which was also cascading into "Attempting to run(), but is already running"
// errors (an uncaught exception mid-render left maplibre's render loop in a
// broken state for the next frame). Clamp to 22 — the ceiling this app already
// treats as its practical max elsewhere (see e.g. client-export.ts's cog
// maxzoom fallback) and comfortably clear of the z25 hard limit.
export const MAX_SAFE_COG_ZOOM = 22

export interface CogResolution {
    /** Ground sample distance along each axis, in the file's CRS units (this app
     *  only supports EPSG:3857, so this is meters) — geomatico's own zoom is
     *  derived from resolution[0] (X) alone (see its read/math.js
     *  zoomFromResolution), so a non-square-pixel source (a stitched/anisotropic
     *  mosaic) would silently under- or over-report via that path alone. */
    gsdX: number
    gsdY: number
    meanGsd: number
}

// Reads the raw ModelPixelScale tag directly via geotiff.js — a second, independent
// open of the same file geomatico's own getCogMetadata above already parses, since
// geomatico's public API never surfaces the per-axis resolution vector it reads
// internally, only the already-collapsed (X-only) zoom estimate. Both range-read
// just the header/IFD, not the whole file, so this second open is cheap.
export function useCogResolution(cogUrl: string | null): AsyncResource<CogResolution> {
    const [state, setState] = useState<AsyncResource<CogResolution>>({ data: null, status: "idle" })
    useEffect(() => {
        if (!cogUrl) { setState({ data: null, status: "idle" }); return }
        let cancelled = false
        setState({ data: null, status: "loading" })
        import("geotiff").then(async ({ fromUrl }) => {
            const tiff = await fromUrl(cogUrl)
            const image = await tiff.getImage()
            // geotiff.js negates the Y component (raw ModelPixelScale is a
            // downward-positive row pitch) — abs() to get a plain ground distance.
            const [resX, resY] = image.getResolution()
            const gsdX = Math.abs(resX)
            const gsdY = Math.abs(resY)
            if (!cancelled) setState({ data: { gsdX, gsdY, meanGsd: (gsdX + gsdY) / 2 }, status: "ready" })
        }).catch(() => { if (!cancelled) setState({ data: null, status: "error" }) })
        return () => { cancelled = true }
    }, [cogUrl])
    return state
}

// Adaptive precision: sub-meter GSD (the common case for a drone/aerial COG)
// needs decimals to be meaningful, but a low-res source is more readable rounded.
export function formatGsd(meters: number): string {
    const decimals = meters < 1 ? 2 : meters < 10 ? 1 : 0
    return `${meters.toFixed(decimals)} m`
}

export function zoomRangeFromMetadata(metadata: CogMetadata | null): { minzoom: number; maxzoom: number } {
    if (!metadata?.images?.length) return { minzoom: 0, maxzoom: 20 }
    const zooms = metadata.images.filter(img => !img.isMask).map(img => img.zoom)
    // Both bounds are clamped into the SAME [0, MAX_SAFE_COG_ZOOM] range (not just
    // maxzoom from above) — a single-resolution-level COG (common for a local,
    // un-tiled export) has minzoom === maxzoom === that one estimate, so clamping
    // only maxzoom downward while leaving an over-22 minzoom unclamped produced
    // an inverted minzoom > maxzoom range, which maplibre's setMinZoom/setMaxZoom
    // then rejected outright ("minZoom must be between -2 and the current maxZoom").
    //
    // maxzoom specifically floors rather than rounds: zoomFromResolution gives a
    // fractional estimate (e.g. z13.7), and rounding that UP to 14 tells maplibre
    // "this source has clean z14 detail" when the real native resolution is closer
    // to z13 — the protocol then has to upsample past what the data actually
    // supports at every z14 request, which shows up as visible tile-grid/pixel-
    // border artifacts (confirmed against a real custom COG source) rather than
    // the harmless uniform blur of overzooming past a correctly-conservative
    // maxzoom. minzoom isn't as sensitive (it only governs how far out the same
    // pyramid is queried) but floors too for consistency.
    const clamp = (z: number) => Math.max(0, Math.min(MAX_SAFE_COG_ZOOM, Math.floor(z)))
    return {
        minzoom: clamp(Math.min(...zooms)),
        maxzoom: clamp(Math.max(...zooms)),
    }
}
