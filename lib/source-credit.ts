/**
 * The line a source contributes to the map's own attribution control.
 *
 * MapLibre's AttributionControl collects `attribution` from every source a
 * visible layer uses (a layer with `visibility: "none"` does not count, nor
 * does a source no layer uses), drops exact duplicates and joins them. So a
 * source credits itself by carrying the string in its spec, and stops when
 * its layers are hidden.
 *
 * The map line is short: the entry's `shortAttribution` (agency short name
 * and licence code, "MARI-GISLAB (Tulane), CC BY-NC-SA") when it has one,
 * else its `attribution`, else its name. The full credit stays in Source
 * Info. A short credit links to the licence page when one is recorded, so
 * that the twelve renders of one publisher give twelve identical strings and
 * MapLibre shows the line once; their own landing pages differ per item. Any
 * other credit links to the entry's landing page (`infoUrl`). The control
 * renders the string as HTML, so plain text is escaped; a credit that
 * already holds a link (ELI, TileJSON) is kept as written.
 *
 * A source added from the Library before it had a short credit is a
 * snapshot without one: pass the Library's copy of the entry (same id) and
 * its short credit is used, as long as the full credit was not edited since.
 */

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export interface CreditedSource {
  name?: string
  attribution?: string
  shortAttribution?: string
  infoUrl?: string
  licenseUrl?: string
}

const isWebUrl = (u: string | undefined): u is string => !!u && /^https?:\/\//i.test(u.trim())

export function sourceCredit(source: CreditedSource | null | undefined, library?: CreditedSource | null): string | undefined {
  if (!source) return undefined
  const libShort = library && (library.attribution ?? "") === (source.attribution ?? "") ? library.shortAttribution : undefined
  const short = (source.shortAttribution ?? libShort)?.trim()
  const raw = short || source.attribution?.trim()
  if (raw && /<a\s/i.test(raw)) return raw
  const text = raw || source.name?.trim()
  if (!text) return undefined
  const licenseUrl = source.licenseUrl ?? (libShort ? library?.licenseUrl : undefined)
  const url = (short && isWebUrl(licenseUrl) ? licenseUrl : source.infoUrl)?.trim()
  return isWebUrl(url)
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`
    : escapeHtml(text)
}
