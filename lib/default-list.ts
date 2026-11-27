// A list the user edits, saved in the browser, whose defaults grow with the
// app (the Library's vector sources listed in the sidebar): a saved list
// would otherwise never receive a default added after it was saved. The ids
// already offered are remembered beside the list, so a new default is added
// once, and one the user removed is not put back.
//
// Pure, so it runs under Node (lib/vector-sources.test.ts); the browser side
// is applyNewDefaults, called by lib/settings-atoms.ts before the atom reads
// its storage.

/** `saved` (the stored list, or null when nothing is stored) with the
 *  defaults not yet in `seen` appended; `seen` becomes every default. With
 *  no record of what was seen, a default missing from the list counts as
 *  new: the list predates it or the user removed it, and only the first can
 *  be acted on. */
export function mergeNewDefaults(saved: unknown, seen: unknown, defaults: readonly string[]): { list: string[] | null; seen: string[] } {
  const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null)
  const list = strings(saved)
  if (!list) return { list: null, seen: [...defaults] }
  const known = new Set(strings(seen) ?? [])
  const fresh = defaults.filter((id) => !known.has(id) && !list.includes(id))
  return { list: fresh.length ? [...list, ...fresh] : list, seen: [...defaults] }
}

/** Brings the list saved under `key` in localStorage up to the defaults
 *  (see mergeNewDefaults); what was offered is kept under `${key}Seen`.
 *  Does nothing outside a browser or when storage is closed. */
export function applyNewDefaults(key: string, defaults: readonly string[]): void {
  try {
    if (typeof localStorage === "undefined") return
    const read = (k: string): unknown => { const v = localStorage.getItem(k); return v === null ? null : JSON.parse(v) }
    const saved = read(key)
    const { list, seen } = mergeNewDefaults(saved, read(`${key}Seen`), defaults)
    if (list && list !== saved) localStorage.setItem(key, JSON.stringify(list))
    localStorage.setItem(`${key}Seen`, JSON.stringify(seen))
  } catch { /* private mode, a corrupt value: the atom's own default applies */ }
}
