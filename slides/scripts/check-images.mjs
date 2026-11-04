// Every docs page and every deck opened in Chrome, every image request that
// fails or answers 4xx/5xx listed. Pages: docs/out/**/index.html (build the
// docs first) plus the decks. playwright-core is this workspace's own
// devDependency; channel "chrome" needs no bundled browser.
//   node slides/scripts/check-images.mjs [http://localhost:5173]
import { chromium } from "playwright-core"
import { readdirSync, existsSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const origin = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "")
const pages = []
const walk = (dir) => { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p); else if (e === "index.html") pages.push("/docs/" + relative(join(root, "docs", "out"), dir).replaceAll("\\", "/").replace(/^\.$/, "") ) } }
walk(join(root, "docs", "out"))
for (const deck of readdirSync(join(root, "slides", "slides"))) if (existsSync(join(root, "slides", "slides", deck, "index.tsx"))) pages.push(`/docs/slides/s/${deck}/`)

const browser = await chromium.launch({ channel: "chrome", headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const bad = []
let images = 0
page.on("requestfailed", (r) => { if (r.resourceType() === "image") bad.push([page.url(), r.url(), r.failure()?.errorText]) })
page.on("response", (r) => { if (r.request().resourceType() === "image") { images++; if (r.status() >= 400) bad.push([page.url(), r.url(), r.status()]) } })
for (const path of pages) {
  const url = origin + path.replace(/([^/])$/, "$1/")
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    // lazy images: scroll through the page, and over the slides of a deck
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) } })
    if (path.includes("/slides/")) for (let i = 0; i < 40; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(80) }
    await page.waitForLoadState("networkidle")
  } catch (e) { bad.push([url, "(page)", e.message.split("\n")[0]]) }
}
await browser.close()
console.log(`${pages.length} pages, ${images} image responses, ${bad.length} failures`)
for (const b of bad) console.log("  " + b.join("  "))
process.exitCode = bad.length ? 1 : 0
