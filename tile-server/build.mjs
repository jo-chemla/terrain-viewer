// Prepares generated/ (not tracked):
//   app-lib.mjs   the app's own catalog code, bundled for Node (app-lib.ts)
//   app-render.mjs the app's tile protocols and layer paints (app-render.ts)
//   library.json  the terrain library and the catalogs with their extents
//
// import.meta.env is defined empty: no key from .env can reach the bundle.
// Keyed catalogs (Planet) therefore answer nothing here, which is intended.
import { build } from "esbuild"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

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

// `import x from "<file>?url"` (Vite's asset URL): a wasm file (the LERC
// decoder's) is copied into generated/ and the import becomes its path on
// disk, which the decoder reads with fs in Node; any other file (the EPSG
// table the VRT reader fetches) becomes a data: URL, which Node's fetch reads.
const rootRequire = createRequire(here("../package.json"))
const assetUrls = {
  name: "asset-url",
  setup(b) {
    b.onResolve({ filter: /\?url$/ }, (args) => ({ path: rootRequire.resolve(args.path.replace(/\?url$/, "")), namespace: "asset-url" }))
    b.onLoad({ filter: /.*/, namespace: "asset-url" }, (args) => {
      if (!args.path.endsWith(".wasm")) return { contents: `export default ${JSON.stringify(`data:application/octet-stream;base64,${readFileSync(args.path).toString("base64")}`)}`, loader: "js" }
      copyFileSync(args.path, here(`./generated/${basename(args.path)}`))
      return { contents: `import { fileURLToPath, pathToFileURL } from "node:url"
export default fileURLToPath(new URL(${JSON.stringify(`./${basename(args.path)}`)}, import.meta.url))`, loader: "js" }
    })
  },
}

// The app's tile protocols, source readers and layer paints, for the tile
// service's direct engine (app-render.ts, app-sources.ts). maplibre-gl is
// replaced by a stub: the protocols only register themselves with it.
// BASE_URL is the deployed app: the VRT reader fetches its indexes (Open
// Buildings, Meta canopy height) from the app's own public folder.
await build({
  entryPoints: [here("./app-render.ts")],
  outfile: here("./generated/app-render.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node20",
  tsconfig: here("../tsconfig.json"),
  logLevel: "error",
  define: { "import.meta.env.BASE_URL": JSON.stringify("https://terrain-viewer.iconem.com/"), "import.meta.env": "{}" },
  alias: { "maplibre-gl": here("./maplibre-stub.mjs") },
  plugins: [assetUrls],
  loader: { ".gz": "empty", ".png": "empty", ".jpg": "empty", ".svg": "empty", ".css": "empty", ".mdx": "empty", ".wgsl": "text", ".glsl": "text" },
})

// Every URL parameter of the app with its type and default, for the direct
// engine to rebuild the app's state (docs/scripts/build-url-params.mjs
// writes it; tracked, so a fresh clone has it).
writeFileSync(here("./generated/url-params.json"), readFileSync(here("../docs/src/generated/url-params.json")))

const src = JSON.parse(readFileSync(here("../lib/custom-sources.json"), "utf8"))
const SPEC_FIELDS = ["url", "apiKey", "datum", "minzoom", "tileSize", "encoding", "cogViaTitiler", "titilerNodata", "nodataFloor", "nodataFill", "diffMinuendId", "diffSubtrahendId", "diffOffsetM", "redFactor", "greenFactor", "blueFactor", "baseShift"]
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]]))
// The built-in Worldwide Defaults (lib/terrain-sources.ts, read by Node's
// type stripping) and the library, one list of entries of the shared schema
// (lib/source-schema.ts): a source is listed, resolved and keyed the same
// way whichever it is.
const { BUILTIN_TERRAIN_SOURCES } = await import(pathToFileURL(here("../lib/terrain-sources.ts")).href)
const libraryEntries = src.SAMPLE_TERRAIN_SOURCES
  // Ids made on one machine (custom-<timestamp>) and project-only entries are not library datasets.
  .filter((s) => /^custom-[a-z]/.test(s.id))
const terrain = [...BUILTIN_TERRAIN_SOURCES, ...libraryEntries]
  // `tiles`: only for plain keyless Terrarium / Terrain-RGB pyramids, which
  // the in-chat map can draw itself. The fields after `infoUrl` are what the
  // app's tile spec reads (lib/terrain-tile-spec.ts): the tile service and
  // the elevation tools read every type through it (dem.mjs).
  .map((s) => ({ id: s.id, name: s.name, type: s.type, ...(s.section ? { section: s.section } : {}), tiles: (s.type === "terrarium" || s.type === "terrainrgb") && !s.apiKey && s.redFactor == null && s.baseShift == null && /^https:\/\//.test(s.url) ? s.url : null, maxzoom: s.maxzoom ?? null, bounds: s.bounds ?? null, resolutionM: s.resolutionM ?? null, description: s.description ?? "", infoUrl: s.infoUrl ?? "", ...pick(s, SPEC_FIELDS) }))

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
for (const f of ["../lib/terrain-sources.ts", "../lib/basemap-sources.ts", "../lib/historical-sources.ts", "../lib/historical-export-sources.ts", "../lib/timeline-catalogs.ts", "../lib/national-historical.ts", "../lib/linked-sources.ts", "../lib/wayback.ts", "../lib/ge-historical.ts", "../lib/google-timelapse.ts", "../components/TerrainControlPanel/raster-basemap-section.tsx"]) {
  // Comment lines and information links are documentation, not data.
  addUrls(readFileSync(here(f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/infoUrl|docs|href|licen[cs]e/i.test(l)).join("\n"))
}
writeFileSync(here("./generated/library.json"), JSON.stringify({ terrain, mapterhornBestResolutionM: src.MAPTERHORN_BEST_RESOLUTION_M, origins: [...origins].sort() }))
console.log(`generated: app-lib.mjs, library.json (${terrain.length} terrain datasets, ${origins.size} data hosts)`)
