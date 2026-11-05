#!/usr/bin/env node
// Re-captures the two Export screenshots of /docs/features/export-and-share:
// the Download and Snapshot section, and the Export layers dialog. Same
// subject and camera as the visualization-mode cards (the Matterhorn in plan
// view, see capture-viz-mode-cards.mjs), same 3840x2160 JPEG convention.
// Read .claude/memory/screenshots-context.md before changing anything here.
//
// Playwright is not a repo dependency. Either the throwaway install the memory
// note describes, or the slides' own playwright-core with the installed Chrome:
//
//   PW="$PWD/slides/node_modules/playwright-core" CHANNEL=chrome \
//     node docs/scripts/capture-export-shots.mjs --base http://localhost:5173
//   ... --only download-section        # one of the two
//
// Prod is the default base; pass the dev server for unreleased UI. SVF and
// Openness stay off: they can hang headless (same memory note).

import { mkdirSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require_ = createRequire(import.meta.url)
const { chromium } = require_(process.env.PW ?? "playwright")

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, "../public/screenshots/export-share")
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const BASE = argOf("--base", "https://terrain-viewer.iconem.com/")
const ONLY = (argOf("--only", "") || "").split(",").filter(Boolean)

const PLAN = { lat: 45.9763, lng: 7.6586, zoom: 12.6, pitch: 0, bearing: 0, viewMode: "3d", exaggeration: 1 }
const OFF = {
  showHillshade: false, showColorRelief: false, showContoursAndGraticules: false, showContours: false,
  showRasterBasemap: false, showShadows: false, showTerrainAnalysis: false, showSlope: false,
  showAspect: false, showCurvature: false, showTpi: false, showReliefVisualization: false,
  showLrm: false, showSvf: false, showOpenness: false, showLightingEffects: false,
  showMatcap: false, showPhong: false,
}
const HILLSHADE_HYPSO = { showHillshade: true, showColorRelief: true }

const SECTIONS = {
  general: false, comparisonMix: false, visualizationModes: false, download: true, bookmarks: false,
  terrainSource: false, hillshade: false, lightingEffects: false, hypsometricTint: false,
  terrainAnalysis: false, reliefVisualization: false, tellsDetector: false, rasterBasemap: false,
  contour: false, background: false, drawing: false, elevationPicker: false, sunShadowCalculator: false,
  animation: false, sourceInfo: false, footer: false,
}

const SHOTS = [
  { file: "download-section.jpg", state: HILLSHADE_HYPSO },
  {
    file: "export-layers-dialog.jpg",
    state: { ...HILLSHADE_HYPSO, showTerrainAnalysis: true, showSlope: true, showCurvature: true, showReliefVisualization: true, showLrm: true },
    prepare: async (page) => {
      await page.locator("#tour-download-section").getByRole("button", { name: "Layers", exact: true }).click()
      await page.getByRole("dialog").waitFor({ timeout: 10000 })
      await page.waitForTimeout(2500)
    },
  },
]

const urlFor = (shot) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...OFF, ...PLAN, ...shot.state })) q.set(k, String(v))
  q.set("matcapRenderer", "raster")
  return `${BASE.replace(/\/+$/, "")}/?${q}`
}

mkdirSync(OUT_DIR, { recursive: true })
const todo = SHOTS.filter((s) => !ONLY.length || ONLY.some((o) => s.file.startsWith(o)))
console.log(`${todo.length} shots -> ${OUT_DIR}\n  base ${BASE}`)

let ok = 0
for (const shot of todo) {
  // A fresh browser per shot: reusing one leaks WebGL contexts.
  const browser = await chromium.launch(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {})
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
    // A dev server may hold a Planet key from .env: nothing here may spend it.
    await page.route(/planet\.com/, (route) => route.abort())
    await page.addInitScript((sections) => {
      localStorage.setItem("hasSeenTour", "true")
      localStorage.setItem("isSidebarOpen", "true")
      localStorage.setItem("sectionOpen", JSON.stringify(sections))
    }, SECTIONS)
    try { await page.goto(urlFor(shot), { waitUntil: "load", timeout: 90000 }) } catch { /* settle anyway */ }
    await page.waitForTimeout(18000)
    // The dev server's devtools badge (bottom right) is not part of the app.
    // Done before any dialog opens: portals are body children too.
    // Dev-only tools are not part of the app: react-scan's toolbar and the
    // devtools badge hang off <html> and <body>, outside #root. Hidden with
    // a rule rather than per element, before any dialog opens (portals are
    // body children too, and are not divs present at this point).
    await page.evaluate(() => {
      for (const el of [...document.documentElement.children, ...document.body.children]) {
        if (el.tagName === "HEAD" || el.tagName === "BODY" || el.id === "root" || el.tagName === "SCRIPT" || el.tagName === "STYLE") continue
        el.style.display = "none"
      }
    })
    if (shot.prepare) await shot.prepare(page)
    await page.screenshot({ path: join(OUT_DIR, shot.file), type: "jpeg", quality: 92 })
    console.log(`  ok  ${shot.file}`)
    ok++
  } catch (err) {
    console.error(`  FAIL ${shot.file}: ${String(err.message).slice(0, 200)}`)
  } finally {
    await browser.close()
  }
}
console.log(`${ok}/${todo.length} captured`)
process.exit(ok === todo.length ? 0 : 1)
