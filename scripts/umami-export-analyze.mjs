// Umami CSV export (Settings, Export: a zip with website_event.csv): pageviews
// per day, the top sessions of given days and what they did. Found the Oct 2-3
// 2026 spike (an old clone run on localhost). Usage:
//   node scripts/umami-export-analyze.mjs <unzipped dir> [YYYY-MM-DD ...]
import fs from "node:fs"
const dir = process.argv[2]
const spikeDays = process.argv.slice(3).length ? process.argv.slice(3) : ["2026-10-02", "2026-10-03"]
const parse = (text) => {
  const rows = []; let row = [], field = "", q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false } else field += c }
    else if (c === '"') q = true
    else if (c === ",") { row.push(field); field = "" }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = "" }
    else if (c !== "\r") field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}
const rows = parse(fs.readFileSync(`${dir}/website_event.csv`, "utf8"))
const H = rows[0]; const col = Object.fromEntries(H.map((h, i) => [h, i]))
const ev = rows.slice(1).filter((r) => r.length >= H.length).map((r) => Object.fromEntries(H.map((h, i) => [h, r[i]])))
const pv = ev.filter((e) => e.event_type === "1")
const cv = ev.filter((e) => e.event_type === "2")
console.log(`rows ${ev.length}: pageviews ${pv.length}, custom events ${cv.length}, range ${ev.reduce((a, e) => e.created_at < a ? e.created_at : a, "9")} .. ${ev.reduce((a, e) => e.created_at > a ? e.created_at : a, "0")}`)
const byDay = {}
for (const e of pv) { const d = e.created_at.slice(0, 10); byDay[d] ??= { pv: 0, sessions: new Set() }; byDay[d].pv++; byDay[d].sessions.add(e.session_id) }
console.log("\npageviews per day (sessions):")
for (const d of Object.keys(byDay).sort()) console.log(`  ${d}  ${String(byDay[d].pv).padStart(6)}  (${byDay[d].sessions.size} sessions)`)
const count = (arr, key) => { const m = {}; for (const x of arr) { const k = key(x) || "(empty)"; m[k] = (m[k] ?? 0) + 1 }; return Object.entries(m).sort((a, b) => b[1] - a[1]) }
console.log("\npageviews by hostname:", count(pv, (e) => e.hostname).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", "))
console.log("pageviews by tag:", count(pv, (e) => e.tag).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", "))
const spike = pv.filter((e) => spikeDays.includes(e.created_at.slice(0, 10)))
console.log(`\nspike days ${spikeDays.join(", ")}: ${spike.length} pageviews`)
console.log("  by path:", count(spike, (e) => e.url_path).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(", "))
console.log("  by browser:", count(spike, (e) => e.browser).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", "))
console.log("  by country:", count(spike, (e) => e.country).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(", "))
console.log("  by referrer:", count(spike, (e) => e.referrer_domain).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(", "))
const sessions = count(spike, (e) => e.session_id)
console.log(`\ntop sessions of the spike days (${sessions.length} sessions):`)
for (const [sid, n] of sessions.slice(0, 8)) {
  const s = spike.filter((e) => e.session_id === sid).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const f = s[0]
  const all = ev.filter((e) => e.session_id === sid)
  const evs = count(all.filter((e) => e.event_type === "2"), (e) => e.event_name).slice(0, 8).map(([k, c]) => `${k} ${c}`).join(", ")
  const paths = count(s, (e) => e.url_path).slice(0, 4).map(([k, c]) => `${k} ${c}`).join(", ")
  const visits = new Set(s.map((e) => e.visit_id)).size
  const gaps = s.slice(1).map((e, i) => (new Date(e.created_at + "Z") - new Date(s[i].created_at + "Z")) / 1000)
  const median = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null
  console.log(`\n  ${sid.slice(0, 8)}  ${n} pageviews, ${visits} visits, ${f.created_at} .. ${s[s.length - 1].created_at}, median gap ${median} s`)
  console.log(`    ${f.browser} / ${f.os} / ${f.device} ${f.screen} ${f.language}, ${f.country} ${f.city}, host ${f.hostname}, referrer ${f.referrer_domain || "-"}`)
  console.log(`    paths: ${paths}`)
  console.log(`    queries (3): ${[...new Set(s.map((e) => e.url_query).filter(Boolean))].slice(0, 3).map((q) => q.slice(0, 120)).join(" | ") || "-"}`)
  console.log(`    events: ${evs || "-"}`)
}
// Pageviews with a query string: data-exclude-search should have made these empty.
const withQuery = pv.filter((e) => e.url_query)
console.log(`\npageviews carrying a url_query: ${withQuery.length} of ${pv.length}; by day:`, count(withQuery, (e) => e.created_at.slice(0, 10)).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", "))
