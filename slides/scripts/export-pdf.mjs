// Every deck as a PDF, one page per slide at 1920×1080, from a built site
// served locally (or any base URL): the deck in present mode, each page
// printed to a PDF, the pages joined with pdf-lib. Used by the docs deploy
// (dist/slides/<deck>.pdf) and by hand:
//   node scripts/export-pdf.mjs [baseUrl] [outDir]
import { chromium } from "playwright-core"
import { PDFDocument } from "pdf-lib"
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"

const root = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
const base = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "")
const outDir = process.argv[3] ?? join(root, "dist")
mkdirSync(outDir, { recursive: true })
const decks = readdirSync(join(root, "slides")).filter((d) => d !== "getting-started" && existsSync(join(root, "slides", d, "index.tsx")))

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, channel: process.env.CHROME_PATH ? undefined : "chromium" })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
for (const deck of decks) {
  await page.goto(`${base}/s/${deck}`, { waitUntil: "load" })
  await page.waitForFunction(() => !/LOADING ASSETS/.test(document.body.innerText), null, { timeout: 120000 })
  await page.keyboard.press("f") // present mode: the slide fills the window
  await page.waitForTimeout(800)
  const count = await page.evaluate(() => { const m = document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/); return m ? Number(m[2]) : 1 })
  const pdf = await PDFDocument.create()
  for (let i = 0; i < count; i++) {
    await page.waitForTimeout(400)
    const bytes = await page.pdf({ width: "1920px", height: "1080px", printBackground: true, pageRanges: "1" })
    const one = await PDFDocument.load(bytes)
    const [p] = await pdf.copyPages(one, [0])
    pdf.addPage(p)
    await page.keyboard.press("ArrowRight")
  }
  const file = join(outDir, `${deck}.pdf`)
  writeFileSync(file, await pdf.save())
  console.log(`${deck}: ${count} pages -> ${file}`)
}
await browser.close()
