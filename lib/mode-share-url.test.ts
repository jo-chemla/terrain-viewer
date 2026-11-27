// node scripts/test-lib.mjs lib/mode-share-url.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { modeShareUrl, MODE_PAGE_PATHS, hostDefaultAppMode } from "./mode-share-url"
import { isHistoricalHostname, isRemHostname } from "./settings-atoms"
// @ts-expect-error a build script, no types
import { MODE_PAGES, modePageHtml } from "../scripts/mode-pages.mjs"

const MAIN = "https://terrain-viewer.iconem.com"
const HIST = "https://historical-satellite.iconem.com"

test("a mode with a page goes on its path and appMode leaves the query", () => {
  assert.equal(
    modeShareUrl(`${MAIN}/?appMode=rem&lat=33.1467&lng=-91.1258&zoom=10.5`),
    `${MAIN}/rem/?lat=33.1467&lng=-91.1258&zoom=10.5`,
  )
  assert.equal(modeShareUrl(`${MAIN}/?lat=1&appMode=historical&dateA=5`), `${MAIN}/historical/?lat=1&dateA=5`)
  assert.equal(modeShareUrl(`${MAIN}/?appMode=rem`), `${MAIN}/rem/`)
})

test("the hash, the order and the encoding of the query are kept", () => {
  assert.equal(
    modeShareUrl(`${MAIN}/?remRiverName=Mississippi+River&appMode=rem&vizViews=showHillshade:A;showSlope:B&x=%C3%A9#11/33.1/-91.1`),
    `${MAIN}/rem/?remRiverName=Mississippi+River&vizViews=showHillshade:A;showSlope:B&x=%C3%A9#11/33.1/-91.1`,
  )
})

test("terrain, and a mode without a page, stay at the root", () => {
  const terrain = `${MAIN}/?lat=45.9&lng=7.6&zoom=12`
  assert.equal(modeShareUrl(terrain), terrain)
  assert.equal(modeShareUrl(`${MAIN}/?appMode=terrain&lat=1`), `${MAIN}/?appMode=terrain&lat=1`)
  assert.equal(modeShareUrl(`${MAIN}/?appMode=georef&lat=1`), `${MAIN}/?appMode=georef&lat=1`)
  assert.equal(modeShareUrl(`${MAIN}/`), `${MAIN}/`)
})

test("a sub-path deployment and index.html", () => {
  assert.equal(modeShareUrl("https://example.org/terrain-viewer/?appMode=rem&lat=1"), "https://example.org/terrain-viewer/rem/?lat=1")
  assert.equal(modeShareUrl("https://example.org/tv/index.html?appMode=rem&lat=1"), "https://example.org/tv/rem/?lat=1")
  assert.equal(modeShareUrl("http://localhost:5173/?appMode=historical"), "http://localhost:5173/historical/")
})

test("what is not an http(s) page at the app's root is left alone", () => {
  for (const href of ["views://mainview/index.html?appMode=rem&lat=1", "file:///C:/dist/index.html?appMode=rem", "https://example.org/page.html?appMode=rem", `${MAIN}/rem/?appMode=rem&lat=1`, "", "not a url"]) {
    assert.equal(modeShareUrl(href), href)
  }
})

test("the mirror host (SITE_MODE=historical): no link opens another mode than the one shared", () => {
  // Historical is that host's default; its page exists there as on every
  // deployment, and names the mode whatever the host.
  assert.equal(modeShareUrl(`${HIST}/?appMode=historical&dateA=5`), `${HIST}/historical/?dateA=5`)
  assert.equal(modeShareUrl(`${HIST}/?appMode=rem&lat=1`), `${HIST}/rem/?lat=1`)
  // Terrain is the parameter's default, so the address has no appMode; on
  // this host such a link would open Historical.
  assert.equal(modeShareUrl(`${HIST}/?lat=45.9&zoom=12`), `${HIST}/?appMode=terrain&lat=45.9&zoom=12`)
  assert.equal(modeShareUrl(`${HIST}/`), `${HIST}/?appMode=terrain`)
  assert.equal(modeShareUrl("https://river-rem.iconem.com/?lat=1#h"), "https://river-rem.iconem.com/?appMode=terrain&lat=1#h")
})

test("the host rule is the app's", () => {
  for (const h of ["terrain-viewer.iconem.com", "historical-satellite.iconem.com", "old.historical-satellite.iconem.com", "river-rem.iconem.com", "river-rem.example.org", "localhost", "jo-chemla.github.io"]) {
    const app = isHistoricalHostname(h) ? "historical" : isRemHostname(h) ? "rem" : "terrain"
    assert.equal(hostDefaultAppMode(h), app, h)
  }
})

test("the paths are the build's (scripts/mode-pages.mjs)", () => {
  assert.deepEqual(MODE_PAGE_PATHS, Object.fromEntries((MODE_PAGES as { appMode: string; path: string }[]).map((p) => [p.appMode, p.path])))
})

// The page's own first line, run against a stand-in for the browser: the
// shared link must come back to the address the app was on.
function boot(pageHref: string, appMode: string): string {
  const index = `<html><head><title>t</title><link rel="canonical" href="x"><meta name="description" content="x"><meta name="og:title" property="og:title" content="x"><meta name="og:description" property="og:description" content="x"><meta name="og:image" property="og:image" content="x"><meta property="og:image:alt" content="x"><meta property="og:url" content="x"><meta name="twitter:title" content="x"><meta name="twitter:description" content="x"><meta name="twitter:image" content="x"><meta name="twitter:image:alt" content="x"></head></html>`
  const page = (MODE_PAGES as { appMode: string }[]).find((p) => p.appMode === appMode)
  const html: string = modePageHtml(index, page)
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
  assert.ok(script, "the page has its first line")
  const at = new URL(pageHref)
  let result = ""
  const history = { state: null, replaceState: (_s: unknown, _t: string, rel: string) => { result = new URL(rel, at).href } }
  new Function("location", "history", script!)({ search: at.search, hash: at.hash }, history)
  return result
}

test("the mode page puts a query without appMode, and one with it, back to the root; hash kept", () => {
  assert.equal(boot(`${MAIN}/rem/?lat=33.15&lng=-91.13#k`, "rem"), `${MAIN}/?lat=33.15&lng=-91.13&appMode=rem#k`)
  assert.equal(boot(`${MAIN}/rem/`, "rem"), `${MAIN}/?appMode=rem`)
  assert.equal(boot(`${MAIN}/rem/#k`, "rem"), `${MAIN}/?appMode=rem#k`)
  assert.equal(boot(`${MAIN}/rem/?appMode=rem&lat=1#k`, "rem"), `${MAIN}/?appMode=rem&lat=1#k`)
  assert.equal(boot(`${MAIN}/rem/?lat=1&appMode=rem`, "rem"), `${MAIN}/?lat=1&appMode=rem`)
  assert.equal(boot("https://example.org/tv/historical/?dateA=5", "historical"), "https://example.org/tv/?dateA=5&appMode=historical")
})

test("round trip: the shared link opens the same state", () => {
  for (const href of [`${MAIN}/?appMode=rem&lat=33.1467&remRiverName=Mississippi+River#h`, `${HIST}/?dateA=5&appMode=historical&x=%C3%A9`, "https://example.org/tv/?appMode=rem"]) {
    const shared = modeShareUrl(href)
    const mode = new URL(href).searchParams.get("appMode")!
    assert.notEqual(shared, href)
    const back = new URL(boot(shared, mode))
    const from = new URL(href)
    assert.equal(back.origin + back.pathname + back.hash, from.origin + from.pathname + from.hash)
    assert.deepEqual([...back.searchParams].sort(), [...from.searchParams].sort())
  }
})
