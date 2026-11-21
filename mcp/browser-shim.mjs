// The few browser functions the app's tile protocols call, for Node:
// createImageBitmap, ImageData, ImageBitmap and a 2D OffscreenCanvas that
// copies pixels (no scaling, no drawing), decoding and encoding by sharp;
// and an XML DOMParser for the VRT reader.
// Installed on globalThis before generated/app-render.mjs is imported.
import sharp from "sharp"

class NodeImageData {
  constructor(data, width, height) {
    if (typeof data === "number") { height = width; width = data; data = new Uint8ClampedArray(width * height * 4) }
    this.data = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
    this.width = width; this.height = height ?? this.data.length / 4 / width
  }
}
class NodeImageBitmap {
  constructor(width, height, data) { this.width = width; this.height = height; this.data = data }
  close() { }
}

async function createImageBitmap(src) {
  if (src instanceof NodeImageBitmap || src instanceof NodeImageData) return new NodeImageBitmap(src.width, src.height, new Uint8ClampedArray(src.data))
  if (src instanceof NodeOffscreenCanvas) return new NodeImageBitmap(src.width, src.height, new Uint8ClampedArray(src._data))
  const bytes = src instanceof Blob ? Buffer.from(await src.arrayBuffer()) : Buffer.from(src)
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return new NodeImageBitmap(info.width, info.height, new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength))
}

class NodeContext2D {
  constructor(canvas) { this.canvas = canvas }
  drawImage(img, dx = 0, dy = 0) {
    const c = this.canvas, W = c.width
    for (let j = 0; j < img.height; j++) {
      const y = j + dy
      if (y < 0 || y >= c.height) continue
      const x0 = Math.max(0, dx), x1 = Math.min(W, dx + img.width)
      if (x1 <= x0) continue
      c._data.set(img.data.subarray((j * img.width + (x0 - dx)) * 4, (j * img.width + (x1 - dx)) * 4), (y * W + x0) * 4)
    }
  }
  getImageData(x, y, w, h) {
    const out = new NodeImageData(w, h), W = this.canvas.width
    for (let j = 0; j < h; j++) out.data.set(this.canvas._data.subarray(((y + j) * W + x) * 4, ((y + j) * W + x + w) * 4), j * w * 4)
    return out
  }
  putImageData(img, x = 0, y = 0) { this.drawImage(img, x, y) }
  clearRect() { this.canvas._data.fill(0) }
}
class NodeOffscreenCanvas {
  constructor(width, height) { this.width = width; this.height = height; this._data = new Uint8ClampedArray(width * height * 4) }
  getContext(kind) { return kind === "2d" ? (this._ctx ??= new NodeContext2D(this)) : null }
  async convertToBlob() {
    const png = await sharp(Buffer.from(this._data.buffer), { raw: { width: this.width, height: this.height, channels: 4 } }).png().toBuffer()
    return new Blob([png], { type: "image/png" })
  }
}

// An XML DOMParser for the VRT reader (lib/vrt-protocol.ts parses the VRT's
// index with it): elements, attributes and text, querySelector and
// querySelectorAll by tag names (a comma list), getAttribute, textContent.
// Enough for a VRT document; not a general DOM.
const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }
const unescapeXml = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m)
class XmlElement {
  constructor(tagName, attributes) { this.tagName = tagName; this.attributes = attributes; this.children = [] }
  getAttribute(name) { return this.attributes[name] ?? null }
  get textContent() { return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("") }
  *#descendants() { for (const c of this.children) if (typeof c !== "string") { yield c; yield* c.#descendants() } }
  querySelectorAll(selector) {
    const tags = new Set(selector.split(",").map((t) => t.trim()))
    return [...this.#descendants()].filter((e) => tags.has(e.tagName))
  }
  querySelector(selector) {
    const tags = new Set(selector.split(",").map((t) => t.trim()))
    for (const e of this.#descendants()) if (tags.has(e.tagName)) return e
    return null
  }
}
class NodeDOMParser {
  parseFromString(xml) {
    const doc = new XmlElement("#document", {}), stack = [doc]
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
    for (const m of xml.matchAll(re)) {
      const top = stack[stack.length - 1]
      if (m[1] != null) top.children.push(m[1])
      else if (m[6] != null) top.children.push(unescapeXml(m[6]))
      else if (m[3] != null) {
        if (m[2]) { if (stack.length > 1) stack.pop(); continue }
        const attrs = {}
        for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescapeXml(a[2] ?? a[3])
        const el = new XmlElement(m[3], attrs)
        top.children.push(el)
        if (!m[5]) stack.push(el)
      }
    }
    return doc
  }
}

export function installBrowserShim() {
  Object.assign(globalThis, { ImageData: NodeImageData, ImageBitmap: NodeImageBitmap, OffscreenCanvas: NodeOffscreenCanvas, createImageBitmap })
  if (typeof globalThis.DOMParser === "undefined") globalThis.DOMParser = NodeDOMParser
}
/** RGBA pixels of whatever a protocol handler returned. */
export async function pixelsOf(result) {
  const d = result?.data ?? result
  if (d instanceof NodeImageBitmap) return d
  return createImageBitmap(d instanceof ArrayBuffer ? new Uint8Array(d) : d)
}
