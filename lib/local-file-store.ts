// In-memory (never persisted) registry for user-picked local COG files, so a
// "Local COG file" BYOD terrain source can stream straight off the user's disk
// via `URL.createObjectURL` + the existing `cog://` protocol (geomatico's
// geotiff.js reader Range-fetches blob: URLs the same way it does https:// —
// confirmed 206/Content-Range support against a blob: URL in this app's target
// Chromium build) — no companion server, no upload.
//
// The persisted CustomTerrainSource (settings-atoms.ts, localStorage-backed)
// can only hold a stable string, never the File itself or a blob: URL (blob
// URLs die with the document that created them), so its `url` field instead
// holds a `local://<id>` placeholder — see makeLocalFileUrl/isLocalFileUrl/
// localFileId below. The real File and its live object URL are looked up here
// by that id, and are only ever populated for the current session: after a
// reload the placeholder resolves to null until the user re-picks the file
// (see the "Re-select file…" affordance in custom-source-details.tsx).
import { atom } from "jotai"

const files = new Map<string, File>()
const objectUrls = new Map<string, string>()

/** Bumped on every register/clear so components reading it re-render — the
 *  Maps above are plain mutable state jotai/React have no visibility into. */
export const localFileVersionAtom = atom(0)

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

/** Registers (or replaces) the File behind a `local://<id>` source. Write-only
 *  atom so callers get the version bump for free via useSetAtom. */
export const registerLocalFileAtom = atom(null, (_get, set, { id, file }: { id: string; file: File }) => {
  const prevUrl = objectUrls.get(id)
  if (prevUrl) URL.revokeObjectURL(prevUrl)
  files.set(id, file)
  objectUrls.set(id, URL.createObjectURL(file))
  set(localFileVersionAtom, (v) => v + 1)
})

/** This session's blob: URL for a `local://<id>` source, or null if the file
 *  hasn't been (re-)picked yet — e.g. right after a reload. */
export function resolveLocalFileUrl(id: string): string | null {
  return objectUrls.get(id) ?? null
}

export function getLocalFileName(id: string): string | null {
  return files.get(id)?.name ?? null
}
