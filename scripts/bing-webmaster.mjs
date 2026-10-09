// Bing Webmaster Tools, read with BING_WEBMASTER_API_KEY from .env (Settings,
// API access in Webmaster Tools). Prints the query stats, the rank and
// traffic stats, the page stats, the crawl stats and the inbound links of
// the site. Usage: node scripts/bing-webmaster.mjs [--site https://terrain-viewer.iconem.com/] [--json out.json]
import fs from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1] }
const site = opt("--site", "https://terrain-viewer.iconem.com/")
const jsonOut = opt("--json", "")
let key = process.env.BING_WEBMASTER_API_KEY
for (const f of [path.resolve(".env"), "C:/Dev/Iconem/terrain-viewer/.env"]) {
  if (key) break
  if (!fs.existsSync(f)) continue
  const m = fs.readFileSync(f, "utf8").match(/^BING_WEBMASTER_API_KEY=(.+)$/m)
  if (m) key = m[1].trim()
}
if (!key) { console.error("No BING_WEBMASTER_API_KEY in .env"); process.exit(1) }

const api = async (method, extra = {}) => {
  const u = new URL(`https://ssl.bing.com/webmaster/api.svc/json/${method}`)
  u.searchParams.set("siteUrl", site); u.searchParams.set("apikey", key)
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v)
  const res = await fetch(u)
  const text = await res.text()
  if (!res.ok) throw new Error(`${method}: ${res.status} ${text.slice(0, 200)}`)
  return JSON.parse(text).d
}
const out = { site, fetchedAt: new Date().toISOString() }
const show = (title, rows, fmt, n = 25) => { console.log(`\n${title}: ${rows?.length ?? 0} rows`); for (const r of (rows ?? []).slice(0, n)) console.log("  " + fmt(r)) }
const date = (d) => { const m = /\/Date\((\d+)\)\//.exec(String(d)); return m ? new Date(+m[1]).toISOString().slice(0, 10) : String(d) }

try { out.sites = await api("GetUserSites"); console.log("Sites:", out.sites.map((s) => `${s.Url} (${s.IsVerified ? "verified" : "unverified"})`).join("; ")) } catch (e) { console.log(e.message) }
try { out.traffic = (await api("GetRankAndTrafficStats")).map((r) => ({ date: date(r.Date), clicks: r.Clicks, impressions: r.Impressions }))
  const t = out.traffic.reduce((a, r) => ({ clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions }), { clicks: 0, impressions: 0 })
  console.log(`\nRank and traffic: ${out.traffic.length} days, ${t.clicks} clicks, ${t.impressions} impressions, ${out.traffic[0]?.date} .. ${out.traffic.at(-1)?.date}`)
} catch (e) { console.log(e.message) }
try { out.queries = (await api("GetQueryStats")).map((r) => ({ query: r.Query, clicks: r.Clicks, impressions: r.Impressions, position: r.AvgClickPosition, date: date(r.Date) })).sort((a, b) => b.impressions - a.impressions)
  show("Queries", out.queries, (r) => `${String(r.clicks).padStart(4)} clicks ${String(r.impressions).padStart(6)} impr  pos ${String(r.position).padStart(4)}  ${r.query}`) } catch (e) { console.log(e.message) }
try { out.pages = (await api("GetPageStats")).map((r) => ({ page: r.Query, clicks: r.Clicks, impressions: r.Impressions, position: r.AvgClickPosition })).sort((a, b) => b.impressions - a.impressions)
  show("Pages", out.pages, (r) => `${String(r.clicks).padStart(4)} clicks ${String(r.impressions).padStart(6)} impr  pos ${String(r.position).padStart(4)}  ${r.page}`) } catch (e) { console.log(e.message) }
try { out.crawl = (await api("GetCrawlStats")).map((r) => ({ date: date(r.Date), crawled: r.CrawledPages, inIndex: r.InIndex, errors: r.CrawlErrors, inLinks: r.InLinks }))
  console.log(`\nCrawl: ${out.crawl.length} days; last: ${JSON.stringify(out.crawl.at(-1))}`) } catch (e) { console.log(e.message) }
try { const l = await api("GetUrlLinks", { link: site, page: 0 }); out.links = l; console.log(`\nInbound links to the home page: ${l?.TotalCount ?? "?"} total`); for (const r of (l?.Links ?? []).slice(0, 30)) console.log(`  ${r.Url}  ${r.AnchorText ? "(" + r.AnchorText + ")" : ""}`) } catch (e) { console.log(e.message) }
try { const c = await api("GetLinkCounts", { page: 0 }); out.linkCounts = c; console.log(`\nLinked pages: ${c?.TotalCount ?? "?"}`); for (const r of (c?.Links ?? []).slice(0, 15)) console.log(`  ${r.Count}  ${r.Url}`) } catch (e) { console.log(e.message) }
if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2)); console.log("\nwritten", jsonOut) }
