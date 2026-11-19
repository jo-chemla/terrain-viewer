/**
 * Writes where a saved picture comes from into the file itself: the link
 * that reopens the view, the data credits, the software. EXIF for a JPEG
 * (ImageDescription, Software, DateTime, Copyright), text chunks for a PNG
 * (Description, Source, Copyright, Software). No pixel is touched: the
 * bytes of the image are copied around one inserted block.
 *
 * Written by hand rather than with a library: both blocks are a few dozen
 * bytes of fixed layout, and the picture never has metadata to merge with
 * (it comes straight from canvas.toBlob).
 */
export type ImageMetadata = {
  /** The link that reopens the view. */
  url: string
  /** Data credits, as the map's attribution shows them. */
  copyright?: string
  software?: string
  description?: string
}

const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/©/g, "(c)").replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7e]/g, "?")
const bytesOf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)

function exifSegment(meta: ImageMetadata): Uint8Array {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  const dateTime = `${now.getFullYear()}:${p(now.getMonth() + 1)}:${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
  // Tag order is ascending, as TIFF asks. All ASCII (type 2), NUL-ended.
  const tags: [number, string][] = [
    [0x010e, ascii(meta.description ?? meta.url).slice(0, 20000)],
    [0x0131, ascii(meta.software ?? "Terrain Viewer")],
    [0x0132, dateTime],
    ...(meta.copyright ? [[0x8298, ascii(meta.copyright).slice(0, 6000)] as [number, string]] : []),
  ]
  const values = tags.map(([, v]) => bytesOf(v + "\0"))
  const ifdSize = 2 + tags.length * 12 + 4
  const dataSize = values.reduce((n, v) => n + v.length + (v.length & 1), 0)
  const tiff = new Uint8Array(8 + ifdSize + dataSize)
  const dv = new DataView(tiff.buffer)
  tiff.set(bytesOf("MM"), 0); dv.setUint16(2, 42); dv.setUint32(4, 8)
  dv.setUint16(8, tags.length)
  let dataAt = 8 + ifdSize
  tags.forEach(([tag], i) => {
    const at = 10 + i * 12, v = values[i]
    dv.setUint16(at, tag); dv.setUint16(at + 2, 2); dv.setUint32(at + 4, v.length)
    if (v.length <= 4) tiff.set(v, at + 8)
    else { dv.setUint32(at + 8, dataAt); tiff.set(v, dataAt); dataAt += v.length + (v.length & 1) }
  })
  const head = bytesOf("Exif\0\0")
  const seg = new Uint8Array(4 + head.length + tiff.length)
  const sv = new DataView(seg.buffer)
  sv.setUint16(0, 0xffe1); sv.setUint16(2, 2 + head.length + tiff.length)
  seg.set(head, 4); seg.set(tiff, 4 + head.length)
  return seg
}

let crcTable: Uint32Array | null = null
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  }
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngTextChunk(keyword: string, text: string): Uint8Array {
  // tEXt holds Latin-1 only: anything else goes in an iTXt chunk (UTF-8).
  const latin1 = /^[\x00-\xff]*$/.test(text)
  const body = latin1
    ? Uint8Array.from([...bytesOf(keyword), 0, ...bytesOf(text)])
    : Uint8Array.from([...bytesOf(keyword), 0, 0, 0, 0, 0, ...new TextEncoder().encode(text)])
  const type = bytesOf(latin1 ? "tEXt" : "iTXt")
  const chunk = new Uint8Array(12 + body.length)
  const dv = new DataView(chunk.buffer)
  dv.setUint32(0, body.length); chunk.set(type, 4); chunk.set(body, 8)
  const crcInput = new Uint8Array(4 + body.length); crcInput.set(type, 0); crcInput.set(body, 4)
  dv.setUint32(8 + body.length, crc32(crcInput))
  return chunk
}

/** The same picture with its origin written in. Returns the blob unchanged
 *  when it is neither a JPEG nor a PNG, or on any surprise in its bytes. */
export async function embedImageMetadata(blob: Blob, meta: ImageMetadata): Promise<Blob> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const dv = new DataView(bytes.buffer)
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      // After the JFIF header (APP0) when there is one, else right after SOI.
      let at = 2
      if (bytes[2] === 0xff && bytes[3] === 0xe0) at = 4 + dv.getUint16(4)
      const seg = exifSegment(meta)
      if (seg.length > 65535) return blob
      return new Blob([bytes.subarray(0, at), seg, bytes.subarray(at)] as BlobPart[], { type: blob.type || "image/jpeg" })
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      // After IHDR, always the first chunk: 8 signature + 4 length + 4 type + data + 4 CRC.
      const at = 8 + 12 + dv.getUint32(8)
      const chunks = [
        pngTextChunk("Description", meta.description ?? meta.url),
        pngTextChunk("Source", meta.url),
        ...(meta.copyright ? [pngTextChunk("Copyright", meta.copyright)] : []),
        pngTextChunk("Software", meta.software ?? "Terrain Viewer"),
      ]
      return new Blob([bytes.subarray(0, at), ...chunks, bytes.subarray(at)] as BlobPart[], { type: blob.type || "image/png" })
    }
  } catch (e) {
    console.warn("[snapshot] metadata not written:", e)
  }
  return blob
}

/** The credits the maps on screen show, each once, in reading order. */
export function attributionOnScreen(root: ParentNode = document): string {
  const seen = new Set<string>()
  for (const el of root.querySelectorAll(".maplibregl-ctrl-attrib-inner")) {
    for (const part of (el.textContent ?? "").split(/\s*\|\s*/)) {
      const t = part.replace(/\s+/g, " ").trim()
      if (t) seen.add(t)
    }
  }
  return [...seen].join(" | ")
}
