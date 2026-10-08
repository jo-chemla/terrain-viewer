// The title slide of every deck as a JPEG for the docs (the Slide decks page's
// table, the changelog): docs/public/screenshots/slides/<deck>-title.jpg,
// 960 px wide. Reads the static site, so build or serve it first:
//   pnpm slides:static            (serves http://localhost:4180/docs/slides/)
//   node slides/scripts/title-shots.mjs [http://localhost:4180/docs/slides/]
// playwright-core is the slides workspace's own devDependency (the PDF export uses it); channel "chrome" needs no bundled browser.
import { chromium } from "playwright-core"
import { existsSync, readdirSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const base = (process.argv[2] ?? "http://localhost:4180/docs/slides/").replace(/\/?$/, "/")
const outDir = join(root, "..", "docs", "public", "screenshots", "slides")
mkdirSync(outDir, { recursive: true })
const decks = readdirSync(join(root, "slides")).filter((d) => existsSync(join(root, "slides", d, "index.tsx")))

const browser = await chromium.launch({ channel: "chrome", headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
for (const deck of decks) {
  await page.goto(`${base}s/${deck}/`, { waitUntil: "networkidle" })
  // Play mode fills the viewport with the page alone (no thumbnails, no toolbar).
  await page.keyboard.press("f")
  await page.waitForTimeout(1500)
  await page.evaluate(() => document.fonts.ready)
  const shot = await page.screenshot({ type: "jpeg", quality: 85 })
  // 960 px wide: drawn on a canvas in the page, then saved.
  const scaled = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/jpeg;base64," + b64; await img.decode()
    const c = document.createElement("canvas"); c.width = 960; c.height = 540
    c.getContext("2d").drawImage(img, 0, 0, 960, 540)
    return c.toDataURL("image/jpeg", 0.85).split(",")[1]
  }, shot.toString("base64"))
  const file = join(outDir, `${deck}-title.jpg`)
  await import("node:fs/promises").then((fs) => fs.writeFile(file, Buffer.from(scaled, "base64")))
  console.log(`${deck}: ${file}`)
  await page.keyboard.press("Escape")
}
await browser.close()
