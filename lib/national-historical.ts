// National and regional historical imagery series for the timeline's
// "National historical" catalogues: one source per agency, one layer per
// flight year or period, all browser-friendly (CORS, Web Mercator, no key),
// checked 2026-10-05. A source only lists layers where it covers the view's
// centre, decided the cheapest way it allows:
//   - `dates`: one GetFeatureInfo on the agency's own flight-index layers
//     answers which years were flown there, with the real flight dates
//     (NRW, Bavaria, Tyrol);
//   - otherwise a probe: one small tile per layer at the centre, dropped
//     when missing or blank. Services answer a blank image rather than an
//     error where a year has no photo (a constant 667-byte PNG, a white
//     JPEG), so the probe decodes the tile and drops uniform ones.
// lib/timeline-catalogs.ts turns them into catalogues and ticks; the STAC
// build lists them as collections.
//
// Two kinds of entries: the ones written out below (with flight-index
// lookups where the agency has one), and about fifty more read from
// national-historical-catalog.json (names, extents) and
// national-historical-layers.json (layer lists, 1,100+ layers, loaded on first
// use). Those two files were generated 2026-10-05 from each service's
// capabilities, and every layer answered an image with CORS for a tile in its
// area; services that failed are listed in the docs (Basemaps and Historical).
import catalogJson from "./national-historical-catalog.json" with { type: "json" }

export type Bbox = [number, number, number, number]

export interface NatLayer {
  key: string
  /** Start year, or the flight date when known exactly. */
  year: number
  endYear?: number
  label: string
  url: string
  type: "tms" | "wms"
  maxzoom?: number
  minzoom?: number
  /** Narrower than the source's own extent (a city layer in a state series). */
  bbox?: Bbox
}

export interface NatSource {
  id: string
  /** The Catalogues tree's heading ("Historical · Germany"). */
  group: string
  label: string
  short: string
  color: string
  bbox: Bbox
  note: string
  infoUrl: string
  licence: string
  resClass?: "vhr" | "medium"
  layers: NatLayer[]
  /** Layers kept in national-historical-layers.json, fetched on first use. */
  lazy?: boolean
  /** Flight dates at a point, per layer key (exact, from the agency's index). */
  dates?: (lng: number, lat: number, signal?: AbortSignal) => Promise<Record<string, string[]>>
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const wms = (base: string, layer: string, format = "image/jpeg", extra = "") =>
  `${base}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${encodeURIComponent(layer)}&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=${encodeURIComponent(format)}${extra}`

// GetFeatureInfo at a point, plain text: "Layer 'name'" blocks.
async function featureInfo(base: string, layers: string[], lng: number, lat: number, signal?: AbortSignal): Promise<Record<string, string>> {
  const x = (lng * 20037508.34) / 180
  const y = (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) * 20037508.34
  const q = layers.join(",")
  const res = await fetch(`${base}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=${q}&QUERY_LAYERS=${q}&CRS=EPSG:3857&BBOX=${x - 50},${y - 50},${x + 50},${y + 50}&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=text/plain&FEATURE_COUNT=200`, { signal })
  if (!res.ok) throw new Error(`GetFeatureInfo ${res.status}`)
  const text = await res.text()
  const out: Record<string, string> = {}
  for (const m of text.matchAll(/Layer '([^']+)'([\s\S]*?)(?=Layer '|$)/g)) out[m[1]] = m[2]
  // ArcGIS servers answer "@layer header; values;" on one line instead.
  for (const m of text.matchAll(/@(\S+)\s+([^@]*)/g)) out[m[1]] = m[2]
  return out
}
const isoOf = (d: string) => { const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d); return m ? `${m[3]}-${m[2]}-${m[1]}` : d }

// ── Catalonia: ICGC ──────────────────────────────────────────────────────
const ICGC = "https://geoserveis.icgc.cat/servei/catalunya/orto-territorial/wms"
const ICGC_LAYERS: [string, number, number?][] = [
  ["ortofoto_blanc_i_negre_1945-1946", 1945, 1946], ["ortofoto_blanc_i_negre_1956-1957", 1956, 1957], ["ortofoto_blanc_i_negre_1970-1977", 1970, 1977],
  ["ortofoto_blanc_i_negre_1983-1989", 1983, 1989], ["ortofoto_blanc_i_negre_1990", 1990], ["ortofoto_color_1993", 1993], ["ortofoto_blanc_i_negre_1994-1997", 1994, 1997],
  ["ortofoto_blanc_i_negre_1998", 1998], ["ortofoto_color_2000-2003", 2000, 2003], ["ortofoto_color_2004-2005", 2004, 2005], ["ortofoto_color_2006-2007", 2006, 2007],
  ...range(2008, 2025).map((y) => [`ortofoto_color_${y}`, y] as [string, number]),
]

// ── Spain: IGN PNOA histórico ────────────────────────────────────────────
const PNOA = "https://www.ign.es/wms/pnoa-historico"
const PNOA_LAYERS: [string, string, number, number?][] = [
  ["AMS_1956-1957", "Vuelo americano (serie B)", 1956, 1957], ["Interministerial_1973-1986", "Vuelo interministerial", 1973, 1986], ["Nacional_1981-1986", "Vuelo nacional", 1981, 1986],
  ["OLISTAT", "OLISTAT", 1997, 1998], ["SIGPAC", "SIGPAC", 1997, 2003], ...range(2004, 2024).map((y) => [`PNOA${y}`, `PNOA ${y}`, y] as [string, string, number]),
]

// ── North Rhine-Westphalia: historische DOP ──────────────────────────────
const NRW = "https://www.wms.nrw.de/geobasis/wms_nw_hist_dop"
const NRW_YEARS = [...range(1951, 1964), ...range(1966, 2024)]

// ── Wallonia: SPW orthophotos (ArcGIS, one service per period) ───────────
const SPW = "https://geoservices.wallonie.be/arcgis/rest/services/IMAGERIE"
const SPW_PERIODS: [string, number, number?][] = [
  ["1971", 1971], ["1978_1990", 1978, 1990], ["1994_2000", 1994, 2000], ["2001_2003", 2001, 2003], ["2006_2007", 2006, 2007], ["2009_2010", 2009, 2010], ["2012_2013", 2012, 2013],
  ...range(2015, 2021).map((y) => [String(y), y] as [string, number]), ["2022_ETE", 2022], ["2023_ETE", 2023], ["2024", 2024], ["2025_ETE", 2025], ["2026_PRINTEMPS", 2026],
]

// ── Flanders: orthophoto mosaics and historical maps (WMTS) ──────────────
const VL = "https://geo.api.vlaanderen.be"
const vlTile = (service: string, layer: string) => `${VL}/${service}/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`
const VL_LAYERS: [string, string, string, number, number?][] = [
  ["HISTCART", "pourbus", "Pourbus map", 1571], ["HISTCART", "frickx", "Fricx map", 1712], ["HISTCART", "ferraris", "Ferraris map", 1777],
  ["HISTCART", "abw", "Atlas der Buurtwegen", 1840], ["HISTCART", "popp", "Popp map", 1842, 1879], ["HISTCART", "vandermaelen", "Vandermaelen map", 1846, 1854],
  ["OKZ", "okzpan71vl", "Orthophoto 1971 (panchromatic)", 1971], ["OKZ", "okzrgb79_90vl", "Orthophoto 1979-1990", 1979, 1990],
  ["OMW", "omwrgb00_03vl", "Orthophoto 2000-2003", 2000, 2003], ["OMW", "omwrgb05_07vl", "Orthophoto 2005-2007", 2005, 2007], ["OMW", "omwrgb08_11vl", "Orthophoto 2008-2011", 2008, 2011],
  ...range(2012, 2025).map((y) => ["OMW", `omwrgb${String(y).slice(2)}vl`, `Orthophoto ${y} (winter)`, y] as [string, string, string, number]),
]

// ── Netherlands: PDOK Luchtfoto ──────────────────────────────────────────
const PDOK = "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0"
const PDOK_LAYERS: [string, number][] = [...range(2016, 2020).map((y) => [`${y}_ortho25`, y] as [string, number]), ...range(2021, 2026).map((y) => [`${y}_orthoHR`, y] as [string, number])]

// ── Vienna: Luftbildpläne ────────────────────────────────────────────────
const WIEN_YEARS: [number, "grau" | "farbe"][] = [[1938, "grau"], [1956, "grau"], [1961, "grau"], [1971, "grau"], [1976, "grau"], [1981, "grau"], [1986, "grau"], [1992, "grau"], ...range(2014, 2024).map((y) => [y, "farbe"] as [number, "farbe"])]

// ── Luxembourg ───────────────────────────────────────────────────────────
const LU_YEARS = [1967, 2001, 2004, 2007, 2010, 2013, ...range(2016, 2023), 2025]

// ── Bavaria: historische DOP ─────────────────────────────────────────────
const BY = "https://geoservices.bayern.de/od/wms/histdop/v1/histdop"
const BY_YEARS = range(2003, 2025)

// ── Tyrol ────────────────────────────────────────────────────────────────
const TIROL = "https://gis.tirol.gv.at/arcgis/services/Service_Public/orthofoto/MapServer/WMSServer"
const TIROL_PERIODS: [string, number, number?][] = [["1940", 1940], ["1949_1954", 1949, 1954], ["1970_1982", 1970, 1982], ["1999_2004", 1999, 2004], ["2004_2009", 2004, 2009], ["2009_2012", 2009, 2012], ["2013_2015", 2013, 2015], ["2016_2018", 2016, 2018], ["2019_2021", 2019, 2021], ["2022", 2022]]

// ── Japan: GSI ───────────────────────────────────────────────────────────
const GSI_LAYERS: [string, string, number, number, string][] = [
  ["ort_riku10", "Army aerial photos", 1936, 1942, "png"], ["ort_USA10", "US Army aerial photos", 1945, 1950, "png"], ["ort_old10", "Aerial photos", 1961, 1969, "png"],
  ["gazo1", "Aerial photos", 1974, 1978, "jpg"], ["gazo2", "Aerial photos", 1979, 1983, "jpg"], ["gazo3", "Aerial photos", 1984, 1986, "jpg"], ["gazo4", "Aerial photos", 1988, 1990, "jpg"],
]

// ── New York City ────────────────────────────────────────────────────────
// 2001, 2020 and 2022 answer 490 (checked 2026-10-05); 2024 redirects to http.
const NYC_YEARS = [1924, 1951, 1996, 2004, 2006, 2008, 2010, 2012, 2014, 2016, 2018]

// ── NASA GIBS: Landsat WELD annual ───────────────────────────────────────
const WELD_YEARS = [1983, 1984, 1985, 1988, 1989, 1990, 1998, 1999, 2000]

export const NATIONAL_SOURCES: NatSource[] = [
  {
    id: "cat-nat-icgc", group: "Historical · Spain and Portugal", label: "Catalonia (ICGC)", short: "ICGC", color: "#fbcfe8", bbox: [0.15, 40.5, 3.35, 42.9],
    note: "ICGC orthophotos of Catalonia: 1945-46, 1956-57, 1970s and 1980s flights, then every year 2008-2025.", infoUrl: "https://www.icgc.cat/", licence: "CC BY 4.0",
    layers: ICGC_LAYERS.map(([key, y, e]) => ({ key, year: y, endYear: e, label: key.replace(/^ortofoto_/, "").replace(/_/g, " "), url: wms(ICGC, key), type: "wms" as const, maxzoom: 20 })),
  },
  {
    id: "cat-nat-pnoa", group: "Historical · Spain and Portugal", label: "Spain (IGN PNOA histórico)", short: "PNOA", color: "#fde68a", bbox: [-18.2, 27.6, 4.4, 43.9],
    note: "IGN Spain: the 1956-57 American flight, the 1973-86 interministerial and national flights, OLISTAT, SIGPAC, then PNOA every year 2004-2024 (each year flies some regions).", infoUrl: "https://pnoa.ign.es/", licence: "CC BY 4.0",
    layers: PNOA_LAYERS.map(([key, label, y, e]) => ({ key, year: y, endYear: e, label, url: wms(PNOA, key), type: "wms" as const, maxzoom: 20 })),
  },
  {
    id: "cat-nat-nrw", group: "Historical · Germany", label: "North Rhine-Westphalia (historische DOP)", short: "NRW", color: "#bbf7d0", bbox: [5.85, 50.32, 9.47, 52.54],
    note: "Geobasis NRW: historical orthophotos 1951-2024, dated by the flight under the view centre.", infoUrl: "https://www.bezreg-koeln.nrw.de/geobasis-nrw/produkte-und-dienste/luftbild-und-satellitenbildinformationen/aktuelle-luftbild-und-0", licence: "DL-DE Zero 2.0",
    layers: NRW_YEARS.map((y) => ({ key: `nw_hist_dop_${y}`, year: y, label: `Historische DOP ${y}`, url: wms(NRW, `nw_hist_dop_${y}`), type: "wms" as const, maxzoom: 20 })),
    dates: async (lng, lat, signal) => {
      const info = await featureInfo(NRW, ["nw_hist_dop_info"], lng, lat, signal)
      const out: Record<string, string[]> = {}
      for (const m of (info["nw_hist_dop_info"] ?? "").matchAll(/Bildflugdatum = '(\d{4})-(\d{2})-(\d{2})'/g)) (out[`nw_hist_dop_${m[1]}`] ??= []).push(`${m[1]}-${m[2]}-${m[3]}`)
      return out
    },
  },
  {
    id: "cat-nat-spw", group: "Historical · Belgium", label: "Wallonia (SPW)", short: "SPW", color: "#fecaca", bbox: [2.8, 49.45, 6.45, 50.82],
    note: "Service public de Wallonie orthophotos: 1971, 1978-90, 1994-2000, 2001-03, 2006-07, 2009-10, 2012-13, then every year since 2015.", infoUrl: "https://geoportail.wallonie.be/", licence: "SPW free licence",
    layers: SPW_PERIODS.map(([p, y, e]) => ({ key: `ORTHO_${p}`, year: y, endYear: e, label: `Orthophotos ${p.replace(/_/g, " ").toLowerCase()}`, url: `${SPW}/ORTHO_${p}/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image`, type: "wms" as const, maxzoom: 20 })),
  },
  {
    id: "cat-nat-vlaanderen", group: "Historical · Belgium", label: "Flanders (Digitaal Vlaanderen)", short: "Vlaanderen", color: "#fef08a", bbox: [2.5, 50.67, 5.92, 51.51],
    note: "Digitaal Vlaanderen: historical maps (Pourbus 1571, Fricx 1712, Ferraris 1777, Atlas der Buurtwegen, Popp, Vandermaelen) and orthophoto mosaics 1971, 1979-90, 2000-11 and every winter since 2012.", infoUrl: "https://www.vlaanderen.be/digitaal-vlaanderen", licence: "Modellicentie gratis hergebruik",
    layers: VL_LAYERS.map(([service, key, label, y, e]) => ({ key, year: y, endYear: e, label, url: vlTile(service, key), type: "tms" as const, maxzoom: service === "HISTCART" ? 18 : 21 })),
  },
  {
    id: "cat-nat-pdok", group: "Historical · Netherlands and Luxembourg", label: "Netherlands (PDOK Luchtfoto)", short: "PDOK", color: "#fed7aa", bbox: [3.2, 50.7, 7.3, 53.6],
    note: "PDOK aerial photos every year since 2016: 25 cm, and 7.5 cm (HR) since 2021.", infoUrl: "https://www.pdok.nl/", licence: "CC BY 4.0",
    layers: PDOK_LAYERS.map(([key, y]) => ({ key, year: y, label: `Luchtfoto ${y} ${key.endsWith("HR") ? "7.5 cm" : "25 cm"}`, url: `${PDOK}/${key}/EPSG:3857/{z}/{x}/{y}.jpeg`, type: "tms" as const, maxzoom: key.endsWith("HR") ? 21 : 19 })),
  },
  {
    id: "cat-nat-wien", group: "Historical · Austria", label: "Vienna (Luftbildpläne)", short: "Wien", color: "#e9d5ff", bbox: [16.17, 48.1, 16.58, 48.33],
    note: "Stadt Wien aerial maps: 1938, 1956, 1961, 1971-1992 and every year since 2014.", infoUrl: "https://www.wien.gv.at/", licence: "CC BY 4.0",
    layers: [...WIEN_YEARS.map(([y, style]) => ({ key: `lb${y}`, year: y, label: `Luftbild ${y}`, url: `https://mapsneu.wien.gv.at/wmts/lb${y}/${style}/google3857/{z}/{y}/{x}.jpeg`, type: "tms" as const, maxzoom: 21 })),
      { key: "lb", year: 2025, label: "Luftbild 2025", url: "https://mapsneu.wien.gv.at/wmts/lb/farbe/google3857/{z}/{y}/{x}.jpeg", type: "tms" as const, maxzoom: 21 }],
  },
  {
    id: "cat-nat-lu", group: "Historical · Netherlands and Luxembourg", label: "Luxembourg (geoportail.lu)", short: "LU", color: "#bfdbfe", bbox: [5.73, 49.44, 6.53, 50.19],
    note: "Orthophotos of Luxembourg: 1967, 2001-2013 every three years, then yearly.", infoUrl: "https://data.public.lu/", licence: "CC0",
    layers: LU_YEARS.map((y) => ({ key: `ortho_${y}`, year: y, label: `Orthophoto ${y}`, url: `https://wmts1.geoportail.lu/opendata/wmts/ortho_${y}/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg`, type: "tms" as const, maxzoom: 21 })),
  },
  {
    id: "cat-nat-hamburg", group: "Historical · Germany", label: "Hamburg (DOP Zeitreihe)", short: "Hamburg", color: "#a5f3fc", bbox: [9.7, 53.39, 10.33, 53.74],
    note: "Hamburg orthophotos every year: leafless (spring) 2001-2026, leafy (summer) 2005-2024.", infoUrl: "https://geoportal-hamburg.de/", licence: "DL-DE BY 2.0",
    layers: [
      ...range(2001, 2026).map((y) => ({ key: `unbelaubt-${y}`, year: y, label: `DOP ${y} leafless`, url: wms("https://geodienste.hamburg.de/wms_dop_zeitreihe_unbelaubt", "dop_zeitreihe_unbelaubt", "image/jpeg", `&TIME=${y}`), type: "wms" as const, maxzoom: 21 })),
      ...range(2005, 2024).map((y) => ({ key: `belaubt-${y}`, year: y, label: `DOP ${y} leafy`, url: wms("https://geodienste.hamburg.de/wms_dop_zeitreihe_belaubt", "dop_zeitreihe_belaubt", "image/jpeg", `&TIME=${y}`), type: "wms" as const, maxzoom: 21 })),
    ],
  },
  {
    id: "cat-nat-bayern", group: "Historical · Germany", label: "Bavaria (historische DOP)", short: "Bayern", color: "#c7d2fe", bbox: [8.97, 47.27, 13.84, 50.56],
    note: "Bayerische Vermessungsverwaltung orthophotos 2003-2025, flown every other year: dated by the flight under the view centre.", infoUrl: "https://geodaten.bayern.de/opengeodata/", licence: "CC BY 4.0",
    layers: BY_YEARS.map((y) => ({ key: `by_dop_${y}_h`, year: y, label: `DOP ${y}`, url: wms(BY, `by_dop_${y}_h`), type: "wms" as const, maxzoom: 20 })),
    dates: async (lng, lat, signal) => {
      const info = await featureInfo(BY, BY_YEARS.map((y) => `by_dop_${y}_h_info`), lng, lat, signal)
      const out: Record<string, string[]> = {}
      for (const [layer, block] of Object.entries(info)) {
        const d = /ua = '([^']+)'/.exec(block)?.[1]
        if (d) out[layer.replace(/_info$/, "")] = [isoOf(d)]
      }
      return out
    },
  },
  {
    id: "cat-nat-tirol", group: "Historical · Austria", label: "Tyrol (Land Tirol)", short: "Tirol", color: "#d9f99d", bbox: [10.09, 46.65, 12.97, 47.75],
    note: "Land Tirol orthophotos: 1940, 1949-54, 1970-82, then periods of three to five years; the flight year under the view centre dates each tick.", infoUrl: "https://www.tirol.gv.at/sicherheit/geoinformation/", licence: "Land Tirol OGD (CC BY 4.0)",
    layers: TIROL_PERIODS.map(([p, y, e]) => ({ key: `Image_${p}`, year: y, endYear: e, label: `Orthofoto ${p.replace("_", "-")}`, url: wms(TIROL, `Image_${p}`), type: "wms" as const, maxzoom: 20 })),
    dates: async (lng, lat, signal) => {
      const info = await featureInfo(TIROL, TIROL_PERIODS.map(([p]) => `Flugjahr_${p}`), lng, lat, signal)
      const out: Record<string, string[]> = {}
      for (const [layer, row] of Object.entries(info)) {
        const y = /;(1[89]\d\d|20\d\d)(?:-\d{4})?;/.exec(row)?.[1] ?? /\b(1[89]\d\d|20\d\d)\b/.exec(row.split(" ").slice(1).join(" "))?.[1]
        if (y) out[layer.replace(/^Flugjahr_/, "Image_")] = [`${y}-01-01`]
      }
      return out
    },
  },
  {
    id: "cat-nat-gsi", group: "Historical · Asia and Oceania", label: "Japan (GSI aerial photos)", short: "GSI", color: "#fecdd3", bbox: [122, 24, 154, 46],
    note: "Geospatial Information Authority of Japan: army aerial photos 1936-42, US Army 1945-50, 1961-69, and the 1974-1990 national series.", infoUrl: "https://maps.gsi.go.jp/development/ichiran.html", licence: "GSI terms (attribution)",
    layers: GSI_LAYERS.map(([key, label, y, e, ext]) => ({ key, year: y, endYear: e, label: `${label} ${y}-${e}`, url: `https://cyberjapandata.gsi.go.jp/xyz/${key}/{z}/{x}/{y}.${ext}`, type: "tms" as const, maxzoom: 17 })),
  },
  {
    id: "cat-nat-nyc", group: "Historical · North America", label: "New York City (NYC orthos)", short: "NYC", color: "#fde2e4", bbox: [-74.26, 40.49, -73.7, 40.92],
    note: "NYC aerial orthophotos: 1924, 1951, then 1996-2018.", infoUrl: "https://maps.nyc.gov/", licence: "NYC Open Data",
    layers: NYC_YEARS.map((y) => ({ key: `photo-${y}`, year: y, label: `NYC ${y}`, url: `https://maps.nyc.gov/xyz/1.0.0/photo/${y}/{z}/{x}/{y}.png8`, type: "tms" as const, maxzoom: 21 })),
  },
  {
    id: "cat-nat-dop1953", group: "Historical · Germany", label: "Mecklenburg-Vorpommern and Brandenburg 1953", short: "DOP 1953", color: "#e7e5e4", bbox: [11.2, 51.35, 14.8, 54.7],
    note: "The 1953 black-and-white orthophotos of Mecklenburg-Vorpommern and Brandenburg.", infoUrl: "https://www.laiv-mv.de/Geoinformation/Geobasisdaten/", licence: "DL-DE BY 2.0",
    layers: [
      { key: "mv_dop1953", year: 1953, label: "Mecklenburg-Vorpommern 1953", url: wms("https://www.geodaten-mv.de/dienste/dop1953_wms", "mv_dop1953"), type: "wms" as const, maxzoom: 19, bbox: [10.55, 53.1, 14.45, 54.7] },
      { key: "bb_dop100g_1953", year: 1953, label: "Brandenburg 1953", url: wms("https://isk.geobasis-bb.de/mapproxy/dop100g_1953/service/wms", "bb_dop100g_1953"), type: "wms" as const, maxzoom: 19, bbox: [11.26, 51.35, 14.77, 53.56] },
    ],
  },
  {
    id: "cat-nat-weld", group: "Historical · Global", label: "Landsat WELD annual (NASA GIBS)", short: "WELD", color: "#ddd6fe", bbox: [-180, -85, 180, 85], resClass: "medium",
    note: "NASA's Web-Enabled Landsat Data annual mosaics, 30 m: the years before Sentinel-2 and HLS.", infoUrl: "https://worldview.earthdata.nasa.gov/", licence: "NASA open data",
    layers: WELD_YEARS.map((y) => ({ key: `weld-${y}`, year: y, label: `Landsat WELD ${y}`, url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default/${y}-12-01/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg`, type: "tms" as const, maxzoom: 12 })),
  },
]
// Generated sources: their layers arrive with loadNationalLayers().
NATIONAL_SOURCES.push(...(catalogJson as Omit<NatSource, "layers">[]).map((c) => ({ ...c, bbox: c.bbox as Bbox, layers: [], lazy: true })))
export const NATIONAL_SOURCE_BY_ID = Object.fromEntries(NATIONAL_SOURCES.map((s) => [s.id, s])) as Record<string, NatSource>

let layersJson: Promise<Record<string, NatLayer[]>> | null = null
/** A source's layers, the generated ones fetched once (a separate chunk). */
export async function loadNationalLayers(src: NatSource): Promise<NatLayer[]> {
  if (!src.lazy) return src.layers
  if (!layersJson) layersJson = import("./national-historical-layers.json").then((m) => (m.default ?? m) as unknown as Record<string, NatLayer[]>)
  return (await layersJson)[src.id] ?? []
}
