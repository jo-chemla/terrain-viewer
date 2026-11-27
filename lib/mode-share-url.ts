// The link the Share dialog hands out, on the path of the app mode in use.
//
// The build writes one static page per mode with its own link preview
// (scripts/mode-pages.mjs: /rem/ and /historical/); a line at the top of each
// puts the address back to `/?appMode=<mode>` before the app starts. A link
// shared from the River REM mode therefore goes out as `/rem/?…`, so the
// preview is that mode's, and `appMode=rem` leaves the query: the path says
// it. (`/rem/?appMode=rem&…` works too: the page adds the parameter only
// when the query has none.)
//
// Which deployments have the pages: every one this build makes. The plugin
// in vite.config.ts writes both folders whatever SITE_MODE says (SITE_MODE
// only gives one mode's tags to the root page of that mode's own host), and
// the dev server answers the same paths. So the rule is on the address alone:
// an http(s) page at the app's root. The desktop app (views://) and a page
// served from some other file keep their address as it is.
//
// The other half is the mode a link WITHOUT `appMode` opens in. It is not
// always terrain: a host that is one mode's own (historical-satellite.…,
// river-rem.…) opens that mode when the link names none (TerrainViewer.tsx,
// isHistoricalHostname / isRemHostname). A terrain view shared from such a
// host is therefore given `appMode=terrain` in so many words; nuqs leaves a
// default out of the address, and without it the link would open the host's
// mode instead.

/** The app modes that have a page, and the folder of each. Kept equal to
 *  MODE_PAGES of scripts/mode-pages.mjs by lib/mode-share-url.test.ts. */
export const MODE_PAGE_PATHS: Record<string, string> = { rem: "rem", historical: "historical" }

/** The mode a link with no `appMode` opens in on this host, for a visitor
 *  with no stored preference: the same rule as TerrainViewer.tsx. */
export function hostDefaultAppMode(hostname: string): "terrain" | "historical" | "rem" {
  if (/(^|\.)historical-satellite\.iconem\.com$/.test(hostname)) return "historical"
  if (/^river-rem\./.test(hostname)) return "rem"
  return "terrain"
}

/** `href` (the page's address, or the portable form of it) as the link to
 *  share. Anything that is not an http(s) address at the app's root comes
 *  back unchanged. The query keeps its order and its encoding: only the
 *  `appMode` pair is taken out or added. */
export function modeShareUrl(href: string): string {
  let url: URL
  try { url = new URL(href) } catch { return href }
  if (url.protocol !== "http:" && url.protocol !== "https:") return href
  // The app's root: ".../" or ".../index.html". A mode page that has not put
  // its address back yet (never seen by the dialog, but harmless) is left.
  const root = url.pathname.replace(/index\.html$/, "")
  if (!root.endsWith("/")) return href
  if (Object.values(MODE_PAGE_PATHS).some((p) => root.endsWith(`/${p}/`))) return href

  const pairs = url.search.replace(/^\?/, "").split("&").filter(Boolean)
  const isMode = (pair: string) => pair === "appMode" || pair.startsWith("appMode=")
  const mode = url.searchParams.get("appMode")
  const withQuery = (path: string, list: string[]) => `${url.origin}${path}${list.length ? `?${list.join("&")}` : ""}${url.hash}`

  const folder = mode ? MODE_PAGE_PATHS[mode] : undefined
  if (folder) return withQuery(`${root}${folder}/`, pairs.filter((p) => !isMode(p)))
  // No mode named (terrain, the parameter's default) on a host that would
  // open another one: say it.
  if (mode === null && hostDefaultAppMode(url.hostname) !== "terrain") return withQuery(url.pathname, ["appMode=terrain", ...pairs])
  return href
}
