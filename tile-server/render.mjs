// The renderer: the app opened in a headless browser, waited on until its
// maps have drawn everything. The base block of the MCP server's pictures
// (mcp/tools.mjs) and of the tile service (server.mjs); it knows neither.
//
// Environment: CHROME_PATH (a Chromium binary; unset: the installed Chrome,
// else the installed Edge),
// TV_SOFTWARE_GL=1 (no graphics card: SwiftShader), TV_TIMING (lap times).

let browserPromise
export async function browser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright-core")
      // The machine's GPU when there is one (several times faster on the
      // heavy modes); TV_SOFTWARE_GL=1 forces software rendering, for a
      // container without one.
      const args = process.env.TV_SOFTWARE_GL ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars"] : ["--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"]
      const exe = process.env.CHROME_PATH
      // CHROME_PATH for a container's Chromium; else an installed Chrome,
      // else an installed Edge (on every Windows), else a clear refusal: the
      // direct engine does not need a browser, only the views it hands over.
      if (exe) return chromium.launch({ executablePath: exe, args })
      try { return await chromium.launch({ channel: "chrome", args }) } catch (chrome) {
        try { return await chromium.launch({ channel: "msedge", args }) } catch {
          throw Object.assign(new Error(`No Chrome or Edge found: this view needs the browser engine (3D, tilted, rotated or split views, and the sources or modes the direct engine does not draw). Install Google Chrome or Microsoft Edge, or set CHROME_PATH to a Chromium. (${String(chrome?.message ?? chrome).split(/\r?\n/)[0]})`), { status: 501 })
        }
      }
    })().catch((e) => { browserPromise = undefined; throw e })
  }
  return browserPromise
}

// One browser context for every render: its HTTP cache keeps the app's
// bundle and the tiles, so a second picture of the same place is quick.
// Nothing else carries over, the storage is emptied before each page runs
// (withSettledPage).
let contextPromise
async function context() {
  if (!contextPromise) {
    contextPromise = (async () => {
      return (await browser()).newContext({ deviceScaleFactor: 1 })
    })().catch((e) => { contextPromise = undefined; throw e })
  }
  return contextPromise
}

/** Opens the app at `url` in a page of the given size, waits until its maps
 *  have drawn everything, hides the interface, then hands the page to `use`.
 *  `bare` hides everything but the map itself (for a tile: no scale, no
 *  credits, no pills). `keys`: { mapboxKey, maptilerKey, cesiumIonKey }. */
export async function withSettledPage(url, { width, height, waitMs = 0, bare = false, keys = {} }, use) {
  const ctx = await context()
  const page = await ctx.newPage()
  // A clean storage: no first-visit walkthrough over the map, the mound
  // detector's beta switched on, and the API keys of the request, if any
  // (mapboxKey, maptilerKey, cesiumIonKey: the app's settings, never its URL).
  await page.addInitScript((keys) => {
    try {
      localStorage.clear()
      localStorage.setItem("hasSeenTour", "true")
      localStorage.setItem("betaEnabled", JSON.stringify({ tells: true, georef: false }))
      for (const [k, v] of Object.entries(keys)) if (v) localStorage.setItem(k, JSON.stringify(v))
    } catch { }
  }, keys)
  await page.setViewportSize({ width, height })
  // Done when tile and data requests have stopped for a moment. Playwright's
  // "networkidle" never comes here (long-lived requests keep it busy), so
  // every render waited out the full timeout.
  let inFlight = 0, lastActivity = Date.now()
  // Not what the picture is made of: imagery-date metadata the app polls for
  // its attribution, analytics.
  const BACKGROUND = /World_Imagery_Metadata|metadata\.maptiles|umami|plausible|analytics|sentry/i
  const counted = (r) => ["fetch", "xhr", "image"].includes(r.resourceType()) && !BACKGROUND.test(r.url())
  const tStart = Date.now()
  page.on("request", (r) => { if (counted(r)) { inFlight++; lastActivity = Date.now(); if (process.env.TV_TIMING && Date.now() - tStart > 7000) console.error("  late", Date.now() - tStart, r.url().slice(0, 110)) } })
  const done = (r) => { if (counted(r)) { inFlight = Math.max(0, inFlight - 1); lastActivity = Date.now() } }
  page.on("requestfinished", done); page.on("requestfailed", done)
  // The app says when its maps have drawn everything (window.__tvBusy and
  // __tvIdleSeen, components/TerrainViewer.tsx): then the picture is taken
  // as soon as the network has also been still for a moment. Without the
  // signal (an older deployment), a longer silence and a pause.
  const settled = () => page.evaluate(() => window.__tvIdleSeen === true && window.__tvBusy?.size === 0).catch(() => false)
  const quiet = async (idleMs = 1500, maxMs = 25000) => {
    const t0 = Date.now()
    // In-flight requests older than 6 s do not hold the picture back.
    while (Date.now() - t0 < maxMs) {
      const idle = Date.now() - lastActivity
      if (inFlight === 0 && idle >= 400 && await settled()) {
        // Twice, 600 ms apart: a layer that adds its source once the map
        // is ready (the contours, after their worker is set up) starts
        // loading only after the first idle.
        await page.waitForTimeout(600)
        if (inFlight === 0 && Date.now() - lastActivity >= 400 && await settled()) return true
        continue
      }
      if ((inFlight === 0 && idle >= idleMs) || idle >= 6000) return false
      await page.waitForTimeout(100)
    }
    return false
  }
  try {
    const T = Date.now(); const lap = (n) => process.env.TV_TIMING && console.error(n, Date.now() - T, "inflight", inFlight)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); lap("goto")
    await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 30000 }); lap("canvas")
    // Tiles keep arriving for a while: wait for the network to go quiet,
    // with a ceiling, then let the map draw.
    const exact = await quiet(); lap(exact ? "settled" : "quiet")
    await page.evaluate(() => { for (const b of document.querySelectorAll("button")) if (b.textContent?.trim() === "Skip") b.click() }).catch(() => { })
    // The picture is of the map, not of the interface: no search box, zoom,
    // compass, locate or full-screen buttons, no panel or minimap toggles,
    // no split handle. What says something about the image stays: the
    // scale, the credits, date pills, an open minimap, timeline or profile.
    await page.addStyleTag({ content: `
      .maplibregl-ctrl-top-left > *, .maplibregl-ctrl-top-right > *, [data-picture-hide], [data-snapshot-ignore],
      .rounded-md:has(> * > [data-picture-hide="minimap"]) { display: none !important }
      .maplibregl-ctrl-top-left > .maplibregl-ctrl-scale, .maplibregl-ctrl-top-right > .maplibregl-ctrl-scale { display: block !important }
    ` }).catch(() => { })
    // Two frames for the last tiles to reach the screen, or the old pause.
    if (bare) {
      // Only the largest map canvas stays visible: a child may be visible
      // inside hidden parents.
      await page.addStyleTag({ content: `body, body * { visibility: hidden !important } canvas[data-tile-shot] { visibility: visible !important }` }).catch(() => { })
      await page.evaluate(() => {
        const all = [...document.querySelectorAll("canvas.maplibregl-canvas")]
        all.sort((a, b) => b.width * b.height - a.width * a.height)
        all[0]?.setAttribute("data-tile-shot", "")
      })
    }
    await page.waitForTimeout((exact ? 250 : 1200) + waitMs)
    return await use(page, { exact })
  } finally { await page.close().catch(() => { }) }
}

export async function closeBrowser() { contextPromise = undefined; if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = undefined; await b?.close() } }
