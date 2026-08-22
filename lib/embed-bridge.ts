// Embed bridge: streams this app's URL state to a parent "meta app" wrapper
// (e.g. https://app.heritagewatch.ai/?app=terrain-viewer) that embeds us in an
// iframe. The wrapper listens for `postMessage({ type: "meta-app:state",
// params })` and mirrors our query params into its own address bar, so every
// wrapper view stays bookmarkable/shareable.
//
// Why postMessage and not direct reads: the wrapper and this app live on
// different origins, and a cross-origin parent cannot read
// `iframe.contentWindow.location`. DNS cannot fix that — pointing a
// terrain-viewer.heritagewatch.ai CNAME at the GitHub Pages site would still
// be a different origin from app.heritagewatch.ai (same *site* ≠ same
// *origin*; `document.domain` relaxation is deprecated and disabled in modern
// Chrome). Worse, GitHub Pages allows exactly one custom domain per site and
// 301-redirects any other, so the iframe would land back on the canonical
// host anyway. True same-origin would require reverse-proxying the app under
// a path of the wrapper's own host — real infrastructure for no PoC benefit.
// postMessage is the standard, zero-infra channel.
//
// Why polling and not patching history.replaceState/pushState: nuqs owns URL
// writes in this app (camera pose, viz modes, …) and we deliberately do not
// wrap or interfere with the History API it relies on. A 1 Hz poll of
// `location.search` is decoupled, unbreakable across nuqs upgrades, and
// plenty fast for bookmarkable state. The low cadence also protects the
// wrapper: it mirrors each message via its own `history.replaceState`, and
// Safari hard-limits that to 100 calls per 30 s — a camera drag emitting per
// frame would trip it in seconds.
//
// Why the targetOrigin allowlist: we never broadcast with "*". The embedder's
// origin comes from `document.referrer` (the browser default referrer policy,
// strict-origin-when-cross-origin, still exposes the origin cross-origin) and
// must match the allowlist below, otherwise the bridge stays silent. If a
// wrapper sets `Referrer-Policy: no-referrer` on its own document, the bridge
// cannot identify it and will not emit — relax that policy wrapper-side
// rather than widening this to "*".
//
// Wrapper contract (see the meta-app repo): on `meta-app:state` it should
// REPLACE the previously forwarded params with the new `params` string, not
// merge — nuqs drops params that return to their default, and a merge would
// keep those stale values alive in shared wrapper URLs.

const ALLOWED_EMBEDDER_HOSTS = new Set([
  "app.heritagewatch.ai",
  "anchise.iconem.com",
])

function isAllowedEmbedder(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    if (ALLOWED_EMBEDDER_HOSTS.has(hostname)) return true
    // Any local dev server, on any port/scheme.
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    )
  } catch {
    return false
  }
}

export function startEmbedBridge(): void {
  // Standalone (not iframed): window.parent === window, nothing to talk to.
  if (window.self === window.top) return
  if (!document.referrer) return

  const embedderOrigin = new URL(document.referrer).origin
  if (!isAllowedEmbedder(embedderOrigin)) return

  let lastSent: string | null = null
  const sendIfChanged = () => {
    const params = window.location.search
    if (params === lastSent) return
    lastSent = params
    window.parent.postMessage({ type: "meta-app:state", params }, embedderOrigin)
  }

  sendIfChanged()
  window.setInterval(sendIfChanged, 1000)
}
