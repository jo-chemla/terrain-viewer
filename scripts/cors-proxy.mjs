#!/usr/bin/env node
// A tiny CORS proxy for local tests of sources whose host does not allow
// the browser's origin: PMTiles archives (Range requests, which also need
// the OPTIONS preflight answered), COGs, tile servers.
//
//   node scripts/cors-proxy.mjs            # http://localhost:5209
//   PORT=5300 node scripts/cors-proxy.mjs
//
// Then prefix the source URL:
//   pmtiles://http://localhost:5209/https://tiles.larsmaxfield.com/.../height.pmtiles/{z}/{x}/{y}
//
// Forwards the Range header and streams the response back with
// Access-Control-Allow-Origin: * and the headers readers need exposed
// (Content-Range, Content-Length, ETag). Not for production use.
import http from "node:http"

const PORT = Number(process.env.PORT || 5209)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-None-Match, If-Match, Content-Type",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, ETag, Last-Modified, Content-Type",
}

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return }
  const target = decodeURIComponent((req.url || "").replace(/^\/+/, ""))
  if (!/^https?:\/\//.test(target)) { res.writeHead(400, CORS); res.end("usage: /https://host/path"); return }
  try {
    const headers = {}
    for (const h of ["range", "if-none-match", "if-match", "accept"]) if (req.headers[h]) headers[h] = req.headers[h]
    const upstream = await fetch(target, { method: req.method, headers, redirect: "follow" })
    const out = { ...CORS }
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"]) {
      const v = upstream.headers.get(h); if (v) out[h] = v
    }
    res.writeHead(upstream.status, out)
    if (req.method === "HEAD" || !upstream.body) { res.end(); return }
    const reader = upstream.body.getReader()
    for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)) }
    res.end()
  } catch (e) {
    res.writeHead(502, CORS); res.end(String(e))
  }
}).listen(PORT, () => console.log(`cors proxy on http://localhost:${PORT}/  (prefix any https URL)`))
