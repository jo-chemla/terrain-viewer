// The G-LiHT KMZ reader, offline, on recorded subsets of real KMZs
// (lib/fixtures/gliht/, 230 kB): the Kiuic 2 campaign KMZ (root, level 1 and
// a 3 x 3 block of its finest level), one AMIGA-Carb cell KMZ (root and level
// 1) and that campaign's cell index. The heights checked are the Float32
// GeoTIFF's (Kuiic2_Apr2013_DTM.tif from the .tif.gz, gdallocationinfo
// -wgs84), so the test is also the evidence that the PNGs are stretched
// elevation, not a hillshade.
//
//   node scripts/test-lib.mjs lib/gliht-kmz.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { inflateSync } from "node:zlib"
import {
  glihtUrl, openZip, openPyramid, readGreyTile, parseGlihtUrl, glihtTemplate, greyToMetres, parseCellIndex,
  readEntries, levelFor, quadUv, clearGlihtCaches, campaignKmzPath, cellKmzPath, cellIndexPath, GLIHT_ORIGIN, type Env,
} from "./gliht-kmz"

const FIX = "lib/fixtures/gliht/"
const files: Record<string, Uint8Array> = {
  [GLIHT_ORIGIN + campaignKmzPath("Kuiic2_Apr2013")]: readFileSync(FIX + "Kuiic2_Apr2013_DTM.subset.kmz"),
  [GLIHT_ORIGIN + cellIndexPath("AMIGACarb_Yuc_Norte_GLAS_Apr2013")]: readFileSync(FIX + "AMIGACarb_Yuc_Norte_GLAS_Apr2013_tiles.kmz"),
  [GLIHT_ORIGIN + cellKmzPath("AMIGACarb_Yuc_Norte_GLAS_Apr2013", "l0s397")]: readFileSync(FIX + "AMIGACarb_Yuc_Norte_GLAS_Apr2013_l0s397_DTM.subset.kmz"),
}

/** An Apache-like host: Range (start-end and suffix) answered 206, else 404. */
function host() {
  const log: string[] = []
  const fetch: Env["fetch"] = async (url, init) => {
    const body = files[url]
    log.push(`${url.split("/").pop()} ${init.headers.Range ?? ""}`)
    if (!body) return new Response("not found", { status: 404 })
    const r = /^bytes=(\d*)-(\d*)$/.exec(init.headers.Range ?? "")
    if (!r) return new Response(body as Uint8Array<ArrayBuffer>, { status: 200 })
    const start = r[1] === "" ? Math.max(0, body.length - Number(r[2])) : Number(r[1])
    const end = r[1] === "" || r[2] === "" ? body.length - 1 : Math.min(body.length - 1, Number(r[2]))
    return new Response(body.slice(start, end + 1) as Uint8Array<ArrayBuffer>, { status: 206, headers: { "content-range": `bytes ${start}-${end}/${body.length}` } })
  }
  return { fetch, log }
}

/** Just enough PNG for G-LiHT's tiles: 8-bit RGBA or grey, not interlaced. */
async function decodePng(png: Uint8Array) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let p = 8, width = 0, height = 0, type = 0
  const idat: Uint8Array[] = []
  while (p < png.length) {
    const len = dv.getUint32(p), kind = String.fromCharCode(...png.subarray(p + 4, p + 8))
    const d = png.subarray(p + 8, p + 8 + len)
    if (kind === "IHDR") { width = dv.getUint32(p + 8); height = dv.getUint32(p + 12); type = d[9]; assert.equal(d[8], 8); assert.equal(d[12], 0) }
    if (kind === "IDAT") idat.push(d)
    p += 12 + len
  }
  const ch = type === 6 ? 4 : type === 4 ? 2 : type === 2 ? 3 : 1
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * ch, rows = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? rows[y * stride + x - ch] : 0, b = y ? rows[(y - 1) * stride + x] : 0, c = x >= ch && y ? rows[(y - 1) * stride + x - ch] : 0
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0
      rows[y * stride + x] = (line[x] + pred) & 255
    }
  }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const s = rows.subarray(i * ch, i * ch + ch)
    data.set(ch === 4 ? s : ch === 3 ? [s[0], s[1], s[2], 255] : ch === 2 ? [s[0], s[0], s[0], s[1]] : [s[0], s[0], s[0], 255], i * 4)
  }
  return { width, height, data }
}

const lonToTile = (lon: number, z: number) => (lon + 180) / 360 * 2 ** z
const latToTile = (lat: number, z: number) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z

test("the address: the host, a base URL, a {url} proxy template", () => {
  const path = campaignKmzPath("Kuiic1_Apr2013")
  assert.equal(glihtUrl(path), "https://glihtdata.gsfc.nasa.gov/files/G-LiHT/Kuiic1_Apr2013/lidar/kml/Kuiic1_Apr2013_DTM.kmz")
  assert.equal(glihtUrl(path, "http://localhost:3401/proxy/gliht/"), "http://localhost:3401/proxy/gliht/files/G-LiHT/Kuiic1_Apr2013/lidar/kml/Kuiic1_Apr2013_DTM.kmz")
  assert.equal(glihtUrl(path, "https://p.example/?url={url}"), `https://p.example/?url=${encodeURIComponent(GLIHT_ORIGIN + path)}`)
  assert.equal(cellKmzPath("AMIGACarb_Yuc_Norte_GLAS_Apr2013", "l0s397"), "/files/G-LiHT/AMIGACarb_Yuc_Norte_GLAS_Apr2013/lidar/kml/dtm/AMIGACarb_Yuc_Norte_GLAS_Apr2013_l0s397_DTM.kmz")
})

test("tile URLs: template and parse", () => {
  assert.equal(glihtTemplate("Kuiic1_Apr2013", { dem: [67.67, 153.37] }), "gliht://Kuiic1_Apr2013/{z}/{x}/{y}?dem=67.67,153.37")
  assert.deepEqual(parseGlihtUrl("gliht://Kuiic1_Apr2013/15/7230/14540?dem=67.67,153.37"), { campaign: { id: "Kuiic1_Apr2013", cells: false }, z: 15, x: 7230, y: 14540, dem: [67.67, 153.37] })
  assert.equal(parseGlihtUrl("gliht://AMIGACarb_Yuc_Norte_GLAS_Apr2013/12/1000/1800")!.campaign.cells, true, "AMIGA-Carb campaigns are per cell")
  assert.equal(parseGlihtUrl("gliht://X/1/0/0?cells=1")!.campaign.cells, true)
  assert.equal(parseGlihtUrl("gliht://X/1/0/0?dem=5,1")!.dem, undefined, "an inverted stretch is refused")
  assert.equal(parseGlihtUrl("https://x/1/0/0"), null)
})

test("zip directory and pyramid of a campaign KMZ", async () => {
  const { fetch, log } = host()
  const env = { fetch, decodePng }
  const url = GLIHT_ORIGIN + campaignKmzPath("Kuiic2_Apr2013")
  const zip = await openZip(env, url)
  assert.equal(zip.entries.size, 29)
  assert.equal(log.length, 1, "a small directory comes with the end record")
  const p = await openPyramid(env, url)
  assert.deepEqual([p.maxLevel, p.tileW, p.tileH], [4, 125, 375])
  assert.deepEqual(p.root, [[-89.531919, 20.032479], [-89.512814, 20.032751], [-89.513677, 20.086918], [-89.532788, 20.086645]])
  const [u, v] = quadUv(p.root, -89.512814, 20.032751)
  assert.ok(Math.abs(u - 1) < 1e-9 && Math.abs(v) < 1e-9)
  // 1.1 m output pixels take the 1 m level, 10 m ones level 0 or 1.
  assert.equal(levelFor(p, 1e-5), 4)
  assert.equal(levelFor(p, 1e-4), 1)
  const got = await readEntries(env, zip, ["4/8/8.png", "4/8/8.kml", "nope"])
  assert.deepEqual([...got.keys()].sort(), ["4/8/8.kml", "4/8/8.png"])
  assert.equal((await decodePng(got.get("4/8/8.png")!)).width, 125)
})

test("Kiuic 2: grey decoded with its stretch is the GeoTIFF's elevation", async () => {
  clearGlihtCaches()
  const { fetch, log } = host()
  const env = { fetch, decodePng }
  const dem: [number, number] = [92.01, 146.59]
  // gdallocationinfo -wgs84 -valonly Kuiic2_Apr2013_DTM.tif <lon> <lat>
  const truth: [number, number, number][] = [
    [-89.522, 20.0575, 125.24], [-89.522, 20.059, 110.83], [-89.522, 20.0605, 109.14], [-89.522, 20.062, 109.32], [-89.522, 20.0635, 108.33],
    [-89.5212, 20.0575, 123.62], [-89.5212, 20.059, 111.61], [-89.5212, 20.0605, 108.78], [-89.5212, 20.062, 108.66], [-89.5212, 20.0635, 108.17],
  ]
  const z = 17
  let worst = 0
  for (const [lon, lat, h] of truth) {
    const tx = Math.floor(lonToTile(lon, z)), ty = Math.floor(latToTile(lat, z))
    const grey = await readGreyTile(env, { id: "Kuiic2_Apr2013", cells: false }, "", z, tx, ty)
    assert.ok(grey, "the tile has data")
    const i = Math.floor((lonToTile(lon, z) - tx) * 256), j = Math.floor((latToTile(lat, z) - ty) * 256)
    const g = grey![j * 256 + i]
    assert.ok(Number.isFinite(g), `data at ${lon},${lat}`)
    worst = Math.max(worst, Math.abs(greyToMetres(g, dem) - h))
  }
  // One grey level is 0.21 m here; the 1 m cell and the 1.2 m output pixel
  // are not the same grid, so a slope adds a little.
  assert.ok(worst < 0.6, `decoded within 0.6 m of the GeoTIFF (worst ${worst.toFixed(2)} m)`)
  // Ten tiles, all from the same 3 x 3 block of the finest level: the
  // directory, the root and that block were each read once.
  assert.ok(log.length <= 5, `${log.length} requests: ${log.join(", ")}`)
})

test("an AMIGA-Carb campaign: cells from the index, a missing cell KMZ skipped", async () => {
  clearGlihtCaches()
  const { fetch, log } = host()
  const env = { fetch, decodePng }
  const zip = await openZip(env, GLIHT_ORIGIN + cellIndexPath("AMIGACarb_Yuc_Norte_GLAS_Apr2013"))
  const name = [...zip.entries.keys()].find((n) => n.endsWith(".kml"))!
  const cells = parseCellIndex(new TextDecoder().decode((await readEntries(env, zip, [name])).get(name)!))
  assert.equal(cells.length, 31)
  const c = cells.find((x) => x.name === "l0s397")!
  assert.ok(c.box.w < -90.449 && c.box.e > -90.46 && c.box.s < 19.975 && c.box.n > 20.025)
  // z12 over the cell's centre: the cell's level 0 or 1 suffices.
  const z = 12, lon = -90.4547, lat = 20.0002
  const grey = await readGreyTile(env, { id: "AMIGACarb_Yuc_Norte_GLAS_Apr2013", cells: true }, "", z, Math.floor(lonToTile(lon, z)), Math.floor(latToTile(lat, z)))
  assert.ok(grey)
  const vals = [...grey!].filter(Number.isFinite)
  assert.ok(vals.length > 500 && Math.max(...vals) <= 255 && Math.min(...vals) >= 0, `${vals.length} pixels`)
  // Through a base URL: the same host behind another prefix is not in the
  // recorded set, so every KMZ is a 404 and the tile is empty, not an error.
  clearGlihtCaches()
  await assert.rejects(readGreyTile(env, { id: "AMIGACarb_Yuc_Norte_GLAS_Apr2013", cells: true }, "http://localhost:9/proxy/gliht", z, 0, 0), /HTTP 404/, "no index: an error the map retries")
  assert.ok(log.some((l) => l.startsWith("AMIGACarb_Yuc_Norte_GLAS_Apr2013_l0s397_DTM.kmz")))
})
