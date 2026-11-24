// The /proxy/ routes (proxy.mjs) against local stand-ins of the three hosts
// behind them: an Apache-like glihtdata (Range, no CORS), Earthdata's
// download app (a token holder is redirected to a signed address, anyone
// else to the login page) and the S3 bucket (which fails the test if the
// token ever reaches it). No network. `node proxy-test.mjs` (in `pnpm test`).
import assert from "node:assert/strict"
import http from "node:http"
import { readFileSync } from "node:fs"
import { once } from "node:events"

const kmz = readFileSync(new URL("../lib/fixtures/gliht/Kuiic2_Apr2013_DTM.subset.kmz", import.meta.url))
const { writeArrayBuffer } = await import("geotiff")
// A plain stripped Float32 GeoTIFF in UTM 16N, as LP DAAC's granules are.
const W = 700, H = 1100
const tif = Buffer.from(writeArrayBuffer(new Float32Array(W * H).map((_, i) => 90 + (i % W) / 100), {
  width: W, height: H, ModelPixelScale: [1, 1, 0], ModelTiepoint: [0, 0, 0, 232000, 2222000, 0],
  ProjectedCSTypeGeoKey: 32616, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, SampleFormat: [3], BitsPerSample: [32],
}))

function serveRange(res, body, range) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? "")
  if (!m) { res.writeHead(200, { "content-length": body.length, "accept-ranges": "bytes" }); return res.end(body) }
  const start = m[1] === "" ? body.length - Number(m[2]) : Number(m[1]), end = m[1] === "" || m[2] === "" ? body.length - 1 : Math.min(body.length - 1, Number(m[2]))
  res.writeHead(206, { "content-range": `bytes ${start}-${end}/${body.length}`, "content-length": end - start + 1, "accept-ranges": "bytes", etag: '"x"' })
  res.end(body.subarray(start, end + 1))
}

const seen = []
const fake = http.createServer((req, res) => {
  seen.push(`${req.url} ${req.headers.authorization ? "auth" : ""}`)
  const port = fake.address().port
  if (req.url === "/files/G-LiHT/Kuiic2_Apr2013/lidar/kml/Kuiic2_Apr2013_DTM.kmz") return serveRange(res, kmz, req.headers.range)
  if (req.url.startsWith("/lp-prod-protected/GLDTMT.001/")) {
    if (req.headers.authorization === "Bearer good-token") { res.writeHead(307, { location: `http://127.0.0.1:${port}/s3${req.url}?X-Amz-Signature=abc` }); return res.end() }
    res.writeHead(302, { location: "https://urs.earthdata.nasa.gov/oauth/authorize?client_id=x" }); return res.end()
  }
  if (req.url.startsWith("/s3/")) {
    assert.equal(req.headers.authorization, undefined, "the Earthdata token must not reach S3")
    return serveRange(res, tif, req.headers.range)
  }
  res.writeHead(404); res.end()
})
fake.listen(0); await once(fake, "listening")
const fakeUrl = `http://127.0.0.1:${fake.address().port}`

process.env.TV_PROXY_GLIHT_ORIGIN = fakeUrl
process.env.TV_PROXY_EARTHDATA_ORIGIN = fakeUrl
process.env.TV_PROXY_MAX_FULL = "100000"
process.env.TV_PROXY_MAX_RANGE = "2000000"
process.env.TV_ENV_FILE = "/nonexistent/.env"
delete process.env.EARTHDATA_TOKEN
const { handleProxy, resolve, rangeSize } = await import("./proxy.mjs")

// The allow-list.
assert.equal(resolve("/proxy/gliht/files/G-LiHT/Kuiic1_Apr2013/lidar/kml/Kuiic1_Apr2013_DTM.kmz").name, "gliht")
assert.equal(resolve("/proxy/gliht/files/G-LiHT/AMIGACarb_Yuc_Norte_GLAS_Apr2013/lidar/kml/dtm/AMIGACarb_Yuc_Norte_GLAS_Apr2013_l0s397_DTM.kmz").name, "gliht")
assert.equal(resolve("/proxy/gliht/files/G-LiHT/AMIGACarb_X/lidar/kml/tiles/AMIGACarb_X_tiles.kmz").name, "gliht")
assert.equal(resolve("/proxy/gliht/files/G-LiHT/Kuiic1_Apr2013/lidar/geotiff/Kuiic1_Apr2013_DTM.tif.gz").name, "gliht")
assert.equal(resolve("/proxy/gliht/DATA/flightData.js").error, 403)
assert.equal(resolve("/proxy/gliht/files/G-LiHT/Kuiic1_Apr2013/lidar/").error, 403, "no directory listings")
assert.equal(resolve("/proxy/gliht/files/G-LiHT/x/lidar/kml/../../../etc.kmz").error, 400)
assert.equal(resolve("/proxy/gliht/files/G-LiHT/x/lidar/kml/a%2F..kmz").error, 400)
assert.equal(resolve("/proxy/earthdata/lp-prod-protected/GLDTMT.001/GLDTMT_Kuiic1_Apr2013_DTM/GLDTMT_Kuiic1_Apr2013_DTM.tif").name, "earthdata")
assert.equal(resolve("/proxy/earthdata/lp-prod-protected/HLSL30.020/x/x.tif").error, 403, "G-LiHT collections only")
assert.equal(resolve("/proxy/earthdata/vrt/lp-prod-protected/GLDTMT.001/G/G.tif").vrt, true)
assert.equal(resolve("/proxy/other/x").error, 404)
assert.deepEqual(rangeSize("bytes=0-99"), { size: 100 })
assert.deepEqual(rangeSize("bytes=-65557"), { size: 65557 })
assert.ok(rangeSize("bytes=0-1,5-9").error)

const server = http.createServer((req, res) => handleProxy(req, res, `http://127.0.0.1:${server.address().port}`))
server.listen(0); await once(server, "listening")
const base = `http://127.0.0.1:${server.address().port}`
const kmzPath = "/proxy/gliht/files/G-LiHT/Kuiic2_Apr2013/lidar/kml/Kuiic2_Apr2013_DTM.kmz"

// A Range read passes through, with the CORS headers a browser needs.
{
  const r = await fetch(base + kmzPath, { headers: { range: "bytes=-22" } })
  assert.equal(r.status, 206)
  assert.equal(r.headers.get("access-control-allow-origin"), "*")
  assert.match(r.headers.get("access-control-expose-headers"), /content-range/)
  assert.equal(r.headers.get("content-range"), `bytes ${kmz.length - 22}-${kmz.length - 1}/${kmz.length}`)
  assert.match(r.headers.get("cache-control"), /public/)
  const b = Buffer.from(await r.arrayBuffer())
  assert.equal(b.readUInt32LE(0), 0x06054b50, "the zip's end record")
}
// The preflight a Range header triggers.
{
  const r = await fetch(base + kmzPath, { method: "OPTIONS" })
  assert.equal(r.status, 204)
  assert.match(r.headers.get("access-control-allow-headers"), /range/)
}
// Limits: a whole file over TV_PROXY_MAX_FULL, a range over TV_PROXY_MAX_RANGE.
assert.equal((await fetch(base + kmzPath)).status, 413)
assert.equal((await fetch(base + kmzPath, { headers: { range: "bytes=0-3000000" } })).status, 416)
assert.equal((await fetch(base + "/proxy/gliht/DATA/flightData.js")).status, 403)
assert.equal((await fetch(base + kmzPath, { method: "POST" })).status, 405)

// Earthdata without a token: 401 naming the variable, no upstream call.
const ed = "/proxy/earthdata/lp-prod-protected/GLDTMT.001/GLDTMT_Test_DTM/GLDTMT_Test_DTM.tif"
{
  const n = seen.length
  const r = await fetch(base + ed, { headers: { range: "bytes=0-7" } })
  assert.equal(r.status, 401)
  assert.match(await r.text(), /EARTHDATA_TOKEN/)
  assert.equal(seen.length, n)
}
// A refused token: the login redirect becomes a 401.
process.env.EARTHDATA_TOKEN = "stale"
assert.equal((await fetch(base + ed, { headers: { range: "bytes=0-7" } })).status, 401)
// A good token: redirected to the signed address, read there without it,
// and the signed address reused for the next read.
process.env.EARTHDATA_TOKEN = "good-token"
{
  const r = await fetch(base + ed, { headers: { range: "bytes=0-7" } })
  assert.equal(r.status, 206)
  assert.match(r.headers.get("cache-control"), /private/)
  const b = Buffer.from(await r.arrayBuffer())
  assert.ok(b.subarray(0, 2).toString() === "II" || b.subarray(0, 2).toString() === "MM", "a TIFF")
  const n = seen.length
  assert.equal((await fetch(base + ed, { headers: { range: "bytes=8-15" } })).status, 206)
  assert.equal(seen.length, n + 1, "the second read goes straight to the signed address")
}
// The VRT over it: 512 px sources pointing back at the proxied file.
{
  const r = await fetch(base + "/proxy/earthdata/vrt" + ed.slice("/proxy/earthdata".length))
  assert.equal(r.status, 200)
  const xml = await r.text()
  assert.match(xml, new RegExp(`rasterXSize="${W}" rasterYSize="${H}"`))
  assert.match(xml, /<SRS>EPSG:32616<\/SRS>/)
  assert.match(xml, /<GeoTransform>232000, 1, 0, 2222000, 0, -1<\/GeoTransform>/)
  assert.equal((xml.match(/<SimpleSource>/g) ?? []).length, Math.ceil(W / 512) * Math.ceil(H / 512))
  assert.ok(xml.includes(`<SourceFilename relativeToVRT="0">${base}${ed}</SourceFilename>`))
  assert.match(xml, /dataType="Float32"/)
}

server.close(); fake.close()
console.log("proxy: ok")
