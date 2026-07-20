// Persists TerraDraw layer geometry (both hand-drawn and imported-from-file)
// to OPFS across sessions, the same way lib/opfs-file-store.ts persists local
// COG bytes — built on that module's createBlobStore so eviction/LRU/write-
// verify logic isn't duplicated, but in its own subdirectory/LRU index so a
// "clear persisted COGs" action never touches vector layers and vice versa.
//
// Only the *geometry* (a layer's GeoJSON features) lives here. Layer metadata
// (id/name/color/stroke width — see DrawLayer in TerraDrawSystem.tsx) is small
// enough to live directly in drawingLayersAtom (atomWithStorage, plain
// localStorage), which also doubles as the list of layer ids to hydrate
// features for on the next load — mirroring how local-file-store.ts's
// customTerrainSourcesAtom entries (small, persisted) point at the bulky
// bytes kept here (or in opfs-file-store.ts for COGs).
//
// Every layer (both freehand-drawn and file-imported) gets a fresh
// crypto.randomUUID()-equivalent id via terra-draw's own uuidv4() at creation
// time (see makeLayer in TerraDrawSystem.tsx) — never derived from an
// imported file's name — so re-importing a same-named GeoJSON file that's
// since changed on disk always lands in a brand-new layer/id rather than
// silently overwriting stale persisted geometry under a collided key.
import { createBlobStore, type PersistedBlobEntry } from "./opfs-file-store"

const vectorStore = createBlobStore("local-vector-layers", "opfsVectorLru")

export type PersistedVectorLayerEntry = PersistedBlobEntry

/** Best-effort write of a layer's current features to OPFS under its id.
 *  Never throws — same fire-and-forget contract as opfs-file-store.ts. */
export async function persistVectorLayerFeatures(layerId: string, features: unknown[]): Promise<boolean> {
  const json = JSON.stringify(features)
  return vectorStore.persist(layerId, new Blob([json], { type: "application/json" }))
}

/** Reads back a layer's persisted features, or null if never persisted (or
 *  OPFS unsupported, evicted, or corrupt) — callers should treat null the
 *  same as "no persisted data for this layer", not as an error. */
export async function readPersistedVectorLayerFeatures<T = unknown>(layerId: string): Promise<T[] | null> {
  const file = await vectorStore.read(layerId)
  if (!file) return null
  try {
    const parsed = JSON.parse(await file.text())
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function deletePersistedVectorLayer(layerId: string): Promise<void> {
  return vectorStore.delete(layerId)
}

/** Every currently-persisted layer, for a settings-page usage summary. */
export async function listPersistedVectorLayers(): Promise<PersistedVectorLayerEntry[]> {
  return vectorStore.list()
}

/** Wipes every persisted vector layer's geometry — used by the "Clear
 *  persisted vector layers" settings action. Does not touch the current
 *  session's live layers/features (drawingLayersAtom/drawingFeaturesAtom), or
 *  local COG persistence (a separate store) — only what would otherwise
 *  survive a reload for vector layers. */
export async function clearAllPersistedVectorLayers(): Promise<void> {
  return vectorStore.clearAll()
}
