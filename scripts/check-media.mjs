#!/usr/bin/env node
// Keeps heavy media out of git. The history was rewritten on 2026-11-13 to
// drop 450 MB of old screenshots, footprints and pictures (a clone went from
// 464 MB to 15 MB); one careless commit would start that again, for good,
// since a blob in history stays in every clone. Run by the deploy workflow on
// every push, and by hand: `node scripts/check-media.mjs`.
//
// Where heavy files go instead: docs screenshots on the docs-media release
// (pnpm docs:media:push), VRT indexes and coverage footprints on the
// dataset-indexes release (pnpm datasets:push), videos on demo-takes, decks
// on a slides-<date> release. See docs/content/docs/dev/releases.mdx.
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"

const MEDIA = /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|mp3|wav|zip|tar|gz|7z|geojson|vrt|pdf|tiff?|glb|gltf|bin|pmtiles|mbtiles|psd|las|laz)$/i
const FORBIDDEN_DIRS = ["docs/public/screenshots/", "public/vrt/", "posted-on-twitter/"]
const FORBIDDEN = [/^public\/coverage\/.*\.geojson$/, /^video\/public\/.*\.(mp4|webm|mov)$/]
const MAX_FILE = 600e3 // one picture, recompressed, fits; a raw screenshot does not
const MAX_TOTAL = 8e6 // every tracked media file together (3.5 MB on 2026-11-13)

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64e6 }).split("\0").filter(Boolean)
const problems = []
let total = 0
for (const f of files) {
  if (FORBIDDEN_DIRS.some((d) => f.startsWith(d)) || FORBIDDEN.some((r) => r.test(f))) { problems.push(`${f}: this folder lives on a release, not in git`); continue }
  if (!MEDIA.test(f)) continue
  let size = 0
  try { size = statSync(f).size } catch { continue }
  total += size
  if (size > MAX_FILE) problems.push(`${f}: ${Math.round(size / 1e3)} KB, over ${MAX_FILE / 1e3} KB (recompress it, or put it on a release)`)
}
if (total > MAX_TOTAL) problems.push(`tracked media add up to ${(total / 1e6).toFixed(1)} MB, over ${MAX_TOTAL / 1e6} MB`)
if (problems.length) {
  console.error("check-media: heavy files in git\n  " + problems.join("\n  "))
  process.exit(1)
}
console.log(`check-media: ${files.length} files, media ${(total / 1e6).toFixed(1)} MB, all under the limits`)
