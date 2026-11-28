// A whole MapLibre style laid over the app's map (a vector entry of type
// "style", the vector basemap): what it takes for several of them, each with
// its own fonts and sprite, to share one map.
//
// A map has ONE glyphs address and resolves every image name in one table.
// Until 2026-11-27 the loader set the first style's glyphs and sprite and
// every later style drew with those: swisstopo's labels, in fonts only
// swisstopo serves, came out empty next to OpenFreeMap's. Now:
//
//   Fonts   the map's glyphs address is this module's own scheme
//           (GLYPH_ROUTER_URL); each installed style says which address
//           serves the fonts it names (registerGlyphs), and the protocol
//           sends each request to the address of the font asked for.
//   Images  each style's sprite is added under an id of its own
//           (map.addSprite) and the style's image names are prefixed with
//           it (withSprite), so "circle" of one style is not another's.
//
// No MapLibre import and no DOM: tested under Node
// (node scripts/test-lib.mjs lib/style-overlay.test.ts).

export const GLYPH_SCHEME = "tvglyphs"
/** What the map's `glyphs` is set to. */
export const GLYPH_ROUTER_URL = `${GLYPH_SCHEME}://{fontstack}/{range}.pbf`
/** Where a font no style registered is asked for: OpenFreeMap serves the
 *  three Noto Sans the app's own labels (contours) are written in. */
export const DEFAULT_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"
export const DEFAULT_FONT = "Noto Sans Regular"

// On globalThis for the reason lib/protocol-registry.ts gives: a second copy
// of this module (hot reload) must see the registrations of the first.
const routes: Map<string, string> = ((globalThis as { __tvGlyphRoutes?: Map<string, string> }).__tvGlyphRoutes ??= new Map())

const isStack = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")

/** Every font stack a `text-font` value names: a plain list of names, each
 *  ["literal", […]] of an expression, the outputs of a zoom function. */
export function fontStacks(value: unknown): string[][] {
  const out: string[][] = []
  const walk = (v: unknown, top: boolean) => {
    if (top && isStack(v) && v[0] !== "literal") { out.push(v); return }
    if (Array.isArray(v)) {
      if (v[0] === "literal" && isStack(v[1])) { out.push(v[1]); return }
      for (const x of v) walk(x, false)
    } else if (v && typeof v === "object") {
      for (const stop of (v as { stops?: unknown[] }).stops ?? []) if (Array.isArray(stop) && isStack(stop[1])) out.push(stop[1])
    }
  }
  walk(value, true)
  return out
}

/** The fonts the layers of a style name, each once. */
export function styleFonts(layers: readonly { layout?: Record<string, unknown> }[]): string[] {
  const fonts = new Set<string>()
  for (const l of layers) for (const stack of fontStacks(l.layout?.["text-font"])) for (const f of stack) fonts.add(f)
  return [...fonts]
}

/** Says that `template` (a style's `glyphs`) serves these fonts. The first
 *  style to name a font keeps it: two styles naming "Noto Sans Regular" get
 *  the same glyphs from one address, which is what one map can draw. */
export function registerGlyphs(fonts: readonly string[], template: string | null | undefined, table: Map<string, string> = routes): void {
  if (!template || !template.includes("{fontstack}") || template.startsWith(`${GLYPH_SCHEME}:`)) return
  for (const f of fonts) if (!table.has(f)) table.set(f, template)
}

/** The address of a glyph range: the stack as the style wrote it, at the
 *  address registered for its first font; a stack nobody registered is asked
 *  for at the default address, in the default font when it is not one of
 *  the app's own. */
export function glyphUrl(fontstack: string, range: string, table: Map<string, string> = routes): string {
  const first = fontstack.split(",")[0].trim()
  const template = table.get(first)
  // The comma of a stack stays a comma, as MapLibre itself would send it.
  const fill = (t: string, stack: string) => t.replace("{fontstack}", encodeURIComponent(stack).replace(/%2C/gi, ",")).replace("{range}", range)
  if (template) return fill(template, fontstack)
  return fill(DEFAULT_GLYPHS, /^Noto Sans (Regular|Bold|Italic)$/.test(first) ? first : DEFAULT_FONT)
}

/** "tvglyphs://Noto Sans Bold/0-255.pbf" to its stack and range. */
export function parseGlyphRequest(url: string): { fontstack: string; range: string } | null {
  const m = new RegExp(`^${GLYPH_SCHEME}://(.+)/(\\d+-\\d+)\\.pbf$`).exec(url)
  if (!m) return null
  let fontstack = m[1]
  try { fontstack = decodeURIComponent(m[1]) } catch { /* a literal percent sign in a font name */ }
  return { fontstack, range: m[2] }
}

/** The protocol behind GLYPH_ROUTER_URL (registered in TerrainViewer.tsx).
 *  A range the font's server does not have fails as it would at the server's
 *  own address: MapLibre draws the label without those characters. */
export async function glyphProtocol(params: { url: string }, abortController: AbortController): Promise<{ data: ArrayBuffer }> {
  const request = parseGlyphRequest(params.url)
  if (!request) throw new Error(`Not a glyph address: ${params.url.slice(0, 120)}`)
  const response = await fetch(glyphUrl(request.fontstack, request.range), { signal: abortController.signal })
  if (!response.ok) throw new Error(`Glyphs ${response.status}: ${request.fontstack} ${request.range}`)
  return { data: await response.arrayBuffer() }
}

/** Points a map's glyphs at the router and registers where the fonts of
 *  `layers` are served (the `glyphs` of the style they come from). */
export function routeGlyphs(map: { getGlyphs(): string | null; setGlyphs(url: string): unknown }, layers: readonly { layout?: Record<string, unknown> }[], glyphs: string | null | undefined): void {
  registerGlyphs(styleFonts(layers), glyphs)
  if (map.getGlyphs() !== GLYPH_ROUTER_URL) map.setGlyphs(GLYPH_ROUTER_URL)
}

/** The sprite id of a style overlay: the entry's id, made safe (an image is
 *  named "<sprite id>:<name>"). */
export const spriteIdOf = (entryId: string) => `vo-${entryId.replace(/[^\w-]/g, "_")}`

// ── Sprite ──────────────────────────────────────────────────────────────────

/** The style's sprite as an absolute address: a relative one ("./x/sprite",
 *  a style the app serves itself) is read against the style's address. Of a
 *  list of sprites, the default one. */
export function spriteUrl(sprite: unknown, styleUrl: string, pageUrl?: string): string | null {
  const raw = typeof sprite === "string" ? sprite
    : Array.isArray(sprite) ? (sprite.find((s) => s?.id === "default") ?? sprite[0])?.url
    : null
  if (typeof raw !== "string" || !raw) return null
  try { return new URL(raw, new URL(styleUrl, pageUrl ?? "http://localhost/")).href } catch { return null }
}

type Json = unknown
/** An image name, or what gives one, with the sprite's id put before every
 *  name: "bus_11" to "id:bus_11", tokens kept ("id:{class}_11"), the outputs
 *  of match, case, step, coalesce and of a zoom function each prefixed,
 *  ["image", x] and any other expression joined after the id. An empty name
 *  (no image) stays empty. */
export function prefixImage(value: Json, id: string): Json {
  const text = (s: string) => (s.trim() === "" ? s : `${id}:${s}`)
  if (typeof value === "string") return text(value)
  if (Array.isArray(value)) {
    const [op, ...args] = value as [string, ...Json[]]
    const each = (pick: (i: number) => boolean) => [op, ...args.map((a, i) => (pick(i) ? prefixImage(a, id) : a))]
    switch (op) {
      case "literal": return value
      case "image": return ["image", prefixImage(args[0], id)]
      case "coalesce": return each(() => true)
      // input, then label and output pairs, then the fallback
      case "match": return each((i) => i > 0 && (i % 2 === 0 || i === args.length - 1))
      // condition and output pairs, then the fallback
      case "case": return each((i) => i % 2 === 1 || i === args.length - 1)
      // input, first output, then stop and output pairs
      case "step": return each((i) => i > 0 && i % 2 === 1)
      case "let": return each((i) => i === args.length - 1)
      default: return ["concat", `${id}:`, value]
    }
  }
  if (value && typeof value === "object") {
    const fn = value as { stops?: [Json, Json][]; default?: Json }
    return { ...fn, ...(fn.stops ? { stops: fn.stops.map(([k, v]) => [k, prefixImage(v, id)]) } : {}), ...(fn.default !== undefined ? { default: prefixImage(fn.default, id) } : {}) }
  }
  return value
}

const IMAGE_LAYOUT = ["icon-image"]
const IMAGE_PAINT = ["fill-pattern", "line-pattern", "fill-extrusion-pattern", "background-pattern"]

/** A layer with its images read from the sprite added under `id`. */
export function withSprite<T extends { layout?: Record<string, unknown>; paint?: Record<string, unknown> }>(layer: T, id: string): T {
  const patch = (group: Record<string, unknown> | undefined, names: string[]) => {
    if (!group || !names.some((n) => group[n] !== undefined)) return group
    const out = { ...group }
    for (const n of names) if (out[n] !== undefined) out[n] = prefixImage(out[n], id)
    return out
  }
  const layout = patch(layer.layout, IMAGE_LAYOUT), paint = patch(layer.paint, IMAGE_PAINT)
  return layout === layer.layout && paint === layer.paint ? layer : { ...layer, ...(layout ? { layout } : {}), ...(paint ? { paint } : {}) }
}
