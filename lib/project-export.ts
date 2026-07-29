// Whole-project import/export: bundles the BYOD sources, bookmarks, drawing
// layers and jotai `atomWithStorage` config settings a user might want to
// carry between browsers/machines into a single downloadable JSON file.
// Each category is optional per-export/import (see import-export-project-
// dialog.tsx's checkboxes) and reuses the same upsert-by-id merge convention
// bookmarks-section.tsx's mergeImportedBookmarks already established, so
// re-importing a previously-exported file is idempotent rather than
// duplicating everything.
//
// Deliberately reads/writes localStorage directly instead of going through
// each atom's own setter — there'd otherwise be ~20 settings atoms to import
// here just to write them, and jotai's atomWithStorage is itself a thin
// JSON-serialize wrapper over the exact same keys. Callers must reload the
// page after an import (see applyProjectImport's own note) since already-
// mounted components/atoms won't pick up a raw localStorage write on their
// own.
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate"
import type { CustomTerrainSource, CustomBasemapSource } from "./settings-atoms"
import type { Bookmark } from "./bookmarks"
import type { DrawLayer, GeoJSONFeature } from "@/components/TerrainControlPanel/TerraDrawSystem"
import { persistVectorLayerFeatures, readPersistedVectorLayerFeatures } from "./opfs-vector-store"
import { readPersistedCogFile, persistCogFile, estimateStorage, formatBytes } from "./opfs-file-store"
import { isLocalFileUrl, localFileId, getRegisteredLocalFile } from "./local-file-store"

const PROJECT_EXPORT_VERSION = 1

/** Curated jotai `atomWithStorage` keys exported/imported as "Settings" —
 *  deliberately excludes pure UI fold/scroll state (isSettings*Open,
 *  isByodOpen, sectionOpen, sidebarScroll, macroGroupOpen,
 *  bookmarksListHeight, vizModePinned, ...) and whatever the other three
 *  checkboxes already cover (customTerrainSources/customBasemapSources ->
 *  Sources, bookmarks -> Bookmarks, drawingLayers -> Drawings), keeping this
 *  bucket to values a user would actually want to carry to a new machine. */
const SETTINGS_STORAGE_KEYS = [
  "mapboxKey", "googleKey", "mapzenKey", "maptilerKey", "titilerEndpoint", "maxResolution",
  "colorRampType", "licenseFilter", "highResTerrain", "cacheVizTiles",
  "terrainAnalysisAdvanced", "reliefVisualizationAdvanced",
  "useCogProtocolVsTitiler", "useClientExport", "isTransparentUi",
  "customThemes", "persistVectorLayers", "persistLocalCogs",
  "anim-resolution-key", "anim-render-quality", "anim-fps", "anim-target-size-mb",
] as const

export interface ProjectExportSelection {
  sources: boolean
  bookmarks: boolean
  drawings: boolean
  settings: boolean
  /** The current nuqs view/viz-mode state (viewport + every visualization
   *  toggle) — the same state a bookmark already captures as a query string,
   *  but for "what's on screen right now" rather than a saved point. */
  viewState: boolean
  /** Only meaningful when `sources` is also checked and at least one BYOD
   *  source is a locally-picked file (see hasLocalFileSources) — bundles
   *  each such file's raw bytes into a .zip alongside the JSON payload
   *  instead of leaving just that source's settings behind. */
  localCogs: boolean
}

export interface ProjectExportPayload {
  version: number
  /** Epoch ms. */
  exportedAt: number
  sources?: { customTerrainSources: CustomTerrainSource[]; customBasemapSources: CustomBasemapSource[] }
  bookmarks?: Bookmark[]
  drawings?: { layers: DrawLayer[]; features: GeoJSONFeature[] }
  settings?: Record<string, unknown>
  /** The current URL's query string (no leading "?") at export time — same
   *  shape/convention as a Bookmark's own `search` field, and parsed back
   *  the same way (lib/bookmarks.ts's parseBookmarkSearch) on import. This
   *  is a raw STRING, not a decoded object, on purpose: a search string only
   *  contains whatever fields were actually non-default when captured, so
   *  re-applying it through parseBookmarkSearch + setState only ever writes
   *  those same fields back — this is what keeps the URL compact. Passing a
   *  fully-populated object with every field explicit here instead once
   *  blew well past the URL length limit (2026-07-28: dozens of per-mode
   *  colour-ramp custom-stops arrays that are normally never written to the
   *  URL at all got written explicitly on every import). */
  viewState?: string
}

function readLocalJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeLocalJSON(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value))
}

/** Upserts by `id` — re-importing a previously-exported file updates
 *  matching entries in place instead of duplicating them, the same
 *  convention bookmarks.ts's mergeImportedBookmarks already uses. */
function mergeById<T extends { id: string }>(existing: T[], imported: T[]): T[] {
  const byId = new Map(existing.map((item) => [item.id, item]))
  for (const item of imported) byId.set(item.id, item)
  return Array.from(byId.values())
}

/** Same idea as mergeById, but for GeoJSON features whose `id` is optional
 *  (terra-draw doesn't always assign one) — id-less features are kept as-is
 *  from both sides rather than collapsed onto each other. */
function mergeFeaturesById(existing: GeoJSONFeature[], imported: GeoJSONFeature[]): GeoJSONFeature[] {
  const byId = new Map<string, GeoJSONFeature>()
  const idLess: GeoJSONFeature[] = []
  for (const f of [...existing, ...imported]) {
    if (f.id != null) byId.set(String(f.id), f)
    else idLess.push(f)
  }
  return [...byId.values(), ...idLess]
}

/** True if any exported/imported BYOD source references a browser-local file
 *  (`cog-local`) — only the OPFS best-effort byte cache and an in-memory
 *  `File` back those on the machine that added them, so a JSON export can't
 *  carry the actual bytes. The other side will need to re-select the file
 *  (existing "Re-select file…" affordance in custom-source-details.tsx)
 *  before that source renders. */
export function hasLocalFileSources(sources?: ProjectExportPayload["sources"]): boolean {
  if (!sources) return false
  return sources.customTerrainSources.some((s) => s.type === "cog-local") || sources.customBasemapSources.some((s) => s.type === "cog-local")
}

function buildProjectExport(
  selection: ProjectExportSelection,
  live: { bookmarks: Bookmark[]; drawingLayers: DrawLayer[]; drawingFeatures: GeoJSONFeature[]; viewState: string },
): ProjectExportPayload {
  const payload: ProjectExportPayload = { version: PROJECT_EXPORT_VERSION, exportedAt: Date.now() }

  if (selection.sources) {
    payload.sources = {
      customTerrainSources: readLocalJSON("customTerrainSources", []),
      customBasemapSources: readLocalJSON("customBasemapSources", []),
    }
  }
  if (selection.bookmarks) payload.bookmarks = live.bookmarks
  if (selection.drawings) payload.drawings = { layers: live.drawingLayers, features: live.drawingFeatures }
  if (selection.settings) {
    const settings: Record<string, unknown> = {}
    for (const key of SETTINGS_STORAGE_KEYS) {
      const value = readLocalJSON<unknown>(key, undefined)
      if (value !== undefined) settings[key] = value
    }
    payload.settings = settings
  }
  if (selection.viewState) payload.viewState = live.viewState
  return payload
}

const PROJECT_JSON_ENTRY = "project.json"

/** Subfolder holding one `<bookmark.id>.jpg` per exported bookmark that has a
 *  thumbnail. In a plain export (`selection.localCogs` off) these sit
 *  alongside project.json's own inlined base64 `thumb` — pure convenience so
 *  the zip's contents are browsable as real image files without unpacking the
 *  JSON, while the JSON itself stays fully self-contained. In a `localCogs`
 *  export, where the user is already bundling large binary COG bytes into a
 *  real multi-file zip, project.json's `thumb` field is instead REWRITTEN to
 *  this relative path (see buildProjectExportArchive) rather than duplicating
 *  the same ~100KB of image data twice (once as base64 text, ~33% larger, a
 *  second time as the raw file) — parseProjectExportArchive/applyProjectImport
 *  resolve that reference back into a real data URL on import. */
const BOOKMARK_THUMBS_DIR = "bookmarks_thumbs"

function bookmarkThumbEntryName(bookmarkId: string): string {
  return `${BOOKMARK_THUMBS_DIR}/${bookmarkId}.jpg`
}

/** Decodes a `data:<mime>;base64,<...>` URL (the format
 *  captureBookmarkThumbnail in controls-utils.tsx produces) into raw bytes.
 *  Returns null for anything else (e.g. a future non-data-URL thumb format,
 *  or the `bookmarks_thumbs/<id>.jpg` path reference a localCogs export
 *  rewrites `thumb` to instead — see BOOKMARK_THUMBS_DIR). */
function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const match = /^data:[^;]+;base64,([\s\S]*)$/.exec(dataUrl)
  if (!match) return null
  const binary = atob(match[1])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Inverse of dataUrlToBytes — used to resolve a `bookmarks_thumbs/<id>.jpg`
 *  path reference (see BOOKMARK_THUMBS_DIR) back into the real data URL
 *  Bookmark.thumb is expected to hold everywhere else in the app. */
function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:${mime};base64,${btoa(binary)}`
}

function collectLocalCogIds(sources?: ProjectExportPayload["sources"]): string[] {
  if (!sources) return []
  const ids = new Set<string>()
  for (const s of [...sources.customTerrainSources, ...sources.customBasemapSources]) {
    if (s.type === "cog-local" && isLocalFileUrl(s.url)) ids.add(localFileId(s.url))
  }
  return Array.from(ids)
}

export interface ProjectExportArchive {
  bytes: Uint8Array
  /** cog-local source ids whose bytes actually made it into the zip. */
  bundledCogIds: string[]
  /** cog-local source ids that COULDN'T be bundled — neither this session's
   *  live registry nor the OPFS-persisted copy had them (never persisted,
   *  evicted by opfs-file-store.ts's size-capped LRU — a large Alps/region-
   *  wide DEM can easily exceed the 1.5GB store cap — OPFS unsupported, or
   *  `persistLocalCogsAtom` was off when the file was added). These sources'
   *  settings still travel via project.json; only the bytes are missing,
   *  same end state as a plain (non-localCogs) export. */
  missingCogIds: string[]
}

/** Builds a downloadable archive: `project.json` (the same payload
 *  buildProjectExport produces) plus one `bookmarks_thumbs/<id>.jpg` per
 *  exported bookmark that has a thumbnail (see BOOKMARK_THUMBS_DIR). When
 *  `selection.localCogs` is set, project.json's own `thumb` field is
 *  rewritten to reference that file (`"bookmarks_thumbs/<id>.jpg"`) instead
 *  of inlining the base64 a second time — the user is already bundling large
 *  binary COG bytes into a real zip at that point, so it's worth not
 *  duplicating thumbnail bytes too; otherwise (a plain, non-localCogs export)
 *  the JSON keeps its base64 copy inline, self-contained.
 *
 *  Also bundles, when `selection.localCogs` is set, one `<id>.cog.tiff` entry
 *  per locally-picked BYOD source referenced in it — read from whichever copy
 *  is freshest (this session's live registered File, falling back to the
 *  OPFS-persisted copy). Level 0 (store, no deflate) since COG bytes are
 *  already large binary data not worth spending CPU trying to compress. */
export async function buildProjectExportArchive(
  selection: ProjectExportSelection,
  live: { bookmarks: Bookmark[]; drawingLayers: DrawLayer[]; drawingFeatures: GeoJSONFeature[]; viewState: string },
): Promise<ProjectExportArchive> {
  const payload = buildProjectExport(selection, live)
  const entries: Record<string, Uint8Array> = {}
  const bundledCogIds: string[] = []
  const missingCogIds: string[] = []

  if (payload.bookmarks) {
    payload.bookmarks = payload.bookmarks.map((bookmark) => {
      const bytes = bookmark.thumb ? dataUrlToBytes(bookmark.thumb) : null
      if (!bytes) return bookmark
      entries[bookmarkThumbEntryName(bookmark.id)] = bytes
      return selection.localCogs ? { ...bookmark, thumb: bookmarkThumbEntryName(bookmark.id) } : bookmark
    })
  }

  entries[PROJECT_JSON_ENTRY] = strToU8(JSON.stringify(payload, null, 2))

  if (selection.localCogs) {
    for (const id of collectLocalCogIds(payload.sources)) {
      const file = getRegisteredLocalFile(id) ?? (await readPersistedCogFile(id))
      if (!file) {
        missingCogIds.push(id)
        console.warn(`[project-export] no bytes available for local COG source "${id}" — never persisted, evicted, or OPFS unsupported; only its settings will travel.`)
        continue
      }
      entries[`${id}.cog.tiff`] = new Uint8Array(await file.arrayBuffer())
      bundledCogIds.push(id)
    }
  }
  return { bytes: zipSync(entries, { level: 0 }), bundledCogIds, missingCogIds }
}

/** Reverse of buildProjectExportArchive. `isZip` picks the parse path — a
 *  plain (non-zip) export is still accepted for backward compatibility with
 *  files exported before this bundling existed, or a fresh export with
 *  `localCogs` left unchecked. `bookmarkThumbBytesById` is only ever
 *  non-empty for a `localCogs` export, whose bookmarks reference
 *  `bookmarks_thumbs/<id>.jpg` instead of inlining base64 — see
 *  applyProjectImport, which resolves that reference back into a real data
 *  URL using this map before writing bookmarks to localStorage. */
export function parseProjectExportArchive(
  bytes: Uint8Array,
  isZip: boolean,
): { payload: ProjectExportPayload; cogBytesById: Map<string, Uint8Array>; bookmarkThumbBytesById: Map<string, Uint8Array> } {
  if (!isZip) {
    return { payload: JSON.parse(strFromU8(bytes)), cogBytesById: new Map(), bookmarkThumbBytesById: new Map() }
  }
  const entries = unzipSync(bytes)
  const projectEntry = entries[PROJECT_JSON_ENTRY]
  if (!projectEntry) throw new Error("zip has no project.json entry")
  const payload = JSON.parse(strFromU8(projectEntry))
  const cogBytesById = new Map<string, Uint8Array>()
  const bookmarkThumbBytesById = new Map<string, Uint8Array>()
  const bookmarkThumbPrefix = `${BOOKMARK_THUMBS_DIR}/`
  for (const [name, data] of Object.entries(entries)) {
    if (name === PROJECT_JSON_ENTRY) continue
    if (name.startsWith(bookmarkThumbPrefix) && name.endsWith(".jpg")) {
      bookmarkThumbBytesById.set(name.slice(bookmarkThumbPrefix.length, -".jpg".length), data)
      continue
    }
    // Only `.cog.tiff` entries beyond this point are bytes to re-hydrate on
    // import — anything else is purely a convenience extra, not re-imported.
    if (!name.endsWith(".cog.tiff")) continue
    cogBytesById.set(name.replace(/\.cog\.tiff$/, ""), data)
  }
  return { payload, cogBytesById, bookmarkThumbBytesById }
}

/** Applies an imported payload on top of whatever's already here — sources/
 *  bookmarks/drawing-layers upsert by id, a drawing layer's features merge
 *  into that layer's existing OPFS-persisted features, and settings values
 *  overwrite outright (single scalars, no meaningful "merge").
 *
 *  Writes straight to localStorage/OPFS rather than through jotai's atoms
 *  (see this module's own header comment) — callers MUST reload the page
 *  afterwards for already-mounted components to pick the change up.
 *
 *  `cogBytesById` (from parseProjectExportArchive, empty for a plain-JSON
 *  import) is persisted into the SAME OPFS store local-file-store.ts's own
 *  hydrateAllPersistedCogs already reads from on app start — so once these
 *  sources are merged in above and the page reloads, the existing "local COG
 *  hydration" flow picks the bytes up exactly as if the file had been
 *  persisted on this machine originally, no separate wiring needed.
 *
 *  Returns which cog-local ids actually got persisted here vs which failed
 *  (e.g. this machine's own OPFS quota rejected a large DEM even though the
 *  zip carried its bytes fine — opfs-file-store.ts's persist() never throws,
 *  it just returns false) so the caller can tell the user which sources will
 *  still need "Re-select file…" despite the bytes having been bundled.
 *
 *  `bookmarkThumbBytesById` (from parseProjectExportArchive, empty for a
 *  plain-JSON import or a non-localCogs zip) resolves any bookmark whose
 *  `thumb` is a `bookmarks_thumbs/<id>.jpg` path reference (see
 *  BOOKMARK_THUMBS_DIR) back into a real data URL before it's written to
 *  localStorage — every other reader of Bookmark.thumb in the app (the
 *  sidebar list, the gallery modal) uses it directly as an `<img src>` and
 *  has no reason to know a zip-relative-path form ever existed. */
export async function applyProjectImport(
  payload: ProjectExportPayload,
  cogBytesById?: Map<string, Uint8Array>,
  bookmarkThumbBytesById?: Map<string, Uint8Array>,
): Promise<{ persistedCogIds: string[]; failedCogIds: string[] }> {
  if (payload.sources) {
    const existingTerrain = readLocalJSON<CustomTerrainSource[]>("customTerrainSources", [])
    const existingBasemap = readLocalJSON<CustomBasemapSource[]>("customBasemapSources", [])
    writeLocalJSON("customTerrainSources", mergeById(existingTerrain, payload.sources.customTerrainSources))
    writeLocalJSON("customBasemapSources", mergeById(existingBasemap, payload.sources.customBasemapSources))
  }

  if (payload.bookmarks) {
    const existing = readLocalJSON<Bookmark[]>("bookmarks", [])
    const resolvedImported = payload.bookmarks.map((bookmark) => {
      if (!bookmark.thumb || bookmark.thumb.startsWith("data:")) return bookmark
      // A non-"data:" thumb is a bookmarks_thumbs/<id>.jpg reference (only
      // ever produced by a localCogs export) — resolve it back to a real
      // data URL, or drop it if this archive somehow didn't carry the file.
      const bytes = bookmarkThumbBytesById?.get(bookmark.id)
      return { ...bookmark, thumb: bytes ? bytesToDataUrl(bytes, "image/jpeg") : null }
    })
    writeLocalJSON("bookmarks", mergeById(existing, resolvedImported))
  }

  if (payload.drawings) {
    const existingLayers = readLocalJSON<DrawLayer[]>("drawingLayers", [])
    writeLocalJSON("drawingLayers", mergeById(existingLayers, payload.drawings.layers))

    const featuresByLayer = new Map<string, GeoJSONFeature[]>()
    for (const feature of payload.drawings.features) {
      const layerId = feature.properties?.layerId
      if (!layerId) continue
      const bucket = featuresByLayer.get(layerId) ?? []
      bucket.push(feature)
      featuresByLayer.set(layerId, bucket)
    }
    await Promise.all(
      Array.from(featuresByLayer.entries()).map(async ([layerId, imported]) => {
        const existingFeatures = (await readPersistedVectorLayerFeatures<GeoJSONFeature>(layerId)) ?? []
        await persistVectorLayerFeatures(layerId, mergeFeaturesById(existingFeatures, imported))
      }),
    )
  }

  if (payload.settings) {
    for (const [key, value] of Object.entries(payload.settings)) writeLocalJSON(key, value)
  }

  const persistedCogIds: string[] = []
  const failedCogIds: string[] = []
  if (cogBytesById && cogBytesById.size) {
    // `as BlobPart` — TS's DOM lib type for Blob's constructor wants a
    // Uint8Array<ArrayBuffer> specifically, but these bytes come back as the
    // wider Uint8Array<ArrayBufferLike> (from fflate's unzipSync); a plain
    // Uint8Array is accepted by Blob at runtime regardless, this is purely a
    // type-level mismatch (same one import-export-project-dialog.tsx hits
    // wrapping zipSync's output).
    await Promise.all(
      Array.from(cogBytesById.entries()).map(async ([id, bytes]) => {
        const ok = await persistCogFile(id, new Blob([bytes as BlobPart], { type: "image/tiff" }))
        if (ok) {
          persistedCogIds.push(id)
        } else {
          failedCogIds.push(id)
          // Diagnostic (2026-07-28): a non-secure origin (plain http:// on a
          // LAN IP, as opposed to `localhost` — which browsers treat as a
          // secure context even over http — or a real https:// deployment)
          // gets a MUCH smaller storage quota in most browsers, and
          // `navigator.storage.persist()` (called opportunistically right
          // after a successful write, see opfs-file-store.ts) typically
          // outright refuses to grant persistence at all outside a secure
          // context. Logging isSecureContext + the real quota estimate here
          // turns "likely quota" into a confirmed diagnosis instead of a guess.
          const estimate = await estimateStorage()
          console.warn(
            `[project-export] failed to persist local COG "${id}" on import — its settings were still imported, but you'll need to re-select the file. `
            + `Diagnostic: isSecureContext=${typeof window !== "undefined" ? window.isSecureContext : "?"}, origin=${typeof location !== "undefined" ? location.origin : "?"}, `
            + `storage usage=${formatBytes(estimate.usageBytes)}, quota=${estimate.quotaBytes != null ? formatBytes(estimate.quotaBytes) : "unknown"}. `
            + `A non-https, non-localhost origin (e.g. a plain LAN IP like http://192.168.x.x) commonly gets a far smaller quota and is denied persistent storage — serving over https (or accessing via localhost) usually fixes this.`,
          )
        }
      }),
    )
  }
  return { persistedCogIds, failedCogIds }
}
