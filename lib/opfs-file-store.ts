// Best-effort, cross-browser persistence for "cog-local" BYOD files (see
// local-file-store.ts) using the Origin Private File System — unlike the File
// System Access API (Chromium-only, needs a user gesture to re-grant read
// permission every session), OPFS has been available in all three engines
// since ~2023 (Chrome ~2020, Safari 15.2, Firefox 111) and needs no
// permission prompt at all: it's a private, sandboxed filesystem the origin
// already owns.
//
// OPFS and IndexedDB share the same per-origin storage bucket/quota (as does
// the Cache API) — there's no separate "OPFS quota". navigator.storage.
// estimate() is a fuzzed/padded estimate in most browsers (anti-
// fingerprinting), not a guarantee, so writes can still throw
// QuotaExceededError well under the reported quota. Safari in particular has
// historically capped an origin far tighter than Chromium/Firefox before
// prompting the user for more — treat estimate() as a rough gauge for UI
// only, always catch write failures, and keep a size-capped LRU so this
// degrades instead of wedging once real disk/quota pressure hits.
//
// Every function here is a silent no-op (or resolves null/false) when OPFS
// isn't supported, or when any operation fails — this is a nice-to-have on
// top of whatever in-memory registry a caller already has (local-file-store.ts
// for COGs, TerraDrawSystem.tsx's layer state for vector layers), never a hard
// dependency: callers must keep working exactly as before if this whole
// module is unavailable.
//
// The actual persistence logic (eviction, LRU tracking, write-then-verify) is
// shared via createBlobStore below — createBlobStore(dirName, lruKey) gives
// each caller its own OPFS subdirectory and localStorage LRU index, so
// separate blob kinds (COGs, vector layer snapshots) never collide or get
// swept up in each other's "clear all" / quota accounting, while still
// sharing one tested implementation instead of two near-duplicate ones.

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unitIndex]}`
}

export function isOpfsSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage && typeof navigator.storage.getDirectory === "function"
}

// Requests persistent storage (best-effort — the browser may still refuse)
// so a large, deliberately-kept file isn't silently evicted under generic
// storage pressure. Origin-wide, not per-file/per-store — shared with
// whatever else (IndexedDB, Cache API) this origin already stores. Safe to
// call repeatedly; the browser no-ops if already persisted.
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export interface OpfsStorageEstimate {
  usageBytes: number
  quotaBytes: number | null
}

/** Rough, browser-fuzzed usage/quota for this origin's whole storage bucket
 *  (OPFS + IndexedDB + Cache API combined) — for a UI hint only, never a hard
 *  guarantee (see module header). */
export async function estimateStorage(): Promise<OpfsStorageEstimate> {
  try {
    const { usage, quota } = await navigator.storage.estimate()
    return { usageBytes: usage ?? 0, quotaBytes: quota ?? null }
  } catch {
    return { usageBytes: 0, quotaBytes: null }
  }
}

export interface PersistedBlobEntry {
  id: string
  size: number
  lastAccessed: number
}

// Soft cap on total bytes a single store will keep in OPFS — deliberately
// conservative given Safari's much tighter real-world quota (historically
// ~1GB before a user-facing prompt) versus Chromium/Firefox's far larger
// allowances. Clamped against navigator.storage.estimate() (see persist()
// below) so a browser reporting less headroom than this still gets respected.
const DEFAULT_MAX_TOTAL_BYTES = 1.5 * 1024 * 1024 * 1024 // 1.5 GB

export interface BlobStore {
  /** Best-effort write of `blob`'s bytes into OPFS under `id`, evicting older
   *  entries first if needed to stay under the size cap. Never throws — a
   *  failure here just means the entry won't survive a reload. */
  persist(id: string, blob: Blob): Promise<boolean>
  /** Reads back a previously-persisted entry, or null if it was never
   *  persisted, OPFS isn't supported, it was evicted, or it's found to be
   *  truncated/corrupt. */
  read(id: string): Promise<File | null>
  delete(id: string): Promise<void>
  /** Every currently-persisted entry, for a settings-page usage summary. */
  list(): Promise<PersistedBlobEntry[]>
  /** Wipes every entry in this store only — sibling stores (a different
   *  dirName/lruKey) are untouched. */
  clearAll(): Promise<void>
}

/** Creates an independent, quota-managed OPFS blob store: its own
 *  subdirectory (`dirName`) and its own localStorage-backed LRU index
 *  (`lruKey`), so multiple callers (COG files, vector layer snapshots) can
 *  each persist same-shaped id -> bytes data without sharing eviction order,
 *  "clear all" scope, or id namespace. */
export function createBlobStore(dirName: string, lruKey: string, maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES): BlobStore {
  let dirPromise: Promise<FileSystemDirectoryHandle | null> | null = null

  function getDir(): Promise<FileSystemDirectoryHandle | null> {
    if (!isOpfsSupported()) return Promise.resolve(null)
    if (!dirPromise) {
      dirPromise = navigator.storage.getDirectory()
        .then((root) => root.getDirectoryHandle(dirName, { create: true }))
        .catch(() => null)
    }
    return dirPromise
  }

  // OPFS file handles don't carry a "last accessed" timestamp (File.
  // lastModified is the write time, not read time), so LRU order is tracked
  // alongside the files themselves, in a small localStorage-backed index
  // rather than a sidecar file inside OPFS — cheaper to read/update than
  // doing extra directory I/O on every hydration. `size` is recorded at
  // write time (from the known-good source blob, not re-derived from OPFS)
  // so a later read can detect a truncated/corrupt entry.
  interface LruEntry {
    lastAccessed: number
    size: number
  }

  function readLru(): Record<string, LruEntry> {
    try {
      const raw = localStorage.getItem(lruKey)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }

  function writeLru(lru: Record<string, LruEntry>) {
    try {
      localStorage.setItem(lruKey, JSON.stringify(lru))
    } catch {
      // Ignore — the LRU index is only used to pick eviction order; losing it
      // just means eviction falls back to directory-iteration order next time.
    }
  }

  function touchLru(id: string, size?: number) {
    const lru = readLru()
    lru[id] = { lastAccessed: Date.now(), size: size ?? lru[id]?.size ?? 0 }
    writeLru(lru)
  }

  function dropLru(id: string) {
    const lru = readLru()
    delete lru[id]
    writeLru(lru)
  }

  async function listIds(dir: FileSystemDirectoryHandle): Promise<string[]> {
    const ids: string[] = []
    // @ts-ignore — FileSystemDirectoryHandle is async-iterable in every engine
    // that supports OPFS at all, but the DOM lib type defs vary by TS version.
    for await (const [name] of (dir as any).entries()) {
      ids.push(name)
    }
    return ids
  }

  async function getEntrySize(dir: FileSystemDirectoryHandle, id: string): Promise<number> {
    try {
      const handle = await dir.getFileHandle(id)
      const file = await handle.getFile()
      return file.size
    } catch {
      return 0
    }
  }

  /** Deletes the oldest (by LRU timestamp, falling back to arbitrary order
   *  for untracked entries) persisted files until at least `neededBytes` is
   *  free under `capBytes`, or nothing is left to evict. */
  async function evictUntilFits(dir: FileSystemDirectoryHandle, neededBytes: number, capBytes: number): Promise<void> {
    const ids = await listIds(dir)
    if (ids.length === 0) return

    const lru = readLru()
    const sized = await Promise.all(ids.map(async (id) => ({ id, size: await getEntrySize(dir, id), lastAccessed: lru[id]?.lastAccessed ?? 0 })))
    let total = sized.reduce((sum, e) => sum + e.size, 0)

    const byOldestFirst = [...sized].sort((a, b) => a.lastAccessed - b.lastAccessed)
    for (const entry of byOldestFirst) {
      if (total + neededBytes <= capBytes) break
      try {
        await dir.removeEntry(entry.id)
        dropLru(entry.id)
        total -= entry.size
      } catch {
        // Skip an entry that fails to delete rather than aborting the whole pass.
      }
    }
  }

  /** Writes `blob` to OPFS under `id` and reads it straight back to confirm
   *  the persisted copy's size actually matches — a write that throws
   *  partway through (quota exceeded mid-write, tab closed, browser killed)
   *  can otherwise leave a truncated or empty file committed as if it had
   *  succeeded, which then silently corrupts reads next session (for COG
   *  tiles this surfaced as a baffling 416/ERR_REQUEST_RANGE_NOT_SATISFIABLE
   *  rather than anything resembling a storage error). A mismatch here is
   *  treated as a failed persist: the broken entry is deleted so a later
   *  read cleanly returns null instead of handing back corrupt data. */
  async function writeAndVerify(dir: FileSystemDirectoryHandle, id: string, blob: Blob): Promise<boolean> {
    const handle = await dir.getFileHandle(id, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()

    const writtenSize = (await handle.getFile()).size
    if (writtenSize !== blob.size) {
      try { await dir.removeEntry(id) } catch {}
      dropLru(id)
      return false
    }

    touchLru(id, blob.size)
    return true
  }

  async function persist(id: string, blob: Blob): Promise<boolean> {
    const dir = await getDir()
    if (!dir) return false

    try {
      const estimate = await estimateStorage()
      const capBytes = estimate.quotaBytes
        ? Math.min(maxTotalBytes, estimate.quotaBytes * 0.8)
        : maxTotalBytes

      await evictUntilFits(dir, blob.size, capBytes)
      const ok = await writeAndVerify(dir, id, blob)
      if (ok) {
        // Opportunistic — failing this just means the write above is subject
        // to eviction under generic storage pressure, same as any other
        // best-effort storage in this origin.
        requestPersistentStorage()
      }
      return ok
    } catch {
      // Quota exceeded (still, despite the pre-emptive eviction above — the
      // estimate is only ever a rough gauge) or some other write failure. One
      // retry after a harder eviction pass, then give up quietly.
      try {
        await evictUntilFits(dir, blob.size, 0)
        return await writeAndVerify(dir, id, blob)
      } catch {
        return false
      }
    }
  }

  async function read(id: string): Promise<File | null> {
    const dir = await getDir()
    if (!dir) return null
    try {
      const handle = await dir.getFileHandle(id)
      const file = await handle.getFile()
      const recordedSize = readLru()[id]?.size
      if (recordedSize !== undefined && file.size !== recordedSize) {
        try { await dir.removeEntry(id) } catch {}
        dropLru(id)
        return null
      }
      touchLru(id, file.size)
      return file
    } catch {
      return null
    }
  }

  async function del(id: string): Promise<void> {
    const dir = await getDir()
    if (!dir) return
    try {
      await dir.removeEntry(id)
    } catch {
      // Already gone / never persisted — fine either way.
    }
    dropLru(id)
  }

  async function list(): Promise<PersistedBlobEntry[]> {
    const dir = await getDir()
    if (!dir) return []
    const ids = await listIds(dir)
    const lru = readLru()
    return Promise.all(ids.map(async (id) => ({ id, size: await getEntrySize(dir, id), lastAccessed: lru[id]?.lastAccessed ?? 0 })))
  }

  async function clearAll(): Promise<void> {
    const dir = await getDir()
    if (!dir) return
    const ids = await listIds(dir)
    for (const id of ids) {
      try {
        await dir.removeEntry(id)
      } catch {
        // Best-effort — keep clearing the rest even if one entry fails.
      }
    }
    writeLru({})
  }

  return { persist, read, delete: del, list, clearAll }
}

// --- COG file store (unchanged directory/localStorage-key names from before
// this module was generalized, so already-persisted user data keeps working) ---

const cogStore = createBlobStore("local-cogs", "opfsCogLru")

export type PersistedCogEntry = PersistedBlobEntry

export const persistCogFile = cogStore.persist
export const readPersistedCogFile = cogStore.read
export const deletePersistedCogFile = cogStore.delete
export const listPersistedCogs = cogStore.list
export const clearAllPersistedCogs = cogStore.clearAll
