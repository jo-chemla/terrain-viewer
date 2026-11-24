// The thematic sections of the Library dialogs. A library entry joins one by
// its `libraryGroup` field (lib/source-schema.ts); everything without one is
// sorted into the scope sections (Nation-wide, Global, Sub-national, City).
// A group is listed after the scope sections, in this order, and folded
// unless `defaultOpen`. Its title, blurb and keywords are part of what the
// Library's search reads of each of its rows, so "archaeology" or "relief"
// finds the whole group.
//
// Types and data only: imported by the dialog and by lib tests under Node.

export interface LibraryGroup {
  key: string
  title: string
  blurb: string
  /** Extra words the search matches on every row of the group. */
  keywords?: string
  /** Shown unfolded (default false: a group is a specialist shelf). */
  defaultOpen?: boolean
}

export const LIBRARY_GROUPS: readonly LibraryGroup[] = [
  {
    key: "relief",
    title: "Pre-rendered relief (archaeology)",
    blurb: "Shaded and enhanced relief already rendered by the publisher from lidar or a national DEM: hillshades (single and multi-directional), sky view factor, local relief, local dominance, openness, red relief maps, hypsometric tints. Imagery, not elevation: each stacks as an overlay over any terrain, and the app's own visualization modes do not apply to it. Several are non-commercial (CC BY-NC); check the licence before re-use.",
    keywords: "relief archaeology lidar hillshade shaded relief visualization svf sky view factor lrm local relief model local dominance openness red relief rrim hypsometric",
  },
]

const BY_KEY = new Map(LIBRARY_GROUPS.map((g) => [g.key, g]))

/** The group for a key: the registry's, or a plain one titled by the key. */
export function libraryGroup(key: string): LibraryGroup {
  return BY_KEY.get(key) ?? { key, title: key, blurb: "" }
}

/** The groups that rows use, registry order first, unknown keys after. */
export function usedLibraryGroups(keys: Iterable<string>): LibraryGroup[] {
  const used = new Set(keys)
  return [...LIBRARY_GROUPS.filter((g) => used.has(g.key)), ...[...used].filter((k) => !BY_KEY.has(k)).sort().map(libraryGroup)]
}
