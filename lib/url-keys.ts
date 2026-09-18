import { VIEW_IDS } from "./grid-layouts"

/**
 * State key -> URL key, where the two differ. The terrain source fields are
 * `sourceA`..`sourceH` in state (and everywhere in the code) but
 * `terrainSourceA`..`terrainSourceH` in the address bar, matching
 * `basemapSourceA`..`basemapSourceH`. nuqs applies this through its
 * `urlKeys` option; anything not listed keeps its state key as URL key.
 *
 * Links written before the rename carry `sourceA=`: migrateLegacyUrlKeys
 * rewrites them once, before nuqs reads the URL (src/main.tsx), and the
 * places that read the raw query string accept both spellings.
 */
export const URL_KEYS: Record<string, string> = Object.fromEntries(VIEW_IDS.map((side) => [`source${side}`, `terrainSource${side}`]))

/** URL key -> state key for the old spellings. */
export const LEGACY_URL_KEYS: Record<string, string> = Object.fromEntries(Object.entries(URL_KEYS).map(([stateKey, urlKey]) => [stateKey, urlKey]))

/** The URL key a state key is written under. */
export const urlKeyOf = (stateKey: string): string => URL_KEYS[stateKey] ?? stateKey

/** Renames legacy keys in place (`sourceA` -> `terrainSourceA`), the new key
 *  winning when both are present. Returns true when something changed. */
export function migrateLegacyUrlKeys(params: URLSearchParams): boolean {
  let changed = false
  for (const [legacy, current] of Object.entries(LEGACY_URL_KEYS)) {
    if (!params.has(legacy)) continue
    if (!params.has(current)) params.set(current, params.get(legacy)!)
    params.delete(legacy)
    changed = true
  }
  return changed
}

/** Reads a state key's value off a raw query string, either spelling. */
export function getUrlParam(params: URLSearchParams, stateKey: string): string | null {
  return params.get(urlKeyOf(stateKey)) ?? params.get(stateKey)
}
