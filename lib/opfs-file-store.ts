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
// top of the existing in-memory local-file-store.ts, never a hard dependency:
// callers must keep working exactly as before if this whole module is
// unavailable.

const DIR_NAME = "local-cogs"

// Soft cap on total bytes this app will keep in OPFS across all persisted
// COGs — deliberately conservative given Safari's much tighter real-world
// quota (historically ~1GB before a user-facing prompt) versus Chromium/
// Firefox's far larger allowances. Clamped against navigator.storage.
// estimate() (see capacityBytes below) so a browser reporting less headroom
// than this still gets respected.
const DEFAULT_MAX_TOTAL_BYTES = 1.5 * 1024 * 1024 * 1024 // 1.5 GB

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

let dirPromise: Promise<FileSystemDirectoryHandle | null> | null = null

function getDir(): Promise<FileSystemDirectoryHandle | null> {
  if (!isOpfsSupported()) return Promise.resolve(null)
  if (!dirPromise) {
    dirPromise = navigator.storage.getDirectory()
      .then((root) => root.getDirectoryHandle(DIR_NAME, { create: true }))
      .catch(() => null)
  }
  return dirPromise
}

// Requests persistent storage (best-effort — the browser may still refuse)
// so a large, deliberately-kept COG isn't silently evicted under generic
// storage pressure. Origin-wide, not per-file/per-API — shared with whatever
// else (IndexedDB, Cache API) this origin already stores. Safe to call
// repeatedly; the browser no-ops if already persisted.
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

export interface PersistedCogEntry {
  id: string
  size: number
  lastAccessed: number
}

// OPFS file handles don't carry a "last accessed" timestamp (File.
// lastModified is the write time, not read time), so LRU order is tracked
// alongside the files themselves, in a small localStorage-backed index
// rather than a sidecar file inside OPFS — cheaper to read/update than doing
// extra directory I/O on every hydration.
const LRU_KEY = "opfsCogLru"

function readLru(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LRU_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeLru(lru: Record<string, number>) {
  try {
    localStorage.setItem(LRU_KEY, JSON.stringify(lru))
  } catch {
    // Ignore — the LRU index is only used to pick eviction order; losing it
    // just means eviction falls back to directory-iteration order next time.
  }
}

function touchLru(id: string) {
  const lru = readLru()
  lru[id] = Date.now()
  writeLru(lru)
}

function dropLru(id: string) {
  const lru = readLru()
  delete lru[id]
  writeLru(lru)
}

async function listPersistedIds(dir: FileSystemDirectoryHandle): Promise<string[]> {
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

/** Deletes the oldest (by LRU timestamp, falling back to arbitrary order for
 *  untracked entries) persisted files until at least `neededBytes` is free
 *  under `capBytes`, or nothing is left to evict. */
async function evictUntilFits(dir: FileSystemDirectoryHandle, neededBytes: number, capBytes: number): Promise<void> {
  const ids = await listPersistedIds(dir)
  if (ids.length === 0) return

  const lru = readLru()
  const sized = await Promise.all(ids.map(async (id) => ({ id, size: await getEntrySize(dir, id), lastAccessed: lru[id] ?? 0 })))
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

/** Best-effort write of `file`'s bytes into OPFS under `id`, evicting older
 *  entries first if needed to stay under the size cap. Never throws — a
 *  failure here just means the file won't survive a reload, exactly like
 *  before this module existed. Callers should treat this as fire-and-forget. */
export async function persistCogFile(id: string, file: File): Promise<boolean> {
  const dir = await getDir()
  if (!dir) return false

  try {
    const estimate = await estimateStorage()
    const capBytes = estimate.quotaBytes
      ? Math.min(DEFAULT_MAX_TOTAL_BYTES, estimate.quotaBytes * 0.8)
      : DEFAULT_MAX_TOTAL_BYTES

    await evictUntilFits(dir, file.size, capBytes)

    const handle = await dir.getFileHandle(id, { create: true })
    const writable = await handle.createWritable()
    await writable.write(file)
    await writable.close()
    touchLru(id)
    // Opportunistic — failing this just means the write above is subject to
    // eviction under generic storage pressure, same as any other best-effort
    // storage in this origin.
    requestPersistentStorage()
    return true
  } catch {
    // Quota exceeded (still, despite the pre-emptive eviction above — the
    // estimate is only ever a rough gauge) or some other write failure. One
    // retry after a harder eviction pass, then give up quietly.
    try {
      await evictUntilFits(dir, file.size, 0)
      const handle = await dir.getFileHandle(id, { create: true })
      const writable = await handle.createWritable()
      await writable.write(file)
      await writable.close()
      touchLru(id)
      return true
    } catch {
      return false
    }
  }
}

/** Reads back a previously-persisted file, or null if it was never persisted,
 *  OPFS isn't supported, or it was evicted. Reading the resulting File is
 *  lazy (same as the blob: URL path this replaces) — this does not load the
 *  whole COG into memory. */
export async function readPersistedCogFile(id: string): Promise<File | null> {
  const dir = await getDir()
  if (!dir) return null
  try {
    const handle = await dir.getFileHandle(id)
    const file = await handle.getFile()
    touchLru(id)
    return file
  } catch {
    return null
  }
}

export async function deletePersistedCogFile(id: string): Promise<void> {
  const dir = await getDir()
  if (!dir) return
  try {
    await dir.removeEntry(id)
  } catch {
    // Already gone / never persisted — fine either way.
  }
  dropLru(id)
}

/** Every currently-persisted entry, for a settings-page usage summary. */
export async function listPersistedCogs(): Promise<PersistedCogEntry[]> {
  const dir = await getDir()
  if (!dir) return []
  const ids = await listPersistedIds(dir)
  const lru = readLru()
  return Promise.all(ids.map(async (id) => ({ id, size: await getEntrySize(dir, id), lastAccessed: lru[id] ?? 0 })))
}

/** Wipes every persisted COG — used by the "Clear persisted local files"
 *  settings action. Does not touch the current session's in-memory Files
 *  (local-file-store.ts), only what would otherwise survive a reload. */
export async function clearAllPersistedCogs(): Promise<void> {
  const dir = await getDir()
  if (!dir) return
  const ids = await listPersistedIds(dir)
  for (const id of ids) {
    try {
      await dir.removeEntry(id)
    } catch {
      // Best-effort — keep clearing the rest even if one entry fails.
    }
  }
  writeLru({})
}
