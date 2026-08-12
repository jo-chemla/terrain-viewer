// Sentinel-2 L2A "Natural color" mosaic, streamed live from Microsoft
// Planetary Computer's STAC-backed mosaic/tiler API (see lib/hls.ts's header
// for the closest existing analog — NASA titiler-cmr — and lib/eox-s2-
// cloudless.ts for the other existing Sentinel-2 source). Unlike HLS (which
// harmonizes Sentinel-2 down to Landsat's 30m grid, the reason it renders
// soft) this hits Sentinel-2's own native 10m COGs directly; unlike EOX
// (one fixed annual composite) each tick here is its own registered STAC
// search over a real quarterly window, so it's actually date-filterable.
// No auth: Planetary Computer's Data API serves this collection anonymously
// (confirmed live 2026-08-12 — POST .../mosaic/register and a subsequent
// tile fetch both return 200 with no key or header at all); a subscription
// key would only raise rate limits, not required to render.
import { useEffect, useMemo, useState } from "react"

const PC_DATA_API = "https://planetarycomputer.microsoft.com/api/data/v1"
const PC_COLLECTION = "sentinel-2-l2a"

// Verbatim from the collection's own published render preset (GET
// .../mosaic/info?collection=sentinel-2-l2a → renderOptions[0], name
// "Natural color") — reused as-is rather than hand-tuning gamma/saturation,
// since it's what Planetary Computer's own Explorer renders this collection
// with.
const PC_NATURAL_COLOR_PARAMS = "assets=B04&assets=B03&assets=B02&nodata=0&color_formula=Gamma+RGB+3.2+Saturation+0.8+Sigmoidal+RGB+25+0.35"

const PC_MAX_CLOUD_COVER_PCT = 20
export const PC_TILE_SIZE = 256
// 10m native resolution supports a meaningfully higher useful ceiling than
// HLS's 16 (see that module's header) — the same renderOptions entry above
// also declares its own minZoom: 9, below which titiler-pgstac's mosaic
// search itself refuses to render (too many matching scenes to composite
// cheaply at that scale) — enforced in useResolvedPlanetaryComputerMosaic
// below, not just left to fail server-side.
export const PC_MAXZOOM = 17
export const PC_MINZOOM = 9

// The collection's real STAC temporal extent starts 2015-06-27, but
// Sentinel-2B (needed for a full 2-satellite, ~5-day revisit) didn't launch
// until March 2017 — quarterly ticks before then would mostly be near-empty
// windows. Matches Planetary Computer's own published mosaic history (GET
// .../mosaic/info's oldest named entry is "Dec – Feb, 2018").
const PC_COVERAGE_START_MS = Date.UTC(2017, 11, 1) // 2017-12-01

export interface PcQuarterTick {
  /** Window end (exclusive) — used as the tick's position on the timeline,
   *  since that's the most recent real imagery a mosaic over this window
   *  could contain. */
  dateMs: number
  label: string
  startIso: string
  endIso: string
}

/** Generates the same quarterly (Dec-Feb / Mar-May / Jun-Aug / Sep-Nov)
 *  windows Planetary Computer's own named mosaic history uses for this
 *  collection, computed locally rather than fetched — deterministic, no
 *  extra network round trip just to build the timeline's tick list (same
 *  "synthetic but grounded in the source's own real cadence" spirit as
 *  lib/hls.ts's syntheticHlsTicks, just quarterly instead of monthly since
 *  that's the real window size Planetary Computer itself mosaics over). */
export function planetaryComputerQuarterTicks(): PcQuarterTick[] {
  const ticks: PcQuarterTick[] = []
  const nowMs = Date.now()
  let cursor = PC_COVERAGE_START_MS
  while (cursor <= nowMs) {
    const start = new Date(cursor)
    const end = new Date(cursor)
    end.setUTCMonth(end.getUTCMonth() + 3)
    const lastDayInWindow = new Date(end.getTime() - 86_400_000)
    const startLabel = start.toLocaleString("en-US", { month: "short", timeZone: "UTC" })
    const endLabel = lastDayInWindow.toLocaleString("en-US", { month: "short", timeZone: "UTC" })
    ticks.push({
      dateMs: end.getTime(),
      label: `${startLabel}–${endLabel} ${lastDayInWindow.getUTCFullYear()}`,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    })
    cursor = end.getTime()
  }
  return ticks
}

function nearestQuarterTick(dateMs: number): PcQuarterTick | null {
  const ticks = planetaryComputerQuarterTicks()
  if (!ticks.length) return null
  let best = ticks[0]
  let bestDist = Math.abs(ticks[0].dateMs - dateMs)
  for (const t of ticks) {
    const dist = Math.abs(t.dateMs - dateMs)
    if (dist < bestDist) { best = t; bestDist = dist }
  }
  return best
}

/** Registering a mosaic search is a real POST (not just URL templating like
 *  every other basemap source here), and the resulting tile URL template is
 *  itself fetched from Planetary Computer's own returned TileJSON — not
 *  hand-assembled — so this stays correct even if they ever change the tile
 *  endpoint's shape. Both steps are cached by window+cloud-cover so
 *  scrubbing back to an already-visited quarter this session is instant
 *  instead of re-registering, same module-level-cache pattern as lib/
 *  wayback.ts's cachedItemsPromise / lib/basemap-attribution.ts's
 *  cachedContributorsPromise. */
const tileUrlCache = new Map<string, Promise<string | null>>()

async function resolveTileUrl(startIso: string, endIso: string): Promise<string | null> {
  const registerRes = await fetch(`${PC_DATA_API}/mosaic/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collections: [PC_COLLECTION],
      datetime: `${startIso}/${endIso}`,
      query: { "eo:cloud_cover": { lt: PC_MAX_CLOUD_COVER_PCT } },
    }),
  })
  const searchId = (await registerRes.json())?.searchid
  if (!searchId) return null
  const tilejsonRes = await fetch(`${PC_DATA_API}/mosaic/${searchId}/tilejson.json?collection=${PC_COLLECTION}&${PC_NATURAL_COLOR_PARAMS}`)
  const tilejson = await tilejsonRes.json()
  return tilejson?.tiles?.[0] ?? null
}

function getTileUrl(startIso: string, endIso: string): Promise<string | null> {
  const key = `${startIso}|${endIso}`
  if (!tileUrlCache.has(key)) {
    const promise = resolveTileUrl(startIso, endIso).catch(() => null)
    tileUrlCache.set(key, promise)
    // Don't cache a failure — a transient network error shouldn't poison the
    // whole session (mirrors the two patterns cited above).
    promise.then((result) => { if (!result) tileUrlCache.delete(key) })
  }
  return tileUrlCache.get(key)!
}

// Same debounce cadence as lib/bing.ts's own network-triggering location/date
// change, so dragging the timeline scrubber across several quarters doesn't
// fire a register call per intermediate tick.
const PC_DEBOUNCE_MS = 400

/** Resolves the current side's scrubbed date to its containing quarter,
 *  registers (or reuses) that quarter's mosaic search, and returns the tile
 *  URL template once ready — null while resolving/on failure/when
 *  `centerDateMs` is falsy, same "render nothing rather than a broken tile
 *  request" convention as lib/wayback.ts's useResolvedWaybackRelease. */
export function useResolvedPlanetaryComputerMosaic(centerDateMs: number): { tileUrl: string | null } {
  const tick = useMemo(() => (centerDateMs ? nearestQuarterTick(centerDateMs) : null), [centerDateMs])
  const [tileUrl, setTileUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!tick) { setTileUrl(null); return }
    let cancelled = false
    const timer = setTimeout(() => {
      getTileUrl(tick.startIso, tick.endIso).then((url) => {
        if (!cancelled) setTileUrl(url)
      })
    }, PC_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [tick?.startIso, tick?.endIso])

  return { tileUrl }
}
