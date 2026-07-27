// Resolves a linked terrain/basemap pair (CustomTerrainSource.linkedBasemapId /
// CustomBasemapSource.linkedTerrainId — see settings-atoms.ts) at the moment a
// user picks one of them, so the caller can setState both fields in a single
// call. Deliberately NOT a reactive effect (see the removed pair of
// useEffects in TerrainViewer.tsx) — resolving imperatively at the click site
// means there's only ever one state update per action, so a manual pick of
// an unrelated source can never race against a "re-assert the link" effect
// and get silently reverted.
//
// Either side of the pair can define the link — each resolver checks its own
// direction first, then falls back to a reverse scan of the other list, so
// it doesn't matter which source's modal the pairing was actually set from.

import type { CustomTerrainSource, CustomBasemapSource } from "./settings-atoms"

export function resolveLinkedBasemapId(
  terrainId: string,
  customTerrainSources: CustomTerrainSource[],
  customBasemapSources: CustomBasemapSource[],
): string | undefined {
  return customTerrainSources.find((s) => s.id === terrainId)?.linkedBasemapId
    ?? customBasemapSources.find((b) => b.linkedTerrainId === terrainId)?.id
}

export function resolveLinkedTerrainId(
  basemapId: string,
  customTerrainSources: CustomTerrainSource[],
  customBasemapSources: CustomBasemapSource[],
): string | undefined {
  return customBasemapSources.find((b) => b.id === basemapId)?.linkedTerrainId
    ?? customTerrainSources.find((s) => s.linkedBasemapId === basemapId)?.id
}
