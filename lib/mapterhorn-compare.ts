import customSources from "./custom-sources.json"

/**
 * How a sample terrain source compares with Mapterhorn, the default built-in
 * terrain, over the same area. Mapterhorn ingests each country's finest BULK
 * data; these sources stream from the agency's live API, which is sometimes
 * finer (Norway 0.25 m vs 1 m), sometimes coarser (Italy 10 m vs 1 m), and
 * sometimes the only data at all (Mexico, Uruguay: Mapterhorn has no national
 * source there and falls back to global 30 m).
 *
 *   new       - Mapterhorn has nothing national here (falls back to GLO-30)
 *   finer     - this source is finer than what Mapterhorn ingested
 *   bareearth - same 30 m grid, but an AI terrain model where Mapterhorn only
 *               has the GLO-30 SURFACE (ANADEM, GEDTM30) - better ground
 *   same    - equal resolution
 *   coarser - Mapterhorn is the better choice for detail
 *
 * Both numbers come from lib/custom-sources.json: resolutionM per source, and
 * MAPTERHORN_BEST_RESOLUTION_M per ISO-3 prefix (GLOBAL for the fallback). The
 * docs page grades with the exact same data.
 */
export type MapterhornVerdict = "new" | "finer" | "bareearth" | "same" | "coarser"

export interface MapterhornComparison {
  verdict: MapterhornVerdict
  /** This source's native grid, metres. */
  ours: number
  /** Mapterhorn's best ingested grid for the area, metres (30 when it falls back). */
  theirs: number
}

const BEST: Record<string, number | undefined> = customSources.MAPTERHORN_BEST_RESOLUTION_M
const GLO30 = BEST.GLOBAL ?? 30
const ISO_RE = /^([A-Z]{3}) - /

/** Which grid to grade: what the live API serves ("api", the default and
 *  what the viewer actually renders), or the finest grid the agency
 *  advertises for bulk download ("bulk"), which is what Mapterhorn itself
 *  would ingest. */
export type ResolutionMetric = "api" | "bulk"

export function resolutionOf(source: { resolutionM?: number; bulkResolutionM?: number }, metric: ResolutionMetric = "api"): number | undefined {
  return metric === "bulk" ? source.bulkResolutionM ?? source.resolutionM : source.resolutionM
}

/** null when the source carries no resolution, so nothing can be said. */
export function compareWithMapterhorn(source: { name: string; resolutionM?: number; bulkResolutionM?: number }, metric: ResolutionMetric = "api"): MapterhornComparison | null {
  const ours = resolutionOf(source, metric)
  if (ours === undefined) return null
  // Bathymetry has no Mapterhorn counterpart at all - it is land-only.
  if (/bathymetr/i.test(source.name)) return { verdict: "new", ours, theirs: GLO30 }
  if (/bare-earth DTM from the GLO-30/i.test(source.name)) return { verdict: "bareearth", ours, theirs: GLO30 }
  const iso = source.name.startsWith("Global - ") ? "GLOBAL" : ISO_RE.exec(source.name)?.[1]
  const national = iso ? BEST[iso] : undefined
  // No national entry (or one no better than the global fallback): anything
  // finer than 30 m is data Mapterhorn simply does not have; a 30 m source
  // over a 30 m fallback is the same thing re-served (DE Africa, Uruguay).
  if (national === undefined || national >= GLO30) {
    if (ours < GLO30) return { verdict: "new", ours, theirs: GLO30 }
    return { verdict: ours > GLO30 ? "coarser" : "same", ours, theirs: GLO30 }
  }
  const theirs = national
  if (ours < theirs) return { verdict: "finer", ours, theirs }
  if (ours > theirs) return { verdict: "coarser", ours, theirs }
  return { verdict: "same", ours, theirs }
}

/** "0.5 m", "0.25 m", "115 m" - no trailing zeros. */
export function formatRes(m: number): string {
  return `${m < 1 ? m.toString().replace(/^0\./, "0.") : Math.round(m)} m`
}
