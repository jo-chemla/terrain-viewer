import { addProtocol, type AddProtocolAction, type RequestParameters } from "maplibre-gl"

/**
 * One registry for every custom tile scheme this app speaks.
 *
 * MapLibre only ever asks `addProtocol` handlers for the tiles of ITS sources.
 * Everything in the app that builds a tile URL from a template and fetches it
 * itself - every derived viz mode reading its upstream DEM, the GeoTIFF
 * export, the 2D elevation picker and profile - used to call `fetch()` on
 * that URL, which the browser refuses for `vrt://`, `demdiff://`, `lerc://`
 * and the rest ("URL scheme is not supported"). Each of those consumers then
 * grew its own list of schemes to special-case, and every new protocol or
 * new consumer had to remember to extend every list. Twice it did not
 * (LERC and quantized mesh in September, VRT and the nDSM difference after):
 * hillshade worked, every other mode drew nothing.
 *
 * So: register a protocol HERE (which also registers it with MapLibre), and
 * fetch a tile URL THROUGH HERE. `dispatchTile` looks the scheme up and calls
 * its handler; an unregistered custom scheme throws a message naming this
 * file instead of the browser's generic one. A consumer that goes through
 * `fetchTileBitmap` never needs to know which protocols exist.
 */

export type ProtocolHandler = AddProtocolAction

const handlers = new Map<string, ProtocolHandler>()

/** Registers with MapLibre and with this registry. Use instead of
 *  `maplibregl.addProtocol` everywhere in the app. */
export function registerProtocol(scheme: string, handler: ProtocolHandler): void {
  handlers.set(scheme, handler)
  addProtocol(scheme, handler)
}

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i
const BROWSER_SCHEMES = new Set(["http", "https", "blob", "data", "file"])

/** The scheme of a URL when it is one of ours, else null (http(s), blob, data
 *  and scheme-less URLs are the browser's business). */
export function customScheme(url: string): string | null {
  const m = SCHEME_RE.exec(url)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  return BROWSER_SCHEMES.has(scheme) ? null : scheme
}

export function isRegisteredScheme(url: string): boolean {
  const scheme = customScheme(url)
  return scheme != null && handlers.has(scheme)
}

/** Runs the registered handler for a custom-scheme tile URL. */
export async function dispatchTile(url: string, signal?: AbortSignal, type: RequestParameters["type"] = "image"): Promise<{ data: unknown }> {
  const scheme = customScheme(url)
  if (!scheme) throw new Error(`dispatchTile: ${url.slice(0, 80)} is not a custom scheme - fetch() it`)
  const handler = handlers.get(scheme)
  if (!handler) {
    throw new Error(`No protocol registered for "${scheme}://" - register it with registerProtocol() in lib/protocol-registry.ts (see TerrainViewer.tsx), not with maplibregl.addProtocol, so every consumer can reach it. URL: ${url.slice(0, 120)}`)
  }
  const controller = new AbortController()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", () => controller.abort(), { once: true })
  }
  return handler({ url, type } as RequestParameters, controller)
}

/** Whatever a handler returns - an ImageBitmap (the normal path, see
 *  lib/tile-image.ts), encoded image bytes (PNG/WebP, e.g. PMTiles or the
 *  no-createImageBitmap fallback) - as a bitmap. */
export async function toBitmap(result: { data: unknown }): Promise<ImageBitmap> {
  const d = result.data
  if (typeof ImageBitmap !== "undefined" && d instanceof ImageBitmap) return d
  if (d instanceof Uint8Array) return createImageBitmap(new Blob([d.buffer as ArrayBuffer]))
  if (d instanceof ArrayBuffer) return createImageBitmap(new Blob([d]))
  if (d instanceof Blob) return createImageBitmap(d)
  throw new Error("toBitmap: protocol returned neither a bitmap nor image bytes")
}

/** The one call for "give me this tile URL as a bitmap": custom schemes go to
 *  their handler, anything else to fetch(). */
export async function fetchTileBitmap(url: string, signal?: AbortSignal): Promise<ImageBitmap | null> {
  if (customScheme(url)) return toBitmap(await dispatchTile(url, signal))
  const response = await fetch(url, { signal })
  if (!response.ok) return null
  return createImageBitmap(await response.blob())
}
