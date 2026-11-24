/**
 * The line a source contributes to the map's own attribution control.
 *
 * MapLibre's AttributionControl collects `attribution` from every source a
 * visible layer uses (a layer with `visibility: "none"` does not count, nor
 * does a source no layer uses), drops duplicates and joins them. So a source
 * credits itself by carrying the string in its spec, and stops when its
 * layers are hidden. Custom basemaps, overlays and terrain sources were built
 * without one: their credit only showed in Source Info.
 *
 * The entry's own `attribution` when it has one (the library, the catalog
 * pickers), else its name: a dataset someone added still says what it is.
 * Linked to its landing page when one is recorded. The control renders the
 * string as HTML, so plain text is escaped; an attribution that already
 * holds a link (ELI, TileJSON) is kept as written.
 */

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export interface CreditedSource {
  name?: string
  attribution?: string
  infoUrl?: string
}

export function sourceCredit(source: CreditedSource | null | undefined): string | undefined {
  if (!source) return undefined
  const raw = source.attribution?.trim()
  if (raw && /<a\s/i.test(raw)) return raw
  const text = raw || source.name?.trim()
  if (!text) return undefined
  const url = source.infoUrl?.trim()
  return url && /^https?:\/\//i.test(url)
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`
    : escapeHtml(text)
}
