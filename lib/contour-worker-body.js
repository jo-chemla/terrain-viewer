// Runs INSIDE MapLibre's own workers, loaded by importScriptInWorkers (see
// lib/contour-worker-client.ts, which prepends maplibre-contour's UMD build so
// `self.mlcontour` exists, and which documents the whole mechanism). Plain JS
// on purpose: this file is concatenated as text into a Blob, never bundled,
// so it may not import anything.
//
// What happens here: contour vector tiles (isolines plus vector-tile encode)
// for the `tv-contour://` protocol. What does NOT: reading the DEM. A plain
// http(s) tile is fetched right here; any other URL (vrt://, lerc://,
// demdiff://, lrm://, pmtiles://, float32dem-bbox://, ...) is asked of the
// main thread, where the app's protocol handlers live, and comes back as an
// ImageBitmap (transferred, not copied).
;(function () {
  var g = self
  var ml = g.mlcontour
  if (!ml || !g.worker || !g.worker.actor) return
  var managers = new Map()
  var canvas = null

  async function getTile(url, abortController) {
    if (/^https?:/i.test(url)) {
      var res = await fetch(url, { signal: abortController.signal })
      if (!res.ok) throw new Error("HTTP " + res.status + " for " + url.slice(0, 80))
      return { data: await res.blob() }
    }
    // targetMapId: without it every map's actor on the main thread answers,
    // and the ones without this handler answer null first.
    var bitmap = await g.worker.actor.sendAsync(
      { type: "tv-contour-tile", data: { url: url }, targetMapId: "global-dispatcher" },
      abortController,
    )
    if (!bitmap) throw new Error("No tile at " + url.slice(0, 80))
    return { data: bitmap }
  }

  async function decodeImage(data, encoding) {
    var bitmap = data instanceof Blob ? await createImageBitmap(data) : data
    var w = bitmap.width
    var h = bitmap.height
    if (!canvas || canvas.width !== w || canvas.height !== h) canvas = new OffscreenCanvas(w, h)
    var ctx = canvas.getContext("2d", { willReadFrequently: true })
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0)
    if (bitmap.close) bitmap.close()
    return ml.decodeParsedImage(w, h, encoding, ctx.getImageData(0, 0, w, h).data)
  }

  // One manager per configured DEM. `prefix` replaces the earlier managers of
  // the same layer (contour, isoline), so a source switch does not leak them.
  g.worker.actor.registerMessageHandler("tv-contour-config", async function (_mapId, p) {
    managers.forEach(function (_m, key) {
      if (key.indexOf(p.prefix + "-") === 0) managers.delete(key)
    })
    managers.set(
      p.key,
      new ml.LocalDemManager({
        demUrlPattern: p.demUrlPattern,
        encoding: p.encoding,
        maxzoom: p.maxzoom,
        cacheSize: 100,
        timeoutMs: 20000,
        getTile: getTile,
        decodeImage: decodeImage,
      }),
    )
  })

  // Same rule as maplibre-contour's getOptionsForZoom: the levels of the
  // largest threshold zoom at or below z.
  function optionsForZoom(options, z) {
    var levels = []
    var best = -Infinity
    Object.keys(options.thresholds).forEach(function (k) {
      var tz = Number(k)
      if (tz <= z && tz > best) {
        best = tz
        var v = options.thresholds[k]
        levels = typeof v === "number" ? [v] : v
      }
    })
    var out = Object.assign({}, options, { levels: levels })
    delete out.thresholds
    return out
  }

  // tv-contour://<key>/<z>/<x>/<y>?o=<url-encoded JSON options>
  g.addProtocol("tv-contour", async function (request, abortController) {
    var m = /^tv-contour:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\?o=(.*)$/.exec(request.url)
    if (!m) throw new Error("Bad contour URL " + request.url.slice(0, 80))
    var manager = managers.get(m[1])
    if (!manager) throw new Error("No contour DEM configured for " + m[1])
    var z = Number(m[2])
    var options = JSON.parse(decodeURIComponent(m[5]))
    var tile = await manager.fetchContourTile(z, Number(m[3]), Number(m[4]), optionsForZoom(options, z), abortController)
    return { data: tile.arrayBuffer }
  })
})()
