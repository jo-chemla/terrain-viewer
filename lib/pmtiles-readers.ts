// One PMTiles reader per archive for the whole app: the map's `pmtiles://`
// protocol (TerrainViewer.tsx registers `sharedPmtilesProtocol.tile`) and the
// code that reads an archive by hand (the building shadows' tile reader,
// lib/building-tiles.ts) go through the same PMTiles instance, so the
// archive's header and directories are fetched once and shared: a vector
// overlay already drawn from Overture's archive leaves the shadows only
// the tiles themselves to range-request.
//
// No MapLibre import: Protocol only shapes its answers for addProtocol.
import { PMTiles, Protocol } from "pmtiles"

export const sharedPmtilesProtocol = new Protocol()

/** The reader of an archive address (with or without the `pmtiles://` prefix). */
export function pmtilesReader(url: string): PMTiles {
  const address = url.replace(/^pmtiles:\/\//, "")
  let reader = sharedPmtilesProtocol.get(address)
  if (!reader) {
    reader = new PMTiles(address)
    sharedPmtilesProtocol.add(reader)
  }
  return reader
}
