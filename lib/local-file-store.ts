// In-memory registry for user-picked local COG files, so a "Local COG file"
// BYOD terrain source can stream straight off the user's disk via
// `URL.createObjectURL` + the existing `cog://` protocol (geomatico's
// geotiff.js reader Range-fetches blob: URLs the same way it does https:// —
// confirmed 206/Content-Range support against a blob: URL in this app's target
// Chromium build) — no companion server, no upload.
//
// The persisted CustomTerrainSource (settings-atoms.ts, localStorage-backed)
// can only hold a stable string, never the File itself or a blob: URL (blob
// URLs die with the document that created them), so its `url` field instead
// holds a `local://<id>` placeholder — see makeLocalFileUrl/isLocalFileUrl/
// localFileId below. The real File and its live object URL are looked up here
// by that id.
//
// registerLocalFileCore's Maps below are themselves still purely in-memory
// (reset on every reload) — what makes a file survive a reload is
// opfs-file-store.ts, a best-effort side channel: registerLocalFileAtom
// fires a background write there, and hydrateAllPersistedCogs (called once
// on app start, see TerrainViewer.tsx) reads any previously-persisted files
// back into these same Maps before anything asks for them. Everywhere else in
// the app (resolveLocalFileUrl and its callers) is unaware this happens —
// they just see the File already present, exactly as if it had been picked
// again this session. If OPFS isn't supported or a file was never persisted
// (or got evicted), the Maps stay empty for that id and the existing
// "Re-select file…" affordance (custom-source-details.tsx) still applies.
import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { persistCogFile, readPersistedCogFile } from "./opfs-file-store"

const files = new Map<string, File>()
const objectUrls = new Map<string, string>()

/** Bumped on every register/clear so components reading it re-render — the
 *  Maps above are plain mutable state jotai/React have no visibility into. */
export const localFileVersionAtom = atom(0)

/** User-facing opt-out for the OPFS side channel above — on by default.
 *  Turning it off only stops *new* writes; it doesn't retroactively delete
 *  anything already persisted (see the "Clear persisted local files" action
 *  in settings-dialog.tsx for that). */
export const persistLocalCogsAtom = atomWithStorage("persistLocalCogs", true)

export const LOCAL_FILE_URL_PREFIX = "local://"

export function isLocalFileUrl(url: string): boolean {
  return url.startsWith(LOCAL_FILE_URL_PREFIX)
}

export function localFileId(url: string): string {
  return url.slice(LOCAL_FILE_URL_PREFIX.length)
}

export function makeLocalFileUrl(id: string): string {
  return `${LOCAL_FILE_URL_PREFIX}${id}`
}

/** The actual Maps mutation, factored out so hydrateAllPersistedCogs (below)
 *  can populate them from a background effect without going through jotai —
 *  it bumps localFileVersionAtom itself afterward via a plain hook. */
function registerLocalFileCore(id: string, file: File): void {
  const prevUrl = objectUrls.get(id)
  if (prevUrl) URL.revokeObjectURL(prevUrl)
  files.set(id, file)
  objectUrls.set(id, URL.createObjectURL(file))
}

/** Registers (or replaces) the File behind a `local://<id>` source. Write-only
 *  atom so callers get the version bump for free via useSetAtom. Also fires a
 *  best-effort, fire-and-forget OPFS write (see opfs-file-store.ts) so the
 *  file survives a reload — failures there are silent and don't affect this
 *  session's usage at all. */
export const registerLocalFileAtom = atom(null, (get, set, { id, file }: { id: string; file: File }) => {
  registerLocalFileCore(id, file)
  set(localFileVersionAtom, (v) => v + 1)
  if (get(persistLocalCogsAtom)) {
    persistCogFile(id, file)
  }
})

/** Repopulates the in-memory Maps for every given id from OPFS, for whichever
 *  ones aren't already registered this session (a fresh pick always wins —
 *  this never overwrites an already-registered File). Calls `onHydrated` for
 *  each id actually restored so the caller can bump localFileVersionAtom.
 *  Silently skips ids OPFS never had (never persisted, evicted, or OPFS
 *  unsupported) — those still fall through to the existing
 *  "Re-select file…" affordance. */
export async function hydrateAllPersistedCogs(ids: string[], onHydrated: (id: string) => void): Promise<void> {
  for (const id of ids) {
    if (files.has(id)) continue
    const file = await readPersistedCogFile(id)
    if (file) {
      registerLocalFileCore(id, file)
      onHydrated(id)
    }
  }
}

/** This session's blob: URL for a `local://<id>` source, or null if the file
 *  hasn't been (re-)picked yet — e.g. right after a reload. */
export function resolveLocalFileUrl(id: string): string | null {
  return objectUrls.get(id) ?? null
}

export function getLocalFileName(id: string): string | null {
  return files.get(id)?.name ?? null
}

export interface LocalCogValidation {
  isTiled: boolean
  hasOverviews: boolean
  /** EPSG code of the COG's own CRS, when readable from its GeoKeys. */
  epsg: number | null
}

// A handful of real user-picked files (a Copernicus DSM export, several
// in-house DEM/REM exports) turned out to be plain strip-organized GeoTIFFs —
// GDAL's default when a file isn't explicitly written with `-of COG` / `-co
// TILED=YES` — despite being named/treated as COGs. Reading a window from a
// strip TIFF forces the client-side reader to decode far more of the file
// than one tile needs (a strip spans the full image width, and there's no
// overview to fall back to at a coarser zoom), repeatedly, on every pan/zoom
// — which is what surfaced as "RangeError: Array buffer allocation failed"
// deep inside geotiff.js's resampler rather than as a clear error here.
//
// Separately, @geomatico/maplibre-cog-protocol's math (lib/read/math.js)
// hardcodes every COG as already being in Web Mercator (EPSG:3857) — it feeds
// the raw pixel resolution straight into a mercator-meters zoom formula, and
// inverse-mercator-projects the raw bounding box coordinates as if they were
// already mercator meters, with no reprojection step at all. A geographic
// (EPSG:4326, degrees) source gets its degree-sized pixels misread as
// meter-sized ones, producing a wildly inflated "native zoom" (confirmed:
// mixing units this way is what fed z=27+ into the setTerrain crash fixed
// earlier); a different projected CRS (e.g. a UTM zone) has the right units
// but the wrong origin, so the computed bbox lands nowhere near the real
// data and "fit to bounds" flies to the wrong place. Only a source already
// warped to EPSG:3857 (e.g. `gdalwarp -t_srs EPSG:3857`) has correct bounds/
// zoom through this library — titiler-streamed COGs don't have this problem
// since rio-tiler reprojects server-side.
/** Best-effort structural + CRS check on a picked local file, so the BYOD
 *  modal can warn before either problem above turns into a cryptic crash or
 *  silently-wrong bounds. Never throws — a failure here (e.g. a corrupt file)
 *  shouldn't block adding the source; the real error will surface when the
 *  source is actually used. */
export async function validateLocalCogFile(file: File): Promise<LocalCogValidation | null> {
  try {
    const { fromBlob } = await import("geotiff")
    const tiff = await fromBlob(file)
    const image = await tiff.getImage()
    const imageCount = await tiff.getImageCount()
    const geoKeys = image.geoKeys as { ProjectedCSTypeGeoKey?: number; GeographicTypeGeoKey?: number } | undefined
    const epsg = geoKeys?.ProjectedCSTypeGeoKey ?? geoKeys?.GeographicTypeGeoKey ?? null
    return { isTiled: image.isTiled, hasOverviews: imageCount > 1, epsg }
  } catch {
    return null
  }
}
