// Google Earth historical imagery in Node, without the browser engine: the
// dates Google Earth holds at a place, and plain Web Mercator XYZ tiles of a
// date. The app's own reader (lib/ge-timemachine/ge-historical.js, bundled
// into generated/app-lib.mjs) does everything that is not a canvas: the
// dbRoot and its key, the quadtree packets, the dates of a node, the pick of
// a capture for a date, the fetch and decryption of a Keyhole image. Only
// its last step, drawing the Keyhole tiles (plate carrée, 360 / 2^z degrees
// a side) into a Mercator tile, uses a browser canvas there; here sharp
// decodes the images and the rows are resampled in plain JavaScript.
//
//   geDates({ lat, lng, zoom })               the captures at a place, newest first
//   geTile(z, x, y, { date, size, format })   one tile, or null when Google has none
//
// `zoom` is a Web Mercator tile zoom (256 px tiles), which is the Keyhole
// level the tile is built from: a client drawing 256 px tiles at zoom z asks
// the dates at zoom z.
import sharp from "sharp"

const TILE = 256
const MAX_LEVEL = 23

let sourcePromise
/** The app's reader, its dbRoot loaded: one for the service. A failed load
 *  (Google unreachable) is not kept, so the next request tries again. */
async function reader() {
  sourcePromise ??= (async () => {
    const lib = await import("./generated/app-lib.mjs")
    const source = new lib.GEHistoricalSource({})
    await source.ready()
    return { lib, source }
  })().catch((e) => { sourcePromise = null; throw e })
  return sourcePromise
}

const pad = (n) => String(n).padStart(2, "0")
const label = (d) => `${d.year}-${pad(d.month)}-${pad(d.day)}`

/** "YYYY-MM-DD" (or milliseconds) as the reader's { year, month, day }; null
 *  for no date, which reads as the newest capture. Throws on anything else. */
export function parseDate(value) {
  if (value == null || value === "") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value))
  if (m) return { year: +m[1], month: +m[2], day: +m[3] }
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) throw Object.assign(new Error(`"${value}" is not a date (YYYY-MM-DD)`), { status: 400 })
  const d = new Date(ms)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/** The dated captures of the Keyhole node holding a point at a level,
 *  newest first: [{ date, dateMs, provider }]. `provider` is the copyright
 *  Google's dbRoot gives for the capture, when it has one. A node with the
 *  current imagery only (no history) lists nothing. */
export async function geDates({ lat, lng, zoom }) {
  const { lib, source } = await reader()
  const level = Math.max(1, Math.min(MAX_LEVEL, Math.round(zoom)))
  const { path } = lib.keyholePathAtLngLat(lng, lat, level)
  const dated = await source.getDatesForPath(path)
  const dates = dated.filter((d) => d.packed).map((d) => ({
    date: label(d), dateMs: Date.UTC(d.year, d.month - 1, d.day),
    ...(source.getProviderCopyright(d.provider) ? { provider: source.getProviderCopyright(d.provider) } : {}),
  }))
  return { level, dates, current: dated.some((d) => !d.packed) }
}

const mercYNormToLat = (yNorm) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * yNorm))) * 180) / Math.PI

/** The Keyhole rows a Mercator tile needs at a level: [rowBot, rowTop]
 *  (rows count northward from latitude -180). */
export function keyholeRows(z, y, level) {
  const n = 2 ** level
  const latN = mercYNormToLat(y / 2 ** z), latS = mercYNormToLat((y + 1) / 2 ** z)
  // The south edge belongs to the tile below: a hair inside, so a tile
  // whose edge falls on a row boundary does not fetch a row it never draws.
  return [Math.max(0, Math.floor(((latS + 180) / 360) * n + 1e-9)), Math.min(n - 1, Math.floor(((latN + 180) / 360) * n - 1e-9))]
}

/** A plate carrée strip (RGBA, `width` x `height` px, its top edge at
 *  `topLat`, `latPerPx` degrees a pixel) resampled into the Mercator tile
 *  z/y, `out` px a side: each output row takes its own latitude (pixel
 *  centres), blended from the two strip rows around it. Columns are kept:
 *  longitude is linear in both grids. A transparent pixel never bleeds into
 *  an opaque one. */
export function reprojectStrip(strip, width, height, topLat, latPerPx, z, y, out) {
  const dst = Buffer.alloc(out * out * 4)
  const scaleX = width / out
  for (let j = 0; j < out; j++) {
    const lat = mercYNormToLat((y + (j + 0.5) / out) / 2 ** z)
    const f = Math.max(0, Math.min(height - 1, (topLat - lat) / latPerPx - 0.5))
    const r0 = Math.floor(f), r1 = Math.min(height - 1, r0 + 1), t = f - r0
    for (let i = 0; i < out; i++) {
      const sx = Math.min(width - 1, Math.floor(i * scaleX))
      const a = (r0 * width + sx) * 4, b = (r1 * width + sx) * 4, o = (j * out + i) * 4
      const aa = strip[a + 3], ab = strip[b + 3]
      if (!aa && !ab) continue
      const w = !ab ? 0 : !aa ? 1 : t
      dst[o] = strip[a] * (1 - w) + strip[b] * w + 0.5
      dst[o + 1] = strip[a + 1] * (1 - w) + strip[b + 1] * w + 0.5
      dst[o + 2] = strip[a + 2] * (1 - w) + strip[b + 2] * w + 0.5
      dst[o + 3] = 255
    }
  }
  return dst
}

const inflight = new Map()

/** One Web Mercator tile of Google Earth's imagery at a date: the newest
 *  capture on or before it (the reader's rule: the node's capture of that
 *  date, else an ancestor's, cropped; else the newest older one; with
 *  nothing that old, the oldest), or the newest of all without a date.
 *  `size` 512 builds from the level above (twice the detail), as the app's
 *  HiDPI tiles. Returns { bytes, type } (JPEG when asked and the tile is
 *  whole, else PNG), or null when Google has no imagery there. */
export function geTile(z, x, y, { date = null, size = TILE, format = "jpg" } = {}) {
  const key = `${z}/${x}/${y}@${date ? label(date) : "newest"}@${size}@${format}`
  if (!inflight.has(key)) inflight.set(key, buildTile(z, x, y, date, size, format).finally(() => inflight.delete(key)))
  return inflight.get(key)
}

async function buildTile(z, x, y, date, size, format) {
  if (z < 1 || z > MAX_LEVEL) return null
  const { lib, source } = await reader()
  // The reader keeps the date asked for as one field for all its requests;
  // a view of it per tile (same caches, its own date) lets tiles of several
  // dates be built at once.
  const view = Object.create(source)
  view.targetDate = date
  const level = size === 512 && z + 1 <= MAX_LEVEL ? z + 1 : z
  const cols = 2 ** (level - z), out = TILE * cols
  const n = 2 ** level, col0 = x * cols
  const [rowBot, rowTop] = keyholeRows(z, y, level)
  const rows = rowTop - rowBot + 1
  if (rows < 1) return null
  const width = out, height = rows * TILE
  const strip = Buffer.alloc(width * height * 4)
  let drew = false
  const cells = []
  for (let row = rowBot; row <= rowTop; row++) for (let c = 0; c < cols; c++) cells.push({ row, col: col0 + c })
  await Promise.all(cells.map(async ({ row, col }) => {
    const pick = await view._pickTileForPath(lib.rowColToPath(row, col, level))
    if (!pick) return
    // No abort signal: the reader shares one fetch among the tiles that
    // need the same Keyhole image, and one cancelled tile must not fail the others.
    const rec = await view._getTileImageBytes(pick.path, pick.date)
    if (!rec) return
    let px
    try {
      let img = sharp(Buffer.from(rec.bytes)).resize(TILE, TILE, { fit: "fill" })
      if (pick.up) {
        // An ancestor's capture: this node's part of it, scaled up. Keyhole
        // rows count northward, the image's lines downward.
        const sub = 2 ** pick.up, sw = Math.max(1, Math.floor(TILE / sub))
        const left = Math.min(TILE - sw, Math.floor(((col % sub) * TILE) / sub))
        const top = Math.min(TILE - sw, Math.floor(((sub - 1 - (row % sub)) * TILE) / sub))
        const whole = await img.ensureAlpha().raw().toBuffer()
        img = sharp(whole, { raw: { width: TILE, height: TILE, channels: 4 } }).extract({ left, top, width: sw, height: sw }).resize(TILE, TILE, { fit: "fill", kernel: "cubic" })
      }
      px = await img.ensureAlpha().raw().toBuffer()
    } catch { return } // not an image after all: the cell stays empty
    const dx = (col - col0) * TILE, dy = (rowTop - row) * TILE
    for (let j = 0; j < TILE; j++) px.copy(strip, ((dy + j) * width + dx) * 4, j * TILE * 4, (j + 1) * TILE * 4)
    drew = true
  }))
  if (!drew) return null
  const topLat = ((rowTop + 1) * 360) / n - 180
  let px = reprojectStrip(strip, width, height, topLat, 360 / n / TILE, z, y, out)
  let side = out
  if (size !== out) { // 512 asked at the deepest level: the 256 px tile, doubled
    px = await sharp(px, { raw: { width: out, height: out, channels: 4 } }).resize(size, size, { kernel: "cubic" }).raw().toBuffer()
    side = size
  }
  let whole = true
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) { whole = false; break }
  const image = sharp(px, { raw: { width: side, height: side, channels: 4 } })
  return format === "jpg" && whole
    ? { bytes: await image.removeAlpha().jpeg({ quality: 88 }).toBuffer(), type: "image/jpeg" }
    : { bytes: await image.png().toBuffer(), type: "image/png" }
}
