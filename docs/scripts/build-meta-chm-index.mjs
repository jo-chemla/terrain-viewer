#!/usr/bin/env node
// Builds public/meta-chm/cells.bin: which cells of Meta's global canopy
// height maps (CHM v2, s3://dataforgood-fb-data/forests/v2/global/) exist, so
// the `metachm://` reader (lib/vrt-protocol.ts) never asks titiler for a file
// that is not there (titiler answers a missing file with a slow 500).
//
// The product is one COG per Web Mercator quadkey cell: zoom 10 for the 1 m
// maps (dinov3_global_chm_v2_ml3, 213 109 files) and zoom 7 for the 10 m mean
// derivative (dinov3_global_chm_v2_ml3_10m_mean, 4 376 files). The index is
// two bitmaps, one bit per cell, row-major from the north-west (bit
// y * 2^z + x, least significant bit first in each byte):
//
//   bytes 0..2047        the 128 x 128 cells of zoom 7
//   bytes 2048..133119   the 1024 x 1024 cells of zoom 10
//
// 133 KB, about 20 KB gzipped, committed. The bucket lists without a key
// (1 000 names a page, 220 pages, about two minutes). Run again when Meta
// publishes a new version:
//
//   node docs/scripts/build-meta-chm-index.mjs

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, "../../public/meta-chm/cells.bin")
const BUCKET = "https://dataforgood-fb-data.s3.amazonaws.com"
const PRODUCTS = [
  { z: 7, prefix: "forests/v2/global/dinov3_global_chm_v2_ml3_10m_mean/chm/", offset: 0 },
  { z: 10, prefix: "forests/v2/global/dinov3_global_chm_v2_ml3/chm/", offset: 2048 },
]

const out = new Uint8Array(2048 + 131072)
for (const { z, prefix, offset } of PRODUCTS) {
  let token = "", count = 0
  for (;;) {
    const url = `${BUCKET}/?list-type=2&max-keys=1000&prefix=${encodeURIComponent(prefix)}${token ? `&continuation-token=${encodeURIComponent(token)}` : ""}`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status} listing ${prefix}`)
    const xml = await r.text()
    for (const m of xml.matchAll(/<Key>[^<]*\/(\d+)\.tif<\/Key>/g)) {
      const q = m[1]
      if (q.length !== z) continue
      let x = 0, y = 0
      for (const d of q) { x = x * 2 + (Number(d) & 1); y = y * 2 + (Number(d) >> 1) }
      const bit = y * 2 ** z + x
      out[offset + (bit >> 3)] |= 1 << (bit & 7)
      count++
    }
    token = /<NextContinuationToken>([^<]*)/.exec(xml)?.[1] ?? ""
    if (!token) break
  }
  console.log(`zoom ${z}: ${count} cells`)
}
await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, out)
console.log(`wrote ${OUT} (${out.length} bytes)`)
