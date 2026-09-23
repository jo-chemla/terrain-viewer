#!/usr/bin/env node
// Re-captures the Data layers modal's card screenshots, all over the same
// place with the same camera, so the cards read as one set.
//
// The existing docs screenshots were taken one at a time over whatever the
// page they illustrate happened to be about - a 3D oblique of the Alps for
// hillshade, a flat valley somewhere else for openness. Fine on a docs page
// with a caption; useless as a grid of cards, where the only thing a reader
// can compare is the rendering, and they are comparing two different places
// instead. So: one subject, one camera, one flag changed per shot.
//
// The subject is the Matterhorn / Mont Cervin - a shape almost anyone can
// recognise at thumbnail size, which is the whole job of these images.
//
// Not a repo dependency: Playwright is installed throwaway, exactly as
// .claude/memory/screenshots-context.md describes. Read that file before
// changing anything here - it carries the hard-won bits (a FRESH browser per
// shot or WebGL contexts leak and shots come back blank; matcapRenderer must
// be "raster" headless; SVF/Openness can hang forever headless).
//
//   npm --prefix /tmp/pw-tv install playwright@1.48
//   NODE_PATH=/tmp/pw-tv/node_modules node docs/scripts/capture-viz-mode-cards.mjs
//   ... --only hillshade,hypso        # a subset
//   ... --base http://localhost:5173  # unreleased UI; prod is the default

import { mkdirSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require_ = createRequire(import.meta.url)
const { chromium } = require_(process.env.PW ?? "playwright")

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, "../public/screenshots/viz-modes")
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const BASE = argOf("--base", "https://terrain-viewer.iconem.com/")
const ONLY = (argOf("--only", "") || "").split(",").filter(Boolean)

// The docs' own capture parameters, verbatim - every link under a viz-mode
// screenshot on /docs/features/visualization-modes carries them, and the
// pre-existing cards (slope, curvature, TPI, LRM...) were shot with exactly
// this. Matching it is what makes a new card sit next to an old one without
// the massif jumping. Note viewMode=3d with pitch 0: that is what "2D" means
// in those shots - a plan view of the 3D scene, not the 2D renderer.
const PLAN = { lat: 45.9763, lng: 7.6586, zoom: 12.6, pitch: 0, bearing: 0, viewMode: "3d", exaggeration: 1 }
// The docs' oblique, used by their hillshade and hypso pages.
const OBLIQUE = { ...PLAN, pitch: 60, bearing: -20 }
const VIEW_2D = PLAN
const VIEW_3D = OBLIQUE

/** Every flag that any shot turns on, so each shot can state only its own. */
const OFF = {
  showHillshade: false, showColorRelief: false, showContoursAndGraticules: false, showContours: false,
  showRasterBasemap: false, showShadows: false, showTerrainAnalysis: false, showSlope: false,
  showAspect: false, showCurvature: false, showTpi: false, showReliefVisualization: false,
  showLrm: false, showSvf: false, showOpenness: false, showLightingEffects: false,
  showMatcap: false, showPhong: false,
}

const SHOTS = [
  // ── Base ───────────────────────────────────────────────────────────────
  // Plan view, as asked: the point of a hillshade card is the shading itself.
  { file: "hillshade.jpg", view: PLAN, state: { showHillshade: true, hillshadeOpacity: 1 } },
  // The docs' hypso parameters exactly (ramp, bounds, opacities), only with
  // the plan-view camera instead of their oblique. Two earlier attempts with
  // an invented range came out single-hued; these are the values that work.
  { file: "hypso.jpg", view: PLAN, state: { showHillshade: true, showColorRelief: true, hillshadeOpacity: 0.6, colorRamp: "tv-a", hypsoSliderMaxBound: 4230, maxElevation: 8620, minElevation: 1450, colorReliefOpacity: 0.9, hypsoSliderMinBound: 90 } },
  { file: "contours.jpg", view: VIEW_2D, state: { showContoursAndGraticules: true, showContours: true, showHillshade: true, hillshadeOpacity: 0.35 } },
  // Replaces osm-liberty-3d.jpg on the "Basemap imagery" card, which was a
  // vector style over an unrelated overlay in Nepal.
  { file: "basemap.jpg", view: PLAN, state: { showRasterBasemap: true, rasterBasemapOpacity: 1 } },
  // ── Terrain analysis ───────────────────────────────────────────────────
  { file: "slope.jpg", view: VIEW_2D, state: { showTerrainAnalysis: true, showSlope: true } },
  // Aspect stays 3D: its whole content is which way a face turns, which an
  // oblique shows and a plan view flattens.
  // The old aspect-multidir.jpg was a split view over Patagonia; this is the
  // same massif as everything else, oblique because aspect IS which way a
  // face turns.
  { file: "aspect-multidir.jpg", view: OBLIQUE, state: { showAspect: true, showTerrainAnalysis: true, showHillshade: true, hillshadeOpacity: 0.5 } },
  { file: "curvature.jpg", view: VIEW_2D, state: { showTerrainAnalysis: true, showCurvature: true } },
  { file: "tpi.jpg", view: VIEW_2D, state: { showTerrainAnalysis: true, showTpi: true } },
  // ── Relief visualization ───────────────────────────────────────────────
  { file: "lrm.jpg", view: VIEW_2D, state: { showReliefVisualization: true, showLrm: true } },
  // SVF and Openness are known to hang at "Computing... (0/16 tiles)" under
  // headless Chromium (see the memory note). Kept in the list so a future run
  // with real Chrome picks them up; expect them to fail here.
  { file: "svf.jpg", view: VIEW_2D, state: { showReliefVisualization: true, showSvf: true }, flaky: true },
  { file: "openness.jpg", view: VIEW_2D, state: { showReliefVisualization: true, showOpenness: true }, flaky: true },
  // ── Light ──────────────────────────────────────────────────────────────
  { file: "matcap.jpg", view: VIEW_3D, state: { showLightingEffects: true, showMatcap: true } },
  { file: "phong.jpg", view: VIEW_3D, state: { showLightingEffects: true, showPhong: true } },
  { file: "hard-shadows.jpg", view: VIEW_3D, state: { showShadows: true, showHillshade: true, hillshadeOpacity: 0.6 } },
]

const SECTION_DEFAULTS = {
  general: true, comparisonMix: false, visualizationModes: true, download: false, bookmarks: false,
  terrainSource: false, hillshade: false, lightingEffects: false, hypsometricTint: false,
  terrainAnalysis: false, reliefVisualization: false, tellsDetector: false, rasterBasemap: false,
  contour: false, background: false, drawing: false, elevationPicker: false, sunShadowCalculator: false,
  animation: false, sourceInfo: false, footer: false,
}

const urlFor = (shot) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...OFF, ...shot.view, ...shot.state })) q.set(k, String(v))
  // Live matcap renders blank headless; raster is the documented workaround.
  q.set("matcapRenderer", "raster")
  return `${BASE.replace(/\/+$/, "")}/?${q}`
}

mkdirSync(OUT_DIR, { recursive: true })
const todo = SHOTS.filter((s) => !ONLY.length || ONLY.some((o) => s.file.startsWith(o)))
console.log(`${todo.length} shots -> ${OUT_DIR}\n  base ${BASE}`)

let ok = 0
for (const shot of todo) {
  // A FRESH browser per shot: reusing one leaks WebGL contexts and shots come
  // back intermittently blank partway through a batch.
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
    await page.addInitScript((sections) => {
      localStorage.setItem("hasSeenTour", "true")
      localStorage.setItem("isSidebarOpen", "true")
      localStorage.setItem("sectionOpen", JSON.stringify(sections))
      localStorage.setItem("vizModePinned", "true")
    }, { ...SECTION_DEFAULTS, ...(shot.sections ?? {}) })
    // "load", not "networkidle": some background polling never goes idle.
    try { await page.goto(urlFor(shot), { waitUntil: "load", timeout: 60000 }) } catch { /* settle anyway */ }
    await page.waitForTimeout(shot.flaky ? 45000 : 14000)
    if (shot.prepare) { try { await shot.prepare(page) } catch (e) { console.warn(`  ..  ${shot.file}: prepare failed (${String(e.message).slice(0, 80)})`) } }
    await page.screenshot({ path: join(OUT_DIR, shot.file), type: "jpeg", quality: 92 })
    console.log(`  ok  ${shot.file}`)
    ok++
  } catch (err) {
    console.error(`  FAIL ${shot.file}: ${String(err.message).slice(0, 140)}`)
  } finally {
    await browser.close()
  }
}
console.log(`${ok}/${todo.length} captured. Now: node docs/scripts/build-screenshot-thumbs.mjs --force`)
