import raw from "@/CHANGELOG.md?raw"

export interface ChangelogEntry {
  /** Display title after "# Changelog — " (e.g. "August 11, 2026: Histogram
   *  Color Matching in Compare and Blend") — free-text, edited often (retitled
   *  several times already), so it is NEVER used as a lookup/comparison key. */
  heading: string
  /** ISO date, optionally with a time-of-day ("YYYY-MM-DD" or
   *  "YYYY-MM-DDTHH:MM"), from this entry's `<!-- released: ... -->` marker
   *  right below the heading line — an explicit, stable key independent of
   *  the (frequently-edited) title text, so lastSeenChangelogAtAtom
   *  comparisons never break when a heading is reworded. Plain ISO strings
   *  sort correctly with `<`/`>`, no Date parsing (and its timezone pitfalls)
   *  needed. The time-of-day suffix exists only to order same-day entries
   *  that got split by theme (see e.g. the several Jul 21/27/28, 2026
   *  entries) — `releasedDate` strips it for display. Empty string if missing. */
  releasedAt: string
  /** `releasedAt`'s date portion only ("YYYY-MM-DD"), for display — never
   *  show the time-of-day suffix to users, it's an internal ordering
   *  tie-breaker, not a real "this shipped at 17:15" claim. */
  releasedDate: string
  /** Raw markdown of this entry's "#### TL;DR" bullet list (empty string if
   *  the entry has none). Kept as markdown rather than split into plain
   *  strings so a bullet can carry inline formatting or an image/gif
   *  (docs/public/screenshots/*, referenced as /docs/screenshots/* — served
   *  by the docs app, itself proxied at /docs in dev and merged into
   *  dist/docs in prod, see vite.config.ts and the GH Pages workflow; this
   *  keeps one canonical copy shared with the docs/marketing site itself
   *  rather than a separate copy for the changelog) — rendered via
   *  ReactMarkdown wherever this entry appears. Both the "since you last
   *  looked" list and the "full changelog" view show ONLY this — the
   *  detailed Features/Bug Fixes prose below it in CHANGELOG.md is written
   *  for dev-me, not end users, and never reaches the UI. */
  tldrMarkdown: string
}

// CHANGELOG.md is newest-first (each new release is prepended), so
// CHANGELOG_ENTRIES[0] is always the latest. The "full changelog" view is
// simply all of CHANGELOG_ENTRIES, so it naturally only ever reaches back to
// the oldest entry actually written into the file.
const HEADING_RE = /^# Changelog(?:\s*—\s*(.+))?\s*$/gm
const RELEASED_RE = /<!--\s*released:\s*(\S+?)\s*-->/
// The trailing alternative is "true end of string", not "end of line" — a bare
// `$` under the `m` flag (needed for the `^#### TL;DR` line anchor) matches
// end-of-*any*-line, which would stop the lazy capture after just the first
// bullet.
const TLDR_RE = /^#### TL;DR\s*\n([\s\S]*?)(?=\n#{1,4} |(?![\s\S]))/m

// Some TL;DRs are authored as a single unbulleted paragraph rather than a
// `- ` list (there's only one point to make, so a list felt like overkill) —
// but settings-dialog.tsx's CHANGELOG_MARKDOWN_COMPONENTS only styles `ul`,
// not `p`, so those rendered at the browser's default paragraph size/weight
// instead of matching the muted text-sm bullets next to them. Forcing every
// TL;DR through a single bullet keeps every entry visually consistent
// regardless of how it was authored.
function normalizeTldr(tldr: string): string {
  return tldr.startsWith("- ") ? tldr : `- ${tldr}`
}

function parseChangelog(text: string): ChangelogEntry[] {
  const headingMatches = [...text.matchAll(HEADING_RE)]
  return headingMatches.map((match, i) => {
    const start = match.index ?? 0
    const end = i + 1 < headingMatches.length ? (headingMatches[i + 1].index ?? text.length) : text.length
    const body = text.slice(start, end)
    const heading = (match[1] ?? "").trim()
    const releasedMatch = body.match(RELEASED_RE)
    const tldrMatch = body.match(TLDR_RE)
    const releasedAt = releasedMatch ? releasedMatch[1] : ""
    return {
      heading,
      releasedAt,
      releasedDate: releasedAt.slice(0, 10),
      tldrMarkdown: tldrMatch ? normalizeTldr(tldrMatch[1].trim()) : "",
    }
  })
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = parseChangelog(raw)
export const LATEST_CHANGELOG_RELEASED_AT = CHANGELOG_ENTRIES[0]?.releasedAt ?? ""
