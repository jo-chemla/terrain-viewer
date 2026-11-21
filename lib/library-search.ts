/**
 * The text filter of the source libraries (Library dialog, Bring Your Own
 * Data lists).
 *
 * A plain `includes` missed the obvious spellings of one thing: "landcover",
 * "land cover" and "land-cover" are three different strings, and a dropped
 * letter ("lancover") found nothing. Two rules, no dependency:
 *
 * 1. Separators do not count. The row's text and each word of the query are
 *    folded (lower case, accents dropped) and stripped of everything that is
 *    not a letter or a digit; every word of the query must then be found in
 *    the row. "land-cover" is one word, "landcover"; "land cover" is two,
 *    both found in "ESA WorldCover 10m Land Cover".
 * 2. Typos only when nothing matches. If no row passes rule 1, a query word
 *    of four letters or more also matches a word of the row, or two words in
 *    a row run together, one edit away (two from eight letters). Kept as a
 *    fallback so an exact query never picks up near misses.
 */

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
const squash = (s: string) => s.replace(/[^a-z0-9]+/g, "")

/** The words of a query: split on white space, each stripped of separators. */
export function queryWords(query: string): string[] {
  return fold(query).split(/\s+/).map(squash).filter(Boolean)
}

interface Prepared { squashed: string; words: string[] }
function prepare(text: string): Prepared {
  const words = fold(text).split(/[^a-z0-9]+/).filter(Boolean)
  return { squashed: words.join(""), words }
}

/** Edit distance (insert, delete, substitute, swap of neighbours), given up
 *  as soon as it passes `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      row.push(v)
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev2 = prev
    prev = row
  }
  return prev[b.length]
}

function fuzzyWord(word: string, row: Prepared): boolean {
  if (row.squashed.includes(word)) return true
  if (word.length < 4) return false
  const max = word.length >= 8 ? 2 : 1
  for (let i = 0; i < row.words.length; i++) {
    if (editDistance(word, row.words[i], max) <= max) return true
    if (i + 1 < row.words.length && editDistance(word, row.words[i] + row.words[i + 1], max) <= max) return true
  }
  return false
}

/** The rows a query keeps, in their order: all of them for an empty query,
 *  the exact matches when there are any, the near misses otherwise. */
export function searchLibrary<T>(rows: readonly T[], textOf: (row: T) => string, query: string): T[] {
  const words = queryWords(query)
  if (!words.length) return [...rows]
  const prepared = rows.map((r) => prepare(textOf(r)))
  const exact = rows.filter((_, i) => words.every((w) => prepared[i].squashed.includes(w)))
  if (exact.length) return exact
  return rows.filter((_, i) => words.every((w) => fuzzyWord(w, prepared[i])))
}

/** Whether one text passes the exact rule (rule 1) alone, for a caller that
 *  filters a single row and has no list to fall back over. */
export function matchesLibraryQuery(text: string, query: string): boolean {
  const words = queryWords(query)
  if (!words.length) return true
  const row = prepare(text)
  return words.every((w) => row.squashed.includes(w))
}
