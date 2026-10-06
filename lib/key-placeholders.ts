// API keys never live in a saved source's URL: a source that needs one (a
// Planet scene's tiles) stores a placeholder, filled with this browser's
// own key when the tiles are requested. A shared link or an exported list
// then carries no key, and each recipient's tiles use their own.
import { getDefaultStore } from "jotai"
import { planetKeyAtom } from "./settings-atoms"

export const PLANET_KEY_PLACEHOLDER = "{planetKey}"

export function fillKeyPlaceholders(url: string): string {
  if (!url.includes("{planetKey}")) return url
  return url.split(PLANET_KEY_PLACEHOLDER).join(encodeURIComponent(getDefaultStore().get(planetKeyAtom).trim()))
}
