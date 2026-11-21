// The few browser image functions the app's tile protocols call, for Node:
// createImageBitmap, ImageData, ImageBitmap and a 2D OffscreenCanvas that
// copies pixels (no scaling, no drawing). Decoding and encoding by sharp.
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

export function installBrowserShim() {
  Object.assign(globalThis, { ImageData: NodeImageData, ImageBitmap: NodeImageBitmap, OffscreenCanvas: NodeOffscreenCanvas, createImageBitmap })
}
/** RGBA pixels of whatever a protocol handler returned. */
export async function pixelsOf(result) {
  const d = result?.data ?? result
  if (d instanceof NodeImageBitmap) return d
  return createImageBitmap(d instanceof ArrayBuffer ? new Uint8Array(d) : d)
}
