import type React from "react"
import { useCallback, useRef, useState } from "react"
import { useAtom, useSetAtom, useAtomValue } from "jotai"
import { MapPin, Edit, Trash2, Upload, HardDrive, Link, ExternalLink, Sigma, Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCogProtocolVsTitilerAtom, customTerrainSourcesAtom, mapboxKeyAtom, maptilerKeyAtom, titilerEndpointAtom } from "@/lib/settings-atoms"
import { useClientDemUpstream } from "@/components/LayersAndSources/MapSources"
import { sharedTileCache, fetchDecodedTile } from "@/lib/normal-derived-protocol"
import { pushToast } from "@/components/ui/toast"
import type { MapRef } from "react-map-gl/maplibre"
import { registerLocalFileAtom, resolveLocalFileUrl, localFileId, localFileVersionAtom } from "@/lib/local-file-store"

export const CustomSourceDetails: React.FC<{
  source: any; handleFitToBounds: any; handleEditSource: any; handleDeleteCustomSource: any
  /** The map, for the difference source's auto-offset (it samples the tiles
   *  on screen). Basemap rows never pass it and never show that button. */
  mapRef?: React.RefObject<MapRef>
  /** Called with source.id when the label is clicked, e.g. setState({ sourceA: id }) or
   *  setState({ basemapSource: id }) — the caller decides which state key to write.
   *  Omit in contexts (e.g. split-screen A/B) where a separate control already handles
   *  selection and the label should only fit-to-bounds. */
  onSelect?: (id: string) => void
  /** Name of the paired terrain/basemap source this one is linked to (see
   *  CustomTerrainSource.linkedBasemapId / CustomBasemapSource.linkedTerrainId)
   *  — the caller resolves this since it needs the OTHER list to look it up.
   *  Undefined/empty renders no badge at all. */
  linkedSourceName?: string
}> = ({ source, mapRef, handleFitToBounds, handleEditSource, handleDeleteCustomSource, onSelect, linkedSourceName }) => {
  const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)
  const registerLocalFile = useSetAtom(registerLocalFileAtom)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The File behind a "cog-local" source only lives in this tab's memory — after
  // a reload (or in a fresh tab) it's gone until re-picked, so re-render whenever
  // one is (re-)registered to flip between "Re-select file…" and the normal row.
  useAtomValue(localFileVersionAtom)
  const isLocalFileMissing = source.type === "cog-local" && !resolveLocalFileUrl(localFileId(source.url))
  // VRT only streams through titiler (see custom-terrain-source-modal.tsx) — a VRT
  // source already saved in the BYOD list is just as unusable in geomatico mode as
  // picking "VRT" fresh from the Type dropdown, so disable it here too rather than
  // letting it silently fail to select/render.
  const isDisabledVrt = source.type === "vrt" && useCogProtocol

  // ── Auto-offset for a difference source ──────────────────────────────────
  // A DSM minus DTM from two different producers, or two dates, or a source
  // on the ellipsoid minus one on the geoid, rarely centres on zero: there is
  // a constant (locally) between them - a datum, a co-registration bias, a
  // different notion of "ground". diffOffsetM is the knob that removes it;
  // this measures it, from the tiles actually on screen, instead of asking
  // for a number.
  //
  // The two operands are resolved with the same hook MapSources uses for the
  // difference itself, so the templates sampled here are exactly the ones the
  // rendered layer subtracts. Both hooks are called unconditionally (rules of
  // hooks) with "" for non-difference rows, which resolves to null.
  const isDiff = source.type === "dem-diff"
  const [customTerrainSources, setCustomTerrainSources] = useAtom(customTerrainSourcesAtom)
  const mapboxKey = useAtomValue(mapboxKeyAtom)
  const maptilerKey = useAtomValue(maptilerKeyAtom)
  const titilerEndpoint = useAtomValue(titilerEndpointAtom)
  const opA = useClientDemUpstream(isDiff ? source.diffMinuendId ?? "" : "", customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, undefined, undefined, true)
  const opB = useClientDemUpstream(isDiff ? source.diffSubtrahendId ?? "" : "", customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, undefined, undefined, true)
  const [offsetBusy, setOffsetBusy] = useState(false)
  const autoOffset = useCallback(async () => {
    const map = mapRef?.current?.getMap()
    if (!map || !opA || !opB) {
      pushToast({ key: "ndsm-offset", title: "Cannot sample the difference yet", body: "Both operands have to be resolvable first - one of them is still loading its metadata, or is itself a difference." })
      return
    }
    setOffsetBusy(true)
    try {
      // Tiles under the viewport at the current zoom, capped both by the
      // coarser operand's pyramid (its tiles simply do not exist deeper -
      // the protocol walks up to an ancestor, this sampler does not) and at
      // z14, so a WMS operand with no fixed pyramid is not asked for a
      // screenful of z18 GetMaps for a statistic.
      const b = map.getBounds()
      let z = Math.max(0, Math.min(Math.floor(map.getZoom()), opA.maxzoom ?? 14, opB.maxzoom ?? 14, 14))
      const toTile = (lat: number, lng: number, zz: number) => {
        const n = 2 ** zz
        const x = Math.floor(((lng + 180) / 360) * n)
        const sn = Math.sin((lat * Math.PI) / 180)
        const y = Math.floor((0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * n)
        return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))]
      }
      let tiles: [number, number][] = []
      for (;;) {
        const [x0, y0] = toTile(b.getNorth(), b.getWest(), z)
        const [x1, y1] = toTile(b.getSouth(), b.getEast(), z)
        tiles = []
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y])
        if (tiles.length <= 16 || z === 0) break
        z--
      }
      const fill = (u: string, x: number, y: number) => u.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))
      const ctrl = new AbortController()
      const samples: number[] = []
      const GRID = 24 // per tile, per axis - fractional positions, so operands of different tile sizes still line up
      await Promise.all(tiles.map(async ([x, y]) => {
        const [a, c] = await Promise.all([
          fetchDecodedTile(sharedTileCache, fill(opA.template, x, y), opA.encoding, ctrl.signal),
          fetchDecodedTile(sharedTileCache, fill(opB.template, x, y), opB.encoding, ctrl.signal),
        ])
        if (!a || !c) return
        for (let r = 0; r < GRID; r++) for (let q = 0; q < GRID; q++) {
          const fr = (r + 0.5) / GRID, fc = (q + 0.5) / GRID
          const ia = Math.floor(fr * a.height) * a.width + Math.floor(fc * a.width)
          const ic = Math.floor(fr * c.height) * c.width + Math.floor(fc * c.width)
          if ((a.valid && !a.valid[ia]) || (c.valid && !c.valid[ic])) continue
          const va = a.data[ia], vc = c.data[ic]
          if (!Number.isFinite(va) || !Number.isFinite(vc) || va < -1000 || va > 10000 || vc < -1000 || vc > 10000) continue
          samples.push(va - vc)
        }
      }))
      if (samples.length < 50) {
        pushToast({ key: "ndsm-offset", title: "Not enough overlap on screen", body: `Only ${samples.length} pixels had both operands here. Move to where both sources have data and try again.` })
        return
      }
      // Interquartile mean: robust to the very things a difference is made
      // to show (buildings, canopy, a quarry) while still averaging over the
      // bulk. A plain mean would be dragged by them; a median alone throws
      // away the half of the data that agrees.
      samples.sort((p, q) => p - q)
      const q1 = samples[Math.floor(samples.length * 0.25)], q3 = samples[Math.floor(samples.length * 0.75)]
      const inner = samples.filter((v) => v >= q1 && v <= q3)
      const mean = inner.reduce((acc, v) => acc + v, 0) / inner.length
      const median = samples[Math.floor(samples.length / 2)]
      // The protocol ADDS the offset, so the offset is minus what we measured.
      const offset = Math.round(-mean * 10) / 10
      setCustomTerrainSources((prev) => prev.map((s) => (s.id === source.id ? { ...s, diffOffsetM: offset } : s)))
      pushToast({
        key: "ndsm-offset",
        title: `Offset set to ${offset > 0 ? "+" : ""}${offset} m`,
        body: `Interquartile mean of ${samples.length.toLocaleString()} samples over ${tiles.length} tile${tiles.length === 1 ? "" : "s"} at z${z} (median ${median >= 0 ? "+" : ""}${median.toFixed(1)} m). The difference now centres on zero for this area.`,
        duration: 8000,
      })
    } finally {
      setOffsetBusy(false)
    }
  }, [mapRef, opA, opB, source.id, setCustomTerrainSources])

  if (isLocalFileMissing) {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept=".tif,.tiff,image/tiff"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) registerLocalFile({ id: localFileId(source.url), file })
          }}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                className="flex-1 justify-start text-sm truncate min-w-0 text-muted-foreground cursor-pointer h-8"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1 shrink-0" /> {source.name} — re-select file…
              </Button>
            }
          />
          <TooltipContent><p>This browser couldn't restore "{source.name}" locally (unsupported browser, storage limit, or it was cleared) — pick it again to use it this session</p></TooltipContent>
        </Tooltip>
        {/* Remote COGs can be inspected in a standalone viewer: source.coop's
            COG viewer (metadata, overviews, band stats) or GeoLibre. */}
        {source.type === "cog" && /^https?:\/\//.test(source.url) && (
          <Tooltip>
            <TooltipTrigger
              render={
                <a href={`https://source-cooperative.github.io/cog-viewer/?url=${encodeURIComponent(source.url)}`} target="_blank" rel="noopener noreferrer"
                  className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              }
            />
            <TooltipContent>
              <p>Open in the source.coop COG viewer</p>
              <p className="text-muted-foreground">or in <a href={`https://web.geolibre.app/?data=${encodeURIComponent(source.url)}`} target="_blank" rel="noopener noreferrer" className="underline">GeoLibre</a></p>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleEditSource(source.id)}>
                <Edit className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent><p>Edit</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleDeleteCustomSource(source.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent><p>Delete</p></TooltipContent>
        </Tooltip>
      </>
    )
  }

  return (
    <>
    {/* Local COGs still look exactly like any other working source once picked
        (or restored from OPFS) — this badge is the only remaining hint that
        it's a browser-local file (like a QGIS scratch/memory layer) rather
        than a portable, shareable URL anyone else could open. */}
    {source.type === "cog-local" && (
      <Tooltip>
        <TooltipTrigger render={<span className="shrink-0"><HardDrive className="h-3.5 w-3.5 text-muted-foreground" /></span>} />
        <TooltipContent><p>Local file — lives only in this browser's storage, not a shareable URL</p></TooltipContent>
      </Tooltip>
    )}
    {linkedSourceName && (
      <Tooltip>
        <TooltipTrigger render={<span className="shrink-0"><Link className="h-3.5 w-3.5 text-muted-foreground" /></span>} />
        <TooltipContent><p>Linked to "{linkedSourceName}" — selecting either one auto-selects the other</p></TooltipContent>
      </Tooltip>
    )}
    <Tooltip>
      <TooltipTrigger
        render={
          <Label
            htmlFor={`source-${source.id}`}
            className={`flex-1 text-sm truncate min-w-0 ${isDisabledVrt ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            onClick={() => {
              if (isDisabledVrt) return
              onSelect?.(source.id)
              handleFitToBounds(source)
            }}
            >
            {source.name}
          </Label>
        }
      />
      <TooltipContent> <p>{isDisabledVrt ? "VRT only works in titiler streaming mode" : source.name}</p> </TooltipContent>
    </Tooltip>

    {(['cog', 'cog-local', 'vrt', 'tilejson'].includes(source.type) || !!source.bounds) && (
      <Tooltip>
        {/* force=true: this button always fits, unlike the label click above which
            only fits when smart-zoom decides the camera should actually move. */}
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" disabled={isDisabledVrt} onClick={() => handleFitToBounds(source, true)}>
              <MapPin className="h-4 w-4" />
            </Button>
          }
        />
        <TooltipContent><p>Fit to bounds</p></TooltipContent>
      </Tooltip>
    )}
    {isDiff && mapRef && (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" disabled={offsetBusy} onClick={autoOffset}>
              {offsetBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sigma className="h-4 w-4" />}
            </Button>
          }
        />
        <TooltipContent>
          <p>Auto offset: measure the constant between the two sources over the area on screen and set the co-registration offset so the difference centres on zero{source.diffOffsetM ? ` (currently ${source.diffOffsetM > 0 ? "+" : ""}${source.diffOffsetM} m)` : ""}.</p>
        </TooltipContent>
      </Tooltip>
    )}
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleEditSource(source.id)}>
            <Edit className="h-4 w-4" />
          </Button>
        }
      />
      <TooltipContent><p>Edit</p></TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleDeleteCustomSource(source.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        }
      />
      <TooltipContent><p>Delete</p></TooltipContent>
    </Tooltip>
    </>
  )
}
