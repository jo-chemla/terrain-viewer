// Prepares generated/ (not tracked):
//   app-lib.mjs   the app's own catalog code, bundled for Node (app-lib.ts)
//   library.json  the terrain library and the catalogs with their extents
//
// import.meta.env is defined empty: no key from .env can reach the bundle.
// Keyed catalogs (Planet) therefore answer nothing here, which is intended.
import { build } from "esbuild"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
mkdirSync(here("./generated"), { recursive: true })

await build({
  entryPoints: [here("./app-lib.ts")],
  outfile: here("./generated/app-lib.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node20",
  tsconfig: here("../tsconfig.json"),
  logLevel: "error",
  define: { "import.meta.env": "{}" },
  loader: { ".gz": "empty", ".png": "empty", ".jpg": "empty", ".svg": "empty", ".css": "empty", ".mdx": "empty" },
})

const src = JSON.parse(readFileSync(here("../lib/custom-sources.json"), "utf8"))
const terrain = src.SAMPLE_TERRAIN_SOURCES
  // Ids made on one machine (custom-<timestamp>) and project-only entries are not library datasets.
  .filter((s) => /^custom-[a-z]/.test(s.id))
  // `tiles`: only for plain Terrarium / Terrain-RGB pyramids, which the
  // server can sample itself and the in-chat map can draw; a COG, WMS or VRT
  // dataset is read by the app alone.
  .map((s) => ({ id: s.id, name: s.name, type: s.type, tiles: (s.type === "terrarium" || s.type === "terrainrgb") && s.redFactor == null && s.baseShift == null && /^https:\/\//.test(s.url) ? s.url : null, maxzoom: s.maxzoom ?? null, bounds: s.bounds ?? null, resolutionM: s.resolutionM ?? null, description: s.description ?? "", infoUrl: s.infoUrl ?? "" }))

// `origins`: every https host the app's built-in lists read (the terrain and
// raster libraries, the built-in terrain and basemaps, the dated imagery and
// its catalogs), for the view to declare when the app runs inside it ("App
// here"). A host with a subdomain placeholder ({s}, ${...}) becomes a
// wildcard. Not covered, because they are only known when the app runs: the
// files a VRT or a STAC item points to, and an address pasted by the user.
const NOT_DATA = /(^|\.)(github\.com|githubusercontent\.com|wikipedia\.org|wikimedia\.org|openstreetmap\.org|opengis\.net|w3\.org|creativecommons\.org|youtube\.com|doi\.org|example\.com)$/
const origins = new Set()
const addUrls = (text) => {
  for (const m of text.matchAll(/https:\/\/((?:\$\{[^}]*\}|\{[^}]*\}|[A-Za-z0-9.:-])+)/g)) {
    let host = m[1].replace(/\.+$/, "")
    if (/[${]/.test(host)) {
      const labels = host.split(".")
      if (labels.slice(1).some((l) => /[${]/.test(l)) || labels.length < 3) continue
      host = ["*", ...labels.slice(1)].join(".")
    }
    if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(host) || NOT_DATA.test(host.replace(/^\*\./, "").replace(/:\d+$/, ""))) continue
    origins.add(`https://${host.toLowerCase()}`)
  }
}
const walk = (o) => {
  if (typeof o === "string") addUrls(o)
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) if (!/description|infoUrl|license|attribution|thumbnail|note|docs/i.test(k)) walk(v)
}
walk(src)
for (const f of ["../lib/terrain-sources.ts", "../lib/historical-sources.ts", "../lib/historical-export-sources.ts", "../lib/timeline-catalogs.ts", "../lib/national-historical.ts", "../lib/linked-sources.ts", "../lib/wayback.ts", "../lib/ge-historical.ts", "../lib/google-timelapse.ts", "../components/TerrainControlPanel/raster-basemap-section.tsx"]) {
  // Comment lines and information links are documentation, not data.
  addUrls(readFileSync(here(f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/infoUrl|docs|href|licen[cs]e/i.test(l)).join("\n"))
}
writeFileSync(here("./generated/library.json"), JSON.stringify({ terrain, mapterhornBestResolutionM: src.MAPTERHORN_BEST_RESOLUTION_M, origins: [...origins].sort() }))
console.log(`generated: app-lib.mjs, library.json (${terrain.length} terrain datasets, ${origins.size} data hosts)`)
