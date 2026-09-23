import { useEffect, useState } from "react"
import { getVrtInfo, type VrtInfo } from "./vrt-protocol"

/**
 * The VRT equivalent of `useCogMetadata`: bounds and a zoom range read from the
 * mosaic's own XML index, for a VRT served by the in-browser `vrt://` protocol.
 *
 * A VRT has no COG header, so without this a client-read VRT falls back to a
 * flat 0-20 — which at z3 asks one tile to Range-read every file in a national
 * mosaic. `getVrtInfo` caches the parsed document, so this costs one fetch per
 * URL for the whole session however many components ask.
 */
export function useVrtInfo(vrtUrl: string | null): VrtInfo | null {
  const [info, setInfo] = useState<VrtInfo | null>(null)
  useEffect(() => {
    // Reset on switch, for the same reason useCogMetadata does: a stale
    // previous mosaic's bounds would be reported as the new source's.
    if (!vrtUrl) { setInfo(null); return }
    let cancelled = false
    setInfo(null)
    getVrtInfo(vrtUrl)
      .then((i) => { if (!cancelled) setInfo(i) })
      .catch(() => { if (!cancelled) setInfo(null) })
    return () => { cancelled = true }
  }, [vrtUrl])
  return info
}
