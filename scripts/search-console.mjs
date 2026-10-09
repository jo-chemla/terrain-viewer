// Google Search Console, read with the service account whose JSON key path is
// GOOGLE_SEARCH_CONSOLE_KEY_FILE in .env (the main checkout's; the account
// must be a user of the property). No dependency: the OAuth JWT is signed
// with node:crypto. Prints the sites the account sees, then for the property
// the last N days (default 28) of search analytics by query, by page and by
// country, and the sitemaps. Usage:
//   node scripts/search-console.mjs [--days 28] [--site https://terrain-viewer.iconem.com/] [--json out.json]
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1] }
const days = Number(opt("--days", 28))
const site = opt("--site", "https://terrain-viewer.iconem.com/")
const jsonOut = opt("--json", "")

// .env of this checkout, else the main checkout's.
const envFiles = [path.resolve(".env"), "C:/Dev/Iconem/terrain-viewer/.env"]
let keyFile = process.env.GOOGLE_SEARCH_CONSOLE_KEY_FILE
for (const f of envFiles) {
  if (keyFile) break
  if (!fs.existsSync(f)) continue
  const m = fs.readFileSync(f, "utf8").match(/^GOOGLE_SEARCH_CONSOLE_KEY_FILE=(.+)$/m)
  if (m) keyFile = m[1].trim().replace(/^"|"$/g, "")
}
if (!keyFile || !fs.existsSync(keyFile)) { console.error("No key file: set GOOGLE_SEARCH_CONSOLE_KEY_FILE in .env"); process.exit(1) }
const key = JSON.parse(fs.readFileSync(keyFile, "utf8"))

const b64url = (s) => Buffer.from(s).toString("base64url")
async function accessToken() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: key.token_uri, iat: now, exp: now + 3600 }))
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), key.private_key).toString("base64url")
  const res = await fetch(key.token_uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }) })
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

const token = await accessToken()
const api = async (url, init) => {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) } })
  const text = await res.text()
  if (!res.ok) throw new Error(`${url}: ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

const out = { site, days, fetchedAt: new Date().toISOString() }
const sites = await api("https://www.googleapis.com/webmasters/v3/sites")
out.sites = (sites.siteEntry ?? []).map((s) => `${s.siteUrl} (${s.permissionLevel})`)
console.log("Sites:", out.sites.join("; ") || "none (add the service account as a user on the property)")

const end = new Date(); end.setUTCDate(end.getUTCDate() - 2) // Search Console lags two days
const start = new Date(end); start.setUTCDate(start.getUTCDate() - days)
const fmt = (d) => d.toISOString().slice(0, 10)
const enc = encodeURIComponent(site)
const query = (dimensions, rowLimit = 50) => api(`https://www.googleapis.com/webmasters/v3/sites/${enc}/searchAnalytics/query`, { method: "POST", body: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), dimensions, rowLimit }) })

for (const dim of ["query", "page", "country", "device", "date"]) {
  try {
    const r = await query([dim], dim === "date" ? 400 : 50)
    out[dim] = (r.rows ?? []).map((row) => ({ key: row.keys[0], clicks: row.clicks, impressions: row.impressions, ctr: +(row.ctr * 100).toFixed(1), position: +row.position.toFixed(1) }))
    const totals = out[dim].reduce((a, r) => ({ clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions }), { clicks: 0, impressions: 0 })
    console.log(`\n${dim} (${fmt(start)} to ${fmt(end)}): ${out[dim].length} rows, ${totals.clicks} clicks, ${totals.impressions} impressions`)
    for (const r of out[dim].slice(0, dim === "date" ? 0 : 25)) console.log(`  ${String(r.clicks).padStart(4)} clicks ${String(r.impressions).padStart(6)} impr  ${String(r.ctr).padStart(5)}% ctr  pos ${String(r.position).padStart(5)}  ${r.key}`)
  } catch (e) { console.log(`${dim}: ${e.message}`) }
}
try {
  const sm = await api(`https://www.googleapis.com/webmasters/v3/sites/${enc}/sitemaps`)
  out.sitemaps = (sm.sitemap ?? []).map((s) => ({ path: s.path, lastSubmitted: s.lastSubmitted, lastDownloaded: s.lastDownloaded, errors: s.errors, warnings: s.warnings, contents: s.contents }))
  console.log("\nSitemaps:", JSON.stringify(out.sitemaps))
} catch (e) { console.log(`sitemaps: ${e.message}`) }
if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2)); console.log("\nwritten", jsonOut) }
