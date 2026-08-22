---
name: embed-bridge
description: Why iframe→wrapper state sync uses a 1 Hz postMessage poll (not history patching, not same-origin DNS tricks)
metadata:
  type: project
---

# Embed bridge — meta-app iframe state sync

`lib/embed-bridge.ts` (started once from `src/main.tsx`) streams the app's
`location.search` to a parent wrapper via
`postMessage({ type: "meta-app:state", params }, embedderOrigin)`.

Context: a separate "meta app" (https://app.heritagewatch.ai, also planned on
anchise.iconem.com) embeds terrain-viewer / historical-satellite in an iframe
(`/?app=terrain-viewer&lat=…`), forwards extra wrapper params into the iframe
src on load, and mirrors params emitted by the iframe back into its own
address bar with `replaceState` so wrapper URLs stay shareable.

## Decisions and why (2026-08-22)

- **postMessage, not same-origin.** Subdomains of one apex are same-*site*
  but not same-*origin*; a CNAME can't merge origins, `document.domain` is
  dead in modern Chrome, and GitHub Pages 301-redirects every custom domain
  except its single canonical one — so `terrain-viewer.heritagewatch.ai`
  would land the iframe on the iconem canonical host anyway. Same-origin
  would need a reverse proxy under the wrapper's own host + a rebased Vite
  build; rejected as overkill for the PoC.
- **1 Hz polling of `location.search`, NOT History API patching.** Explicit
  owner preference: do not wrap/monkey-patch `history.replaceState`/
  `pushState`, because nuqs owns URL writes and must stay untouched. Note
  `popstate` alone is useless here — it never fires on
  replaceState/pushState, only on back/forward.
- **Why 1 s is also a safety cadence:** the wrapper mirrors each message via
  its own `replaceState`, and Safari rate-limits that to 100 calls/30 s; a
  per-frame camera-drag emit would trip it.
- **targetOrigin allowlist, never `"*"`:** embedder origin is derived from
  `document.referrer` and must be app.heritagewatch.ai, anchise.iconem.com,
  or localhost/127.0.0.1/[::1]/*.localhost. A wrapper with
  `Referrer-Policy: no-referrer` silences the bridge by design.
- **Wrapper must REPLACE forwarded params, not merge** — nuqs drops params at
  their default value, and merging would keep stale values in shared URLs.

Related: URL-state architecture in [[camera-sync]] (nuqs owns camera pose).
