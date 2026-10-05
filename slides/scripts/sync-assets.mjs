// The decks import screenshots as @assets/screenshots/<path>; those files are
// the docs site's (docs/public/screenshots), copied here before dev or build
// so the repo holds them once. slides/assets/screenshots is git-ignored.
import { readFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
const root = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
const src = join(root, "..", "docs", "public", "screenshots")
const dst = join(root, "assets", "screenshots")
const wanted = new Set()
for (const deck of readdirSync(join(root, "slides"))) {
  const file = join(root, "slides", deck, "index.tsx")
  if (!existsSync(file)) continue
  for (const m of readFileSync(file, "utf8").matchAll(/@assets\/screenshots\/([^'"]+)/g)) wanted.add(m[1])
}
let n = 0
for (const rel of wanted) {
  const from = join(src, rel)
  if (!existsSync(from)) { console.error(`missing: docs/public/screenshots/${rel}`); process.exitCode = 1; continue }
  mkdirSync(dirname(join(dst, rel)), { recursive: true })
  copyFileSync(from, join(dst, rel)); n++
}
console.log(`${n} screenshots copied into slides/assets/screenshots`)
