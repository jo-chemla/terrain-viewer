import { pushToast } from "@/components/ui/toast"

// Sources that are not already Web Mercator tiles — a COG in a national CRS, a
// VRT, a raw WMS — are reprojected per tile by titiler (see source-builder.ts).
// That happens inside a plain tile URL template, so when the endpoint is down,
// blocked by a network, or simply mistyped in Settings, maplibre reports a
// string of failed tile requests and the layer renders nothing. Nothing in the
// UI ever says "the reprojection service is unreachable", and the source itself
// is usually fine.
//
// A one-shot probe of titiler's own /healthz is a cheap, unambiguous answer:
// either the endpoint is there or it is not, no guessing from tile failures.

const checked = new Map<string, boolean>()

/** Probes `endpoint` once per distinct value per session and toasts if it is
 *  unreachable. Call it when a source that NEEDS titiler becomes active.
 *  Never throws, and never toasts twice for the same endpoint. */
export async function ensureTitilerReachable(endpoint: string): Promise<boolean> {
  const base = endpoint.replace(/\/+$/, "")
  if (!base) return false
  const cached = checked.get(base)
  if (cached !== undefined) return cached

  // Optimistic placeholder so several sources activating in the same tick
  // fire one probe between them rather than one each.
  checked.set(base, true)
  let ok = false
  try {
    const res = await fetch(`${base}/healthz`, {
      // A hung endpoint is as broken as a refused one, and the default has no
      // timeout at all.
      signal: AbortSignal.timeout(8000),
    })
    ok = res.ok
  } catch {
    ok = false
  }
  checked.set(base, ok)

  if (!ok) {
    pushToast({
      key: "titiler-unreachable",
      title: "Reprojection service unreachable",
      body: `This source is not in Web Mercator, so its tiles are reprojected by titiler at ${base} — which is not answering. The layer will stay blank. Settings → Streaming Settings lets you point at another endpoint.`,
      duration: 10000,
    })
  }
  return ok
}

/** Does this source get its tiles reprojected by titiler?
 *
 *  Mirrors buildRasterTileSource's own switch exactly: cog / vrt / wms-raw go
 *  through titiler unless the client-side protocol is handling them, and a
 *  source flagged `cogViaTitiler` (a non-Mercator file, or a host the
 *  in-browser reader cannot Range-request) is pinned to titiler regardless of
 *  the global preference. Everything else is a plain tile template or a
 *  browser-side protocol and never touches the endpoint. */
export function needsTitiler(
  source: { type?: string; cogViaTitiler?: boolean } | undefined,
  useCogProtocolVsTitiler: boolean,
): boolean {
  if (!source?.type) return false
  if (!["cog", "vrt", "wms-raw"].includes(source.type)) return false
  // cog-local is always read in-browser (there is no URL for titiler to fetch).
  return !(useCogProtocolVsTitiler && !source.cogViaTitiler)
}
