// A share link that names the user's own sources by their remote URL rather
// than by the id that only exists in the sender's localStorage: the
// recipient's app then registers them from the link (the URL-as-id rule in
// TerrainViewer.tsx: ?sourceB=https://host/dem.tif, ?basemapSource=https://
// tiles/{z}/{x}/{y}.png, ?overlayBasemapIds=https://...), whether or not it
// has them in its library or BYOD lists.
//
// Only what the link side can express travels: a remote http(s) URL and a
// type the URL rule infers (a {z} template is terrarium / tms, anything else
// a COG) or that one ?terrainType= / ?basemapType= names for the whole link,
// plus ?viaTitiler=1 when a replaced COG is pinned to titiler. Local files
// (cog-local, image-local), georeferenced images, and entries that need more
// than a URL and a type (custom RGB encodings, nodata sentinels, tile sizes,
// zoom limits) stay by id, and the result reports them so the sender knows.
import type { CustomTerrainSource, CustomBasemapSource } from "@/lib/settings-atoms"
import customSourcesData from "@/lib/custom-sources.json"

const LIBRARY_TERRAIN_IDS = new Set(((customSourcesData as any)["SAMPLE_TERRAIN_SOURCES"] as { id: string }[]).map((s) => s.id))
const LIBRARY_BASEMAP_IDS = new Set(((customSourcesData as any)["SAMPLE_BASEMAPS_SOURCES"] as { id: string }[]).map((s) => s.id))

const isRemote = (url: string | undefined): url is string => !!url && /^https?:\/\//i.test(url)
// The terrain state fields (sourceA..H) travel as terrainSourceA..H in the
// address bar (lib/url-keys.ts); the legacy bare key is accepted too.
const TERRAIN_FIELD = /^(terrainSource|source)[A-H]$/
const BASEMAP_FIELD = /^basemapSource[A-H]?$/
const OVERLAY_FIELD = /^overlayBasemapIds[B-H]?$/

/** Fields beyond url + type that the URL rule cannot carry. */
const TERRAIN_EXTRAS = ["encoding", "redFactor", "greenFactor", "blueFactor", "baseShift", "tileSize", "maxzoom", "minzoom", "nodata", "titilerNodata", "bounds"]
const BASEMAP_EXTRAS = ["maxzoom", "minzoom", "bounds", "coordinates", "georef", "stack"]

const inferredTerrainType = (url: string) => (url.includes("{z}") ? "terrarium" : "cog")
const inferredBasemapType = (url: string) => (url.includes("{z}") ? "tms" : "cog")

/** ?sourceNames=<url>=<name>,<url>=<name> (each part URI-encoded): the
 *  display names of the sources a link names by URL, read back when the
 *  recipient's app registers them (TerrainViewer.tsx's URL-source effects). */
export function parseSourceNames(param: string | null): Map<string, string> {
  const out = new Map<string, string>()
  if (!param) return out
  for (const pair of param.split(",")) {
    const i = pair.indexOf("=")
    if (i <= 0) continue
    try { out.set(decodeURIComponent(pair.slice(0, i)), decodeURIComponent(pair.slice(i + 1))) } catch {}
  }
  return out
}
function serializeSourceNames(names: Map<string, string>): string {
  return Array.from(names, ([url, name]) => `${encodeURIComponent(url)}=${encodeURIComponent(name)}`).join(",")
}

export interface PortableResult {
  url: string
  /** Names of the sources now given by URL. */
  replaced: string[]
  /** Sources that had to stay by id, with the reason. */
  kept: { name: string; reason: string }[]
}

interface Candidate { url: string; name: string; type: string; inferred: string; viaTitiler: boolean }

/** Rewrites `href`'s source fields so every user-owned remote source is named
 *  by URL. Library entries (ids every copy of the app resolves) and values
 *  that already are URLs are left alone. */
export function makePortableShareUrl(href: string, terrainSources: CustomTerrainSource[], basemapSources: CustomBasemapSource[]): PortableResult {
  const url = new URL(href)
  const p = url.searchParams
  const kept = new Map<string, string>()
  const terrainById = new Map(terrainSources.map((s) => [s.id, s]))
  const basemapById = new Map(basemapSources.map((s) => [s.id, s]))

  // Pass 1: what each id could become.
  const candidate = (id: string, kind: "terrain" | "basemap"): Candidate | null => {
    if (isRemote(id)) return null
    if (kind === "terrain" ? LIBRARY_TERRAIN_IDS.has(id) : LIBRARY_BASEMAP_IDS.has(id)) return null
    const s = (kind === "terrain" ? terrainById.get(id) : basemapById.get(id)) as (CustomTerrainSource | CustomBasemapSource) | undefined
    if (!s) return null
    const t = s.type as string
    if (t === "cog-local" || t === "image-local" || !isRemote(s.url)) { kept.set(s.name, "local file"); return null }
    if (t === "image") { kept.set(s.name, "georeferenced image"); return null }
    const extras = (kind === "terrain" ? TERRAIN_EXTRAS : BASEMAP_EXTRAS).filter((k) => (s as any)[k] !== undefined && (s as any)[k] !== null)
    if (extras.length) { kept.set(s.name, `needs ${extras.join(", ")}`); return null }
    return { url: s.url, name: s.name, type: t, inferred: kind === "terrain" ? inferredTerrainType(s.url) : inferredBasemapType(s.url), viaTitiler: !!(s as any).cogViaTitiler }
  }

  const terrainFields: [string, Candidate | null][] = []
  const basemapFields: [string, (Candidate | null)[]][] = []
  for (const [key, value] of Array.from(p.entries())) {
    if (TERRAIN_FIELD.test(key)) terrainFields.push([key, candidate(value, "terrain")])
    else if (BASEMAP_FIELD.test(key)) basemapFields.push([key, [candidate(value, "basemap")]])
    else if (OVERLAY_FIELD.test(key)) basemapFields.push([key, value.split(",").filter(Boolean).map((id) => candidate(id, "basemap"))])
  }

  // One ?terrainType= / ?basemapType= per link: the sources whose type the
  // URL rule does not infer must agree on it (and with any override already
  // in the link), or they stay by id.
  const settle = (cands: (Candidate | null)[], param: string): Set<Candidate> => {
    const needing = cands.filter((c): c is Candidate => !!c && c.type !== c.inferred)
    const types = new Set(needing.map((c) => c.type))
    const existing = p.get(param)
    if (existing) types.add(existing)
    const ok = new Set<Candidate>()
    for (const c of cands) if (c && c.type === c.inferred) ok.add(c)
    if (types.size === 1 && needing.length) {
      p.set(param, Array.from(types)[0])
      for (const c of needing) ok.add(c)
    } else if (needing.length) {
      for (const c of needing) kept.set(c.name, `one ${param} per link (${c.type})`)
    }
    return ok
  }
  const okTerrain = settle(terrainFields.map(([, c]) => c), "terrainType")
  const okBasemap = settle(basemapFields.flatMap(([, cs]) => cs), "basemapType")

  // Pass 2: rewrite.
  const replaced = new Set<string>()
  const names = new Map<string, string>()
  let viaTitiler = false
  const apply = (c: Candidate | null, ok: Set<Candidate>, fallback: string): string => {
    if (!c || !ok.has(c)) return fallback
    replaced.add(c.name)
    names.set(c.url, c.name)
    if (c.viaTitiler) viaTitiler = true
    return c.url
  }
  for (const [key, c] of terrainFields) p.set(key, apply(c, okTerrain, p.get(key)!))
  for (const [key, cs] of basemapFields) {
    const ids = p.get(key)!.split(",").filter(Boolean)
    p.set(key, ids.map((id, i) => apply(cs[i], okBasemap, id)).join(","))
  }
  if (viaTitiler) p.set("viaTitiler", "1")
  if (names.size) p.set("sourceNames", serializeSourceNames(names)); else p.delete("sourceNames")
  return { url: url.toString(), replaced: Array.from(replaced), kept: Array.from(kept, ([name, reason]) => ({ name, reason })) }
}
