// gdal_translate script generation for lib/export-multi.ts's batch export —
// wraps a source's own tile URL template in a GDAL_WMS mini-driver XML
// (ported from Iconem's own historical-satellite export tooling), so a user
// can later re-crop/re-fetch the exact same tiles outside the browser, at
// full native resolution, via a plain gdal_translate call — instead of only
// ever getting the (resolution-capped, browser-fetched) GeoTIFF this app
// writes itself.
//
// Two GDAL_WMS service types are used, matching how each source actually
// addresses its tiles:
// - "TMS" for a real, standalone {z}/{x}/{y} HTTP(S) URL (Wayback, HLS,
//   Planet, EOX Sentinel-2) — see hasGdalTemplate.
// - "VirtualEarth" for Bing, which addresses tiles by quadkey rather than
//   z/x/y (gdal.org/en/stable/drivers/raster/wms.html#virtualearth) — see
//   hasGdalQuadkeyTemplate.
// GE Historical is the one source genuinely left out: its own "tile URL" is
// a custom `gehistorical://{z}/{x}/{y}` scheme this app resolves INTERNALLY
// (binary flatfile/dbRoot decoding against khmdb.google.com/kh.google.com —
// see lib/ge-timemachine/ge-historical.js) — there's no public REST
// endpoint gdal_translate could hit directly with this URL.
import type { Bbox4 } from "./feature-extent"

function escapeAmp(url: string): string {
  return url.replaceAll("&", "&amp;")
}

function buildGdalWmsTmsXml(tmsUrl: string): string {
  const serverUrl = escapeAmp(tmsUrl.replace("{x}", "${x}").replace("{y}", "${y}").replace("{z}", "${z}"))
  return `<GDAL_WMS><Service name='TMS'><ServerUrl>${serverUrl}</ServerUrl></Service><DataWindow><UpperLeftX>-20037508.34</UpperLeftX><UpperLeftY>20037508.34</UpperLeftY><LowerRightX>20037508.34</LowerRightX><LowerRightY>-20037508.34</LowerRightY><TileLevel>18</TileLevel><TileCountX>1</TileCountX><TileCountY>1</TileCountY><YOrigin>top</YOrigin></DataWindow><Projection>EPSG:3857</Projection><BlockSizeX>256</BlockSizeX><BlockSizeY>256</BlockSizeY><BandsCount>3</BandsCount><Cache /></GDAL_WMS>`
}

// DataWindow is deliberately omitted — GDAL_WMS's own VirtualEarth defaults
// (TileLevel 21, OverviewCount 20, EPSG:3857) already match Bing's real
// pyramid, per the driver docs.
function buildGdalWmsVirtualEarthXml(quadkeyUrl: string): string {
  const serverUrl = escapeAmp(quadkeyUrl.replace("{quadkey}", "${quadkey}"))
  return `<GDAL_WMS><Service name='VirtualEarth'><ServerUrl>${serverUrl}</ServerUrl></Service></GDAL_WMS>`
}

/** True only for a real http(s) {z}/{x}/{y}-style template — the one shape
 *  GDAL_WMS's TMS driver can address directly. */
export function hasGdalTemplate(tileUrlTemplate: string | undefined): tileUrlTemplate is string {
  return !!tileUrlTemplate && /^https?:\/\//.test(tileUrlTemplate) && tileUrlTemplate.includes("{x}")
}

/** True only for a real http(s) {quadkey}-style template (Bing). */
export function hasGdalQuadkeyTemplate(quadkeyUrlTemplate: string | undefined): quadkeyUrlTemplate is string {
  return !!quadkeyUrlTemplate && /^https?:\/\//.test(quadkeyUrlTemplate) && quadkeyUrlTemplate.includes("{quadkey}")
}

export function buildGdalTranslateCommand(opts: {
  tileUrlTemplate?: string
  quadkeyUrlTemplate?: string
  bbox: Bbox4
  filename: string
  outsizeWidth: number
}): string {
  const [west, south, east, north] = opts.bbox
  const xml = hasGdalQuadkeyTemplate(opts.quadkeyUrlTemplate)
    ? buildGdalWmsVirtualEarthXml(opts.quadkeyUrlTemplate)
    : buildGdalWmsTmsXml(opts.tileUrlTemplate!)
  return `gdal_translate -projwin ${west} ${north} ${east} ${south} -projwin_srs EPSG:4326 -outsize ${Math.round(opts.outsizeWidth)} 0 "${xml}" "${opts.filename}.tif"`
}

/** REM-commented placeholder for a source this app can't build a real
 *  command for (see the module header) — kept in the script, not silently
 *  dropped, so it's visible which sources were skipped and why. */
export function buildGdalSkipComment(sourceLabel: string, reason: string): string {
  return `REM ${sourceLabel}: skipped — ${reason}`
}
