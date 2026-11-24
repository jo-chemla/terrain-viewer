// The web app's "Open in" URLs, for test_open_in.py: reads
// OPEN_IN_DESTINATIONS out of open-in-links.tsx (the array is plain
// JavaScript apart from its type annotation), evaluates it with a fixed clock,
// and prints every destination's URL for each camera given as JSON on argv.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const src = readFileSync(fileURLToPath(new URL("../components/TerrainControlPanel/open-in-links.tsx", import.meta.url)), "utf8")
const start = src.indexOf("export const OPEN_IN_DESTINATIONS")
const open = src.indexOf("= [", start) + 2
const close = /\r?\n\]\r?\n/.exec(src.slice(open)) // the array's closing line
const end = open + close.index + close[0].indexOf("]") + 1
const contexts = JSON.parse(process.argv[2])
const out = contexts.map((ctx) => {
  const FakeDate = { now: () => ctx.now_ms }
  const list = new Function("Date", `return ${src.slice(open, end)}`)(FakeDate)
  return list.map((d) => ({
    id: d.id,
    label: d.label,
    url: d.buildUrl(ctx),
    available: d.isAvailable ? d.isAvailable(ctx) : true,
    hint: d.unavailableHint ?? null,
  }))
})
process.stdout.write(JSON.stringify(out))
