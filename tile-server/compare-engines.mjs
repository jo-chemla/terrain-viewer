// Compares the tile service's two engines tile by tile: the same z/x/y and
// parameters drawn by the direct engine and by the app in the browser.
//   node compare-engines.mjs [service] [outDir] [case filter, a regex] [sources]
// service: a running tile service (default http://localhost:3400). sources:
// terrain sources each at a place it covers, `id@lat,lng,zoom` separated by
// `;` (e.g. `custom-us-hi-dtm1-lerc@19.41,-155.28,14`), in place of
// Mapterhorn at the Matterhorn and in Paris. Writes
// a table (report.md, report.json) and, per case, the two tiles side by
// side with their difference (×4) in outDir.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import sharp from "sharp"

const SERVICE = (process.argv[2] || "http://localhost:3400").replace(/\/$/, "")
const OUT = process.argv[3] || "compare-out"
const FILTER = process.argv[4] ? new RegExp(process.argv[4], "i") : null
const SOURCES = process.argv[5] ? process.argv[5].split(";").filter(Boolean).map((s) => { const [id, at] = s.split("@"); return [id, at.split(",").map(Number)] }) : null
mkdirSync(OUT, { recursive: true })

const tileOf = (lat, lng, z) => {
  const n = 2 ** z, r = (lat * Math.PI) / 180
  return [z, Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)]
}
// place name -> [z, x, y, terrainSource]
const PLACES = SOURCES ? Object.fromEntries(SOURCES.map(([id, [lat, lng, z]]) => [id, [...tileOf(lat, lng, z), id]])) : {
  matterhorn: tileOf(45.9766, 7.6585, 12),
  paris: tileOf(48.8606, 2.3376, 14),
}

// [name, query]. Contour labels are left out (showContourLabels=false is
// added to every case with contours): they are placed and drawn differently
// from MapLibre's collision and curved text, and not measured.
const CASES = [
  ["hillshade (combined, default)", "modes=hillshade"],
  ["hillshade standard", "modes=hillshade&hillshadeMethod=standard"],
  ["hillshade igor", "modes=hillshade&hillshadeMethod=igor"],
  ["hillshade basic, light 200/30", "modes=hillshade&hillshadeMethod=basic&illuminationDir=200&illuminationAlt=30"],
  ["hillshade combined, exaggeration 0.6, coloured", "modes=hillshade&hillshadeExag=0.6&shadowColor=%23402010&highlightColor=%23fff0c0"],
  ["hillshade multidir-colors", "modes=hillshade&hillshadeMethod=multidir-colors"],
  ["hillshade duotone-nw-ne", "modes=hillshade&hillshadeMethod=duotone-nw-ne"],
  ["hillshade aspect-multidir", "modes=hillshade&hillshadeMethod=aspect-multidir"],
  ["colour relief (default)", "modes=colorRelief"],
  ["colour relief dem_screen 300-4500, opaque", "modes=colorRelief&colorRamp=dem_screen&customHypsoMinMax=true&minElevation=300&maxElevation=4500&colorReliefOpacity=1"],
  ["slope", "modes=slope"],
  ["slope 0-45 inverted", "modes=slope&slopeMaxDegrees=45&slopeInvertColorRamp=true"],
  ["aspect", "modes=aspect"],
  ["TRI", "modes=tri"],
  ["curvature", "modes=curvature"],
  ["TPI", "modes=tpi"],
  ["roughness", "modes=roughness"],
  ["shape index", "modes=shapeIndex"],
  ["blobness", "modes=blobness"],
  ["eigen ratio", "modes=eigenRatio"],
  ["orientation", "modes=orientation"],
  ["LRM", "modes=lrm"],
  ["LRM radius 32", "modes=lrm&lrmRadius=32"],
  ["sky-view factor", "modes=svf"],
  ["openness", "modes=openness"],
  ["local dominance", "modes=localDominance"],
  ["contours", "modes=contours"],
  ["contours 20/100", "modes=contours&contourMinor=20&contourMajor=100"],
  ["matcap (live renderer in the app)", "modes=matcap"],
  ["matcap, raster renderer", "modes=matcap&matcapRenderer=raster"],
  ["phong (live renderer in the app)", "modes=phong"],
  ["phong, raster renderer", "modes=phong&phongRenderer=raster"],
  ["cast shadows", "modes=shadows"],
  ["cast shadows, sun at 15 degrees", "modes=shadows&illuminationAlt=15"],
  ["phong, rim light 0.6, two lights", "modes=phong&phongFresnelStrength=0.6&phongLightCount=2"],
  ["hillshade + colour relief + contours", "modes=hillshade,colorRelief,contours"],
  ["slope + hillshade", "modes=slope,hillshade"],
  ["LRM + sky-view factor + hillshade", "modes=lrm,svf,hillshade"],
  ["contours of the local relief model", "modes=contours&contourReferenceMode=lrm"],
  ["iso-line, slope 30 degrees", "modes=isoline"],
  ["iso-line, slope 30 with fill and cliff teeth", "modes=isoline&isolineFill=true&isolineCliff=true"],
  ["iso-line, slope every 10 degrees", "modes=isoline&isolineMode=interval"],
  ["iso-line, elevation every 50 m", "modes=isoline&isolineMode=interval&isolineMeasure=elevation&isolineInterval=50"],
  ["graticules", "modes=graticules,hillshade"],
  ["plane slicer at 2800 m", "modes=planeSlicer,hillshade&planeSlicerValue=2800"],
  ["plane slicer, local relief above 0", "modes=planeSlicer,hillshade&planeSlicerReferenceMode=lrm"],
  ["mound detector", "modes=moundDetector,hillshade"],
  ["dark theme, hillshade + contours", "modes=hillshade,contours&theme=dark"],
]

async function get(url) {
  const t0 = Date.now()
  const r = await fetch(url)
  const body = Buffer.from(await r.arrayBuffer())
  return { ok: r.ok, status: r.status, engine: r.headers.get("x-tv-engine"), why: r.headers.get("x-tv-engine-why"), body, ms: Date.now() - t0 }
}
const raw = async (png) => (await sharp(png).flatten({ background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true }))

const rows = []
for (const [place, [z, x, y, source]] of Object.entries(PLACES)) {
  for (const scale of ["", "@2x"]) {
    for (let [name, q] of CASES.filter(([n]) => !FILTER || FILTER.test(n))) {
      if (/modes=[^&]*contours/.test(q) && !q.includes("showContourLabels")) q += "&showContourLabels=false"
      const addr = `${SERVICE}/tiles/${z}/${x}/${y}${scale}.png?${q}${source ? `&terrainSource=${encodeURIComponent(source)}` : ""}`
      const d = await get(`${addr}&engine=direct`)
      const b = await get(`${addr}&engine=browser`)
      const row = { place, tile: `${z}/${x}/${y}${scale}`, name, query: q, directMs: d.ms, browserMs: b.ms }
      row.directEngine = d.engine
      if (d.engine && d.engine !== "direct") row.why = d.why
      if (!d.ok || !b.ok) { row.error = !d.ok ? `direct ${d.status}: ${d.body.toString().slice(0, 120)}` : `browser ${b.status}`; rows.push(row); console.log(place, scale, name, row.error); continue }
      const A = await raw(d.body), B = await raw(b.body)
      const n = A.info.width * A.info.height
      let sum = 0, big = 0
      const diff = Buffer.alloc(n * 3)
      for (let i = 0; i < n; i++) {
        let m = 0
        for (let c = 0; c < 3; c++) { const v = Math.abs(A.data[i * 3 + c] - B.data[i * 3 + c]); sum += v; m = Math.max(m, v); diff[i * 3 + c] = Math.min(255, v * 4) }
        if (m > 24) big++
      }
      row.meanDiff = +(sum / (n * 3)).toFixed(2)
      row.pctOver24 = +((100 * big) / n).toFixed(2)
      rows.push(row)
      const w = A.info.width
      const slug = `${place}${scale ? "-2x" : ""}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`
      await sharp({ create: { width: w * 3 + 8, height: w, channels: 3, background: "#ff0000" } })
        .composite([{ input: A.data, raw: { width: w, height: w, channels: 3 }, left: 0, top: 0 }, { input: B.data, raw: { width: w, height: w, channels: 3 }, left: w + 4, top: 0 }, { input: diff, raw: { width: w, height: w, channels: 3 }, left: 2 * w + 8, top: 0 }])
        .png().toFile(path.join(OUT, slug + ".png"))
      console.log(place.padEnd(10), (scale || "1x").padEnd(4), name.padEnd(46), "mean", String(row.meanDiff).padStart(6), " >24:", String(row.pctOver24).padStart(6), "%", ` direct ${d.ms} ms, browser ${b.ms} ms`)
    }
  }
}
writeFileSync(path.join(OUT, "report.json"), JSON.stringify(rows, null, 2))
const md = ["| Place | Tile | Case | Mean difference (0-255) | Pixels off by more than 24 | Direct | Browser |", "|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.place} | ${r.tile} | ${r.name} | ${r.error ? r.error : r.meanDiff} | ${r.error ? "" : r.pctOver24 + " %"} | ${r.directMs} ms | ${r.browserMs} ms |`)]
writeFileSync(path.join(OUT, "report.md"), md.join("\n") + "\n")
console.log("wrote", path.join(OUT, "report.md"))
