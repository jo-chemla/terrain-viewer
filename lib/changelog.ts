import raw from "@/CHANGELOG.md?raw"

export interface ChangelogEntry {
  /** The heading text after "# Changelog — " (e.g. "August 7–9, 2026") — also
   *  doubles as this release's version key for lastSeenChangelogVersionAtom,
   *  since this app versions by date, not semver. */
  heading: string
  /** Raw markdown of this entry's "#### TL;DR" bullet list (empty string if
   *  the entry has none). Kept as markdown rather than split into plain
   *  strings so a bullet can carry inline formatting or an image/gif
   *  (public/docs/changelog/*, referenced root-relative) — rendered via
   *  ReactMarkdown wherever this entry appears. Both the "since you last
   *  looked" list and the "full changelog" view show ONLY this — the
   *  detailed Features/Bug Fixes prose below it in CHANGELOG.md is written
   *  for dev-me, not end users, and never reaches the UI. */
  tldrMarkdown: string
}

// CHANGELOG.md is newest-first (each new release is prepended), so
// CHANGELOG_ENTRIES[0] is always the latest — that ordering is what
// lastSeenChangelogVersion comparisons in settings-dialog.tsx rely on. The
// "full changelog" view is simply all of CHANGELOG_ENTRIES, so it naturally
// only ever reaches back to the oldest entry actually written into the file.
const HEADING_RE = /^# Changelog(?:\s*—\s*(.+))?\s*$/gm
// The trailing alternative is "true end of string", not "end of line" — a bare
// `$` under the `m` flag (needed for the `^#### TL;DR` line anchor) matches
// end-of-*any*-line, which would stop the lazy capture after just the first
// bullet.
const TLDR_RE = /^#### TL;DR\s*\n([\s\S]*?)(?=\n#{1,4} |(?![\s\S]))/m

function parseChangelog(text: string): ChangelogEntry[] {
  const headingMatches = [...text.matchAll(HEADING_RE)]
  return headingMatches.map((match, i) => {
    const start = match.index ?? 0
    const end = i + 1 < headingMatches.length ? (headingMatches[i + 1].index ?? text.length) : text.length
    const body = text.slice(start, end)
    const heading = (match[1] ?? "").trim()
    const tldrMatch = body.match(TLDR_RE)
    return { heading, tldrMarkdown: tldrMatch ? tldrMatch[1].trim() : "" }
  })
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = parseChangelog(raw)
export const LATEST_CHANGELOG_VERSION = CHANGELOG_ENTRIES[0]?.heading ?? ""
