// The national and regional historical series (lib/national-historical.ts)
// as dated imagery sources of the shared schema (DatedImagerySource in
// lib/source-schema.ts): one source per agency or series, its layers' years
// (or flight periods, quarters, months) as its dates, a date's tiles the
// layer of that date. Google Earth Timelapse and Planetary Computer's
// mosaics are among them. lib/dated-imagery.ts lists them beside its own
// sources, so the MCP server's imagery_dates, the tile service and the
// timeline's catalogs read them the same way.
//
// listDates is the one-shot catalog: the layers whose extent holds the place.
// The timeline's catalog walk (nationalTicks in lib/timeline-catalogs.ts)
// goes further, with the agency's flight index or a tile probe, so it also
// drops years flown elsewhere in the extent; both build a layer's source
// with nationalLayerTiles.
//
// Ids are the catalogs' (cat-nat-icgc, cat-nat-gtimelapse) and never change.
import type { DatedImagerySource, DatedImageryTick, DatedImageryTiles } from "./source-schema"
import { NATIONAL_SOURCES, loadNationalLayers, type Bbox, type NatLayer, type NatSource } from "./national-historical"

const contains = (b: Bbox, lng: number, lat: number) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]
const pad = (n: number) => String(n).padStart(2, "0")

/** A layer's date: its own (a quarter, a month), else 1 January of its year. */
export const nationalLayerDateMs = (l: NatLayer) => l.dateMs ?? Date.UTC(l.year, 0, 1)

/** The id the timeline gives a layer's basemap (custom-basemap-cat-<source>--<key>),
 *  which a shared link rebuilds (resolveCatalogSourceId): the app's
 *  basemapSource for that layer. */
export const nationalLayerBasemapId = (sourceId: string, key: string) =>
  `custom-basemap-cat-${sourceId}--${key.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 90)}`

/** A layer's tiles: an XYZ template, or a WMS GetMap with {bbox-epsg-3857}
 *  (both a MapLibre raster source as is), or one of the app's schemes
 *  (gtimelapse://, pcmosaic://). */
export function nationalLayerTiles(src: NatSource, l: NatLayer): DatedImageryTiles {
  return { tiles: [l.url], tileSize: 256, maxzoom: l.maxzoom ?? 20, ...(l.minzoom ? { minzoom: l.minzoom } : {}), bounds: l.bbox ?? src.bbox }
}

function tick(l: NatLayer): DatedImageryTick {
  const dateMs = nationalLayerDateMs(l)
  const d = new Date(dateMs)
  // A whole year reads as the year; a quarter or month window as its month.
  const label = l.dateMs ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` : String(l.year)
  return { dateMs, label, ref: l, title: l.label }
}

const ticks = (layers: NatLayer[]) => layers.map(tick).sort((a, b) => a.dateMs - b.dateMs)

// Layers already loaded, so that tiles() can name a date's layer without a
// request once the generated ones have arrived.
const loaded = new Map<string, NatLayer[]>()
async function layersOf(src: NatSource) {
  const ls = await loadNationalLayers(src)
  loaded.set(src.id, ls)
  return ls
}

const MONTHLY = /month/i, QUARTERLY = /quarter/i

function datedSource(src: NatSource): DatedImagerySource {
  const pc = src.id.startsWith("cat-nat-mspc-")
  return {
    id: src.id, name: src.label, shortName: src.short, kind: "raster", section: "library",
    description: src.note, infoUrl: src.infoUrl,
    granularity: MONTHLY.test(src.label) ? "month" : QUARTERLY.test(src.label) ? "quarter" : "year",
    // Planetary Computer's windows are a cadence, mosaicked wherever scenes
    // exist, not flights found at the place.
    realDates: !pc, historicalEntry: false,
    tileSize: 256, maxzoom: Math.max(...src.layers.map((l) => l.maxzoom ?? 20), 0) || 20,
    attribution: `${src.label}, ${src.licence}`, licence: src.licence,
    bounds: src.bbox[0] <= -180 && src.bbox[2] >= 180 ? undefined : src.bbox,
    fileStem: src.id.replace(/^cat-nat-/, "national-"), exportLabel: src.short,
    // The generated series (lazy) know their layers only once loaded.
    fixedDates: () => (src.lazy ? ticks(loaded.get(src.id) ?? []) : ticks(src.layers)),
    listDates: async ({ lat, lng }, startMs, endMs) => {
      if (!contains(src.bbox, lng, lat)) return []
      const ls = (await layersOf(src)).filter((l) => (!l.bbox || contains(l.bbox, lng, lat)))
      return ticks(ls).filter((t) => t.dateMs >= startMs && t.dateMs <= endMs)
    },
    // A tick names its layer; a date alone takes the layer of that date (the
    // first one, where a series has two of the same year).
    tiles: ({ dateMs, ref }) => {
      const l = (ref as NatLayer | undefined) ?? (src.lazy ? loaded.get(src.id) ?? [] : src.layers).find((x) => nationalLayerDateMs(x) === dateMs || (!x.dateMs && new Date(dateMs).getUTCFullYear() === x.year))
      return l ? nationalLayerTiles(src, l) : null
    },
  }
}

/** Every national and regional series, as dated imagery sources. */
export const NATIONAL_DATED_SOURCES: readonly DatedImagerySource[] = NATIONAL_SOURCES.map(datedSource)
