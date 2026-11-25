// Every CHANGELOG.md entry needs its `<!-- released: YYYY-MM-DD[THH:MM] -->`
// marker under the heading: it is the entry's key in Settings > What's new
// (the "since you last looked" comparison and the React key), so an entry
// without one never shows as new, and two entries with the same one collide.
// Same-day entries take a time suffix (their commit time) to stay distinct
// and ordered. The file is newest first.
//
//   node scripts/test-lib.mjs lib/changelog.test.ts   (from the repository root)
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { parseChangelog } from "./changelog"

const entries = parseChangelog(readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n"))
const MARKER = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/

test("CHANGELOG.md parses into entries", () => {
  assert.ok(entries.length > 30, `only ${entries.length} entries parsed`)
})

test("every entry has a released marker", () => {
  const missing = entries.filter((e) => !MARKER.test(e.releasedAt)).map((e) => `"${e.heading}" (${e.releasedAt || "no marker"})`)
  assert.deepEqual(missing, [], "add <!-- released: YYYY-MM-DDTHH:MM --> under these headings")
})

test("no two entries share a marker", () => {
  const seen = new Map<string, string>()
  const dupes: string[] = []
  for (const e of entries) {
    const other = seen.get(e.releasedAt)
    if (other) dupes.push(`${e.releasedAt}: "${other}" and "${e.heading}"`)
    seen.set(e.releasedAt, e.heading)
  }
  assert.deepEqual(dupes, [], "give same-day entries a time suffix (THH:MM)")
})

test("entries are newest first", () => {
  const out: string[] = []
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].releasedAt > entries[i - 1].releasedAt) out.push(`"${entries[i].heading}" (${entries[i].releasedAt}) is below "${entries[i - 1].heading}" (${entries[i - 1].releasedAt})`)
  }
  assert.deepEqual(out, [])
})
