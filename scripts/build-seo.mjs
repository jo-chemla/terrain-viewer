// Writes the root discovery files that search engines and AI agents look for
// at the domain root (not under /docs):
//   public/sitemap.xml  the app and every docs page
//   public/llms.txt     what the app is, how to build a link that opens a
//                       place in a given mode, and every docs page
// public/robots.txt is static and points at the sitemap.
//
// Run by `pnpm build` (and `pnpm run seo`); the outputs are committed so the
// dev server serves them too. Docs pages come from docs/content/docs/**/*.mdx
// frontmatter, so a new page shows up on the next build.

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SITE = "https://terrain-viewer.iconem.com"
const DOCS_DIR = "docs/content/docs"

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".mdx") ? [p] : []
  })
}

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const out = {}
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim()
  }
  return out
}

const pages = walk(DOCS_DIR).map((file) => {
  const slug = relative(DOCS_DIR, file).split(sep).join("/").replace(/\.mdx$/, "").replace(/(^|\/)index$/, "")
  const fm = frontmatter(readFileSync(file, "utf8"))
  return {
    slug,
    section: slug.includes("/") ? slug.split("/")[0] : "",
    url: `${SITE}/docs/${slug ? slug + "/" : ""}`,
    title: fm.title || slug,
    description: fm.description || "",
    lastmod: statSync(file).mtime.toISOString().slice(0, 10),
  }
}).sort((a, b) => a.slug.localeCompare(b.slug))

// ─── sitemap.xml ────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
${pages.map((p) => `  <url><loc>${esc(p.url)}</loc><lastmod>${p.lastmod}</lastmod></url>`).join("\n")}
</urlset>
`
writeFileSync("public/sitemap.xml", sitemap)

// ─── llms.txt ───────────────────────────────────────────────────────────────
const SECTION_TITLES = { "": "Overview", features: "Features", dev: "Developer documentation", resources: "Resources" }
const sections = [...new Set(pages.map((p) => p.section))]
const docsList = sections.map((sec) => {
  const lines = pages.filter((p) => p.section === sec).map((p) => `- [${p.title}](${p.url})${p.description ? `: ${p.description}` : ""}`)
  return `## ${SECTION_TITLES[sec] ?? sec}\n\n${lines.join("\n")}`
}).join("\n\n")

const llms = `# Terrain Viewer

> Free, open-source web viewer for elevation data (DEM, DTM, DSM, LiDAR) by Iconem, built on MapLibre GL JS. It shows terrain in 2D, 3D and on a globe with hillshade, hypsometric tint, contours, slope, aspect, curvature, local relief model, sky-view factor, openness, matcap and Phong lighting, compares sources side by side, and exports GeoTIFFs. It reads global terrain (Mapterhorn, AWS, Mapbox, MapTiler) and national LiDAR and open-data services, COG, VRT, WMS, ArcGIS LERC and Cesium quantized mesh, all in the browser.

Every setting lives in the URL, so a link opens a place in a given mode. To send someone to a view, build a URL on ${SITE}/ with query parameters. The full list, with types and defaults, is the OpenAPI description at ${SITE}/docs/openapi.json and the page ${SITE}/docs/dev/url-api/.

## Building a link

- Camera: \`lat\`, \`lng\`, \`zoom\`, \`pitch\`, \`bearing\`; \`viewMode\` is \`2d\`, \`3d\` or \`globe\`.
- Terrain source: \`terrainSourceA\`, for example \`mapterhorn\` (global, the default), \`aws\`, or a library id such as \`custom-mx-aguadafenix-lidar\`.
- Modes: \`showHillshade\`, \`showColorRelief\` (hypsometric tint), \`showContoursAndGraticules\` with \`showContours\`, \`showTerrainAnalysis\` with \`showSlope\`, \`showAspect\`, \`showCurvature\`, \`showReliefVisualization\` with \`showLrm\`, \`showSvf\`, \`showOpenness\`, \`showLightingEffects\` with \`showMatcap\`, \`showPhong\`, \`showRasterBasemap\`.
- Comparison: \`splitStyle\` (\`side-by-side\` or \`overlay\`) with \`terrainSourceB\`.

Examples:

- Slope around the Matterhorn in 3D: ${SITE}/?viewMode=3d&zoom=13&lat=45.9763&lng=7.6586&pitch=55&showTerrainAnalysis=true&showSlope=true
- Contours over a Maya LiDAR survey: ${SITE}/?viewMode=2d&zoom=15&lat=17.7338&lng=-91.2886&terrainSourceA=custom-mx-aguadafenix-lidar&showContoursAndGraticules=true&showContours=true&showHillshade=true
- Hillshade and sky-view factor anywhere: ${SITE}/?zoom=12&lat=<lat>&lng=<lng>&showHillshade=true&showReliefVisualization=true&showSvf=true

## Skill

Agents that support skills can install one that does this for them: \`npx skills add Iconem/terrain-viewer\` (source: https://github.com/Iconem/terrain-viewer/blob/main/skills/terrain-viewer/SKILL.md).

${docsList}

## Optional

- [All documentation in one file](${SITE}/docs/llms-full.txt)
- [Documentation index for agents](${SITE}/docs/llms.txt)
- [Source code](https://github.com/Iconem/terrain-viewer)
`
writeFileSync("public/llms.txt", llms)
console.log(`seo: sitemap.xml and llms.txt with ${pages.length} docs pages`)
