#!/usr/bin/env node
// Makes the small copies the Data layers modal shows on its cards.
//
// The docs' screenshots are full-resolution captures - 1 to 4 MB each, 36 MB
// for the viz-modes folder alone. That is right for a docs page, where one
// image loads at a time and you might want to zoom it. It is wrong for a grid
// of fourteen cards roughly 220 px wide: opening the modal would pull tens of
// megabytes to draw thumbnails, and `loading="lazy"` does not help once they
// are all on screen at once.
//
// So each card image listed in components/TerrainControlPanel/
// data-layers-modal.tsx gets a WIDTH-px copy under screenshots/thumbs/,
// keeping its relative path. Both live in docs/public, so both ship to
// /docs/screenshots/ the same way and the docs pages keep using the
// full-size originals.
//
// Map screenshots are also CROPPED to the middle CROP of their width and
// height first. A whole 3000 px landscape shrunk into a 220 px card is a grey
// smudge where you cannot tell slope from openness, which defeats the point
// of showing a picture at all; the middle fifth of the same capture is the
// texture itself at close to native pixels. Cropping happens BEFORE the
// downscale, so the thumbnail is real detail rather than an enlargement.
//
// Panel screenshots are exempt (PANEL_SHOTS): the tool cards show the sidebar,
// and the middle of one of those is whatever the map happened to be doing.
//
// Uses ffmpeg rather than a new dependency: this repo has no image library,
// and adding one (sharp, with its platform binaries) to resize fourteen
// files at build time is a poor trade. The outputs are committed, so nobody
// needs ffmpeg unless they are regenerating them.
//
//   node docs/scripts/build-screenshot-thumbs.mjs          # only what is missing/stale
//   node docs/scripts/build-screenshot-thumbs.mjs --force

import { readFileSync, mkdirSync, statSync, existsSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = resolve(HERE, "../public/screenshots")
const THUMBS = join(SHOTS, "thumbs")
const MODAL = resolve(HERE, "../../components/TerrainControlPanel/data-layers-modal.tsx")
const WIDTH = 640
/** Fraction of the original kept, per axis, centred. */
const CROP = Number(process.env.THUMB_CROP ?? 0.3)
/** Where the crop window sits, as a fraction of the frame. 0.5,0.5 is dead
 *  centre. Map shots are framed on the map's own centre, but the sidebar
 *  overlays the right quarter of the viewport, so the subject a human aimed
 *  at sits a little LEFT of the image centre - hence the default nudge. */
const CROP_X = Number(process.env.THUMB_CROP_X ?? 0.44)
const CROP_Y = Number(process.env.THUMB_CROP_Y ?? 0.5)
/** Screenshots OF THE UI rather than of the map - never cropped. */
const PANEL_SHOTS = /^tools\/|^sun-shadow-calculator/
const FORCE = process.argv.includes("--force")

// The modal is the list: pulling the paths out of it means a card added there
// cannot be forgotten here. `image: "viz-modes/slope.jpg"`.
const wanted = [...readFileSync(MODAL, "utf8").matchAll(/image:\s*"([^"]+)"/g)].map((m) => m[1])
if (!wanted.length) { console.error(`no image: "..." entries found in ${MODAL}`); process.exit(1) }

let made = 0, skipped = 0
for (const rel of [...new Set(wanted)]) {
  const src = join(SHOTS, rel)
  if (!existsSync(src)) { console.warn(`  ! missing source: ${rel}`); continue }
  // Always .jpg out, whatever went in - one of the sources is a 4 MB PNG.
  const out = join(THUMBS, rel.replace(/\.[^.]+$/, ".jpg"))
  if (!FORCE && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) { skipped++; continue }
  mkdirSync(dirname(out), { recursive: true })
  // -2 keeps the height even, which some encoders insist on; q 4 is visually
  // clean at this size and lands around 50 KB. crop before scale, or the
  // crop would be of an already-degraded image.
  // x/y are the TOP-LEFT of the crop window, so convert from a centre.
  const crop = PANEL_SHOTS.test(rel)
    ? ""
    : `crop=iw*${CROP}:ih*${CROP}:iw*${(CROP_X - CROP / 2).toFixed(4)}:ih*${(CROP_Y - CROP / 2).toFixed(4)},`
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", `${crop}scale=${WIDTH}:-2`, "-q:v", "4", out])
  made++
}

const total = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile()).reduce((n, e) => n + statSync(join(e.parentPath ?? e.path, e.name)).size, 0) : 0)
console.log(`${made} written (map shots cropped to ${(CROP * 100).toFixed(0)}% around ${CROP_X}/${CROP_Y}), ${skipped} up to date -> ${THUMBS}`)
console.log(`  ${(total(THUMBS) / 1e6).toFixed(2)} MB of thumbnails for ${(wanted.length)} cards` +
  ` (originals: ${(wanted.reduce((n, r) => n + (existsSync(join(SHOTS, r)) ? statSync(join(SHOTS, r)).size : 0), 0) / 1e6).toFixed(0)} MB)`)
