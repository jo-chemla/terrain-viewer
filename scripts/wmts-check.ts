// Parse real WMTS capabilities with lib/wmts-client.ts, print the tile
// template each would use, fetch one tile per service and report CORS.
//
//   npx tsx scripts/wmts-check.ts            (the four reference services)
//   npx tsx scripts/wmts-check.ts <capabilities url> [layer id]
//
// Node has no DOMParser: a minimal XML reader below gives the parser the
// handful of DOM members it uses (localName, children, getAttribute,
// textContent, getElementsByTagName, documentElement).
import { parseWmtsCapabilities, buildWmtsTileSource, usableMatrixSets, unusableReason, wmtsCapabilitiesUrl, stacWmtsRefs, resolveStacWmts } from "../lib/wmts-client"

class El {
  localName: string
  children: El[] = []
  private attrs: Record<string, string>
  private texts: string[] = []
  constructor(public tagName: string, attrs: Record<string, string>) {
    this.localName = tagName.includes(":") ? tagName.split(":")[1] : tagName
    this.attrs = attrs
  }
  getAttribute(n: string) { return this.attrs[n] ?? null }
  getAttributeNS(_ns: string, n: string) { return this.attrs[`xlink:${n}`] ?? null }
  appendText(t: string) { this.texts.push(t) }
  get textContent(): string { return this.texts.join("") + this.children.map((c) => c.textContent).join("") }
  getElementsByTagName(name: string): El[] {
    const out: El[] = []
    const walk = (e: El) => { for (const c of e.children) { if (name === "*" || c.tagName === name) out.push(c); walk(c) } }
    walk(this)
    return out
  }
}
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&")
function parseXml(xml: string): Document {
  const root = new El("#document", {})
  const stack: El[] = [root]
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.appendText(m[1])
    else if (m[6] !== undefined) top.appendText(decode(m[6]))
    else if (m[3]) {
      if (m[2]) { stack.pop(); continue }
      const attrs: Record<string, string> = {}
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3])
      const el = new El(m[3], attrs)
      top.children.push(el)
      if (!m[5]) stack.push(el)
    }
  }
  const doc = root as unknown as Document & { documentElement: El }
  ;(doc as any).documentElement = root.children[0]
  return doc
}

// The browser path (fetchWmtsCapabilities parses with the global DOMParser).
;(globalThis as any).DOMParser = class { parseFromString(s: string) { return parseXml(s) } }

/** A STAC collection with a web-map-links "wmts" link (NASA VEDA's GIBS
 *  layers), resolved the way the STAC search panel does it. */
async function checkStac() {
  const col = "MODIS_Terra_L3_NDVI_16Day"
  console.log(`\n== STAC: VEDA collection ${col}`)
  const c = await (await fetch(`https://openveda.cloud/api/stac/collections/${col}`)).json()
  const refs = stacWmtsRefs(c)
  console.log(`   wmts refs ${JSON.stringify(refs)}`)
  if (!refs.length) return false
  const { layer, source } = await resolveStacWmts(refs[0], refs[0].layers[0])
  console.log(`   layer ${layer.identifier}, z${source.minzoom}-${source.maxzoom}, ${JSON.stringify(source.dimensions)}`)
  console.log(`   template ${source.url}`)
  const t = await fetch(source.url.replace("{z}", "3").replace("{x}", "4").replace("{y}", "3"))
  console.log(`   tile 3/4/3: HTTP ${t.status}, ${t.headers.get("content-type")}`)
  return t.ok
}

const SERVICES: { name: string; url: string; layer?: string }[] = [
  { name: "NASA GIBS", url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities", layer: "MODIS_Terra_CorrectedReflectance_TrueColor" },
  { name: "IGN France", url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities", layer: "ORTHOIMAGERY.ORTHOPHOTOS" },
  { name: "IGN Spain PNOA", url: "https://www.ign.es/wmts/pnoa-ma?request=GetCapabilities&service=WMTS" },
  { name: "swisstopo", url: "https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml", layer: "ch.swisstopo.swissimage" },
]

const ORIGIN = "http://localhost:5173"
const cors = (r: Response) => r.headers.get("access-control-allow-origin") ?? "none"
/** A tile inside the layer's box at a mid zoom. */
function sampleTile(bbox: number[] | undefined, minz: number, maxz: number) {
  const z = Math.max(minz, Math.min(maxz, 8))
  const lng = bbox ? (bbox[0] + bbox[2]) / 2 : 2.35, lat = bbox ? (bbox[1] + bbox[3]) / 2 : 48.85
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return { z, x, y }
}

async function check(name: string, url: string, layerId?: string) {
  console.log(`\n== ${name}\n   ${wmtsCapabilitiesUrl(url)}`)
  const res = await fetch(wmtsCapabilitiesUrl(url), { headers: { Origin: ORIGIN } })
  console.log(`   capabilities: HTTP ${res.status}, CORS ${cors(res)}`)
  const caps = parseWmtsCapabilities(await res.text(), url, parseXml)
  const usable = caps.layers.filter((l) => usableMatrixSets(caps, l).length)
  console.log(`   "${caps.title}" by ${caps.provider ?? "?"}: ${caps.layers.length} layers, ${usable.length} drawable in Web Mercator, ${caps.matrixSets.size} matrix sets, KVP ${caps.kvpGetTile ?? "none"}`)
  const unusable = caps.layers.find((l) => !usableMatrixSets(caps, l).length)
  if (unusable) console.log(`   e.g. not drawable: ${unusable.identifier}: ${unusableReason(caps, unusable)}`)
  const layer = (layerId && caps.layers.find((l) => l.identifier === layerId)) || usable[0]
  if (!layer) { console.log("   no drawable layer"); return false }
  const src = buildWmtsTileSource(caps, layer)
  console.log(`   layer ${layer.identifier} ("${layer.title}"), set ${src.matrixSet}, z${src.minzoom}-${src.maxzoom}, ${src.tileSize}px, ${src.encoding}, ${src.format}, style ${src.style}${Object.keys(src.dimensions).length ? `, ${JSON.stringify(src.dimensions)}` : ""}`)
  console.log(`   bbox ${JSON.stringify(src.bounds)}  attribution ${src.attribution}`)
  console.log(`   template ${src.url}`)
  const { z, x, y } = sampleTile(src.bounds, src.minzoom, src.maxzoom)
  const tileUrl = src.url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))
  const t = await fetch(tileUrl, { headers: { Origin: ORIGIN } })
  const buf = new Uint8Array(await t.arrayBuffer())
  const ok = t.ok && /^image\//.test(t.headers.get("content-type") ?? "")
  console.log(`   tile ${z}/${x}/${y}: HTTP ${t.status}, ${t.headers.get("content-type")}, ${buf.length} bytes, CORS ${cors(t)}  ${ok ? "OK" : "FAIL"}`)
  return ok
}

const [argUrl, argLayer] = process.argv.slice(2)
const list = argUrl ? [{ name: "custom", url: argUrl, layer: argLayer }] : SERVICES
;(async () => {
  let failed = 0
  for (const s of list) {
    try { if (!(await check(s.name, s.url, s.layer))) failed++ } catch (e) { failed++; console.log(`   ERROR ${(e as Error).message}`) }
  }
  if (!argUrl) { try { if (!(await checkStac())) failed++ } catch (e) { failed++; console.log(`   ERROR ${(e as Error).message}`) } }
  process.exit(failed ? 1 : 0)
})()
