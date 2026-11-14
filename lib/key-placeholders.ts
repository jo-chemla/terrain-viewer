// API keys never live in a saved source's URL: a source that needs one (a
// Planet scene's tiles, a Copernicus Sentinel Hub layer) stores a
// placeholder, filled with this browser's own key when the tiles are
// requested. A shared link or an exported list then carries no key, and each
// recipient's tiles use their own.
import { getDefaultStore } from "jotai"
import { planetKeyAtom, sentinelHubInstanceIdAtom } from "./settings-atoms"

export const PLANET_KEY_PLACEHOLDER = "{planetKey}"
export const SH_INSTANCE_PLACEHOLDER = "{shInstance}"

const SH_OGC_RE = /(sh\.dataspace\.copernicus\.eu\/ogc\/(?:wms|wmts)\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi

export function fillKeyPlaceholders(url: string): string {
  let out = url
  if (out.includes(PLANET_KEY_PLACEHOLDER)) out = out.split(PLANET_KEY_PLACEHOLDER).join(encodeURIComponent(getDefaultStore().get(planetKeyAtom).trim()))
  if (out.includes(SH_INSTANCE_PLACEHOLDER)) out = out.split(SH_INSTANCE_PLACEHOLDER).join(encodeURIComponent(getDefaultStore().get(sentinelHubInstanceIdAtom).trim()))
  return out
}

/** The reverse, for anything about to be saved or shared: a Sentinel Hub
 *  instance id in a sh.dataspace.copernicus.eu OGC URL becomes the
 *  placeholder. */
export function maskKeys(url: string): string {
  return url.replace(SH_OGC_RE, `$1${SH_INSTANCE_PLACEHOLDER}`)
}

/** The visitor's own Sentinel Hub WMTS capabilities URL, or null without an id. */
export function sentinelHubWmtsCapabilities(): string | null {
  const id = getDefaultStore().get(sentinelHubInstanceIdAtom).trim()
  return id ? `https://sh.dataspace.copernicus.eu/ogc/wmts/${encodeURIComponent(id)}?SERVICE=WMTS&REQUEST=GetCapabilities` : null
}
