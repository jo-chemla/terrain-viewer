import type React from "react"
import { useCallback, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { Sigma, Loader2, RotateCcw } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { customTerrainSourcesAtom, mapboxKeyAtom, maptilerKeyAtom, titilerEndpointAtom, type CustomTerrainSource } from "@/lib/settings-atoms"
import { useClientDemUpstream } from "@/components/LayersAndSources/MapSources"
import { fetchOperand, sampleOperand } from "@/lib/demdiff-protocol"
import { DraftBoundInput } from "./controls-components"
import { pushToast } from "@/components/ui/toast"

/**
 * The co-registration offset of the difference source currently on screen —
 * measured from the tiles in view, or reset.
 *
 * A DSM minus DTM from two producers, two dates, or ellipsoid minus geoid
 * rarely centres on zero: there is a local constant between them (a datum, a
 * bias, a different notion of "ground"). `diffOffsetM` removes it. This lives
 * in the hypsometric section rather than beside the source's name because the
 * ramp is where the offset is VISIBLE: a diverging ramp centred on zero is what
 * it exists to make honest.
 *
 * Two states, one button. At zero it measures (Σ): interquartile mean of the
 * raw a−b over up to 16 on-screen tiles, so buildings, canopy or a quarry — the
 * things a difference is made to show — cannot drag it. At any other value it
 * resets (↺), because a true nDSM should NOT be re-centred: zero there means
 * bare earth, and the measured constant is the height of the city.
 */
export const DiffOffsetControl: React.FC<{ sourceId: string; mapRef: React.RefObject<MapRef> }> = ({ sourceId, mapRef }) => {
  const [customTerrainSources, setCustomTerrainSources] = useAtom(customTerrainSourcesAtom)
  const source = customTerrainSources.find((s) => s.id === sourceId)
  const isDiff = source?.type === "dem-diff"
  const mapboxKey = useAtomValue(mapboxKeyAtom)
  const maptilerKey = useAtomValue(maptilerKeyAtom)
  const titilerEndpoint = useAtomValue(titilerEndpointAtom)
  // Same resolution MapSources uses for the rendered difference, so what is
  // sampled is exactly what is subtracted. Hooks are unconditional ("" for a
  // non-difference source resolves to null).
  const opA = useClientDemUpstream(isDiff ? source!.diffMinuendId ?? "" : "", customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, undefined, undefined, true)
  const opB = useClientDemUpstream(isDiff ? source!.diffSubtrahendId ?? "" : "", customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, undefined, undefined, true)
  const [busy, setBusy] = useState(false)
  const offset = source?.diffOffsetM ?? 0

  const write = useCallback((value: number | undefined) => {
    setCustomTerrainSources((prev) => prev.map((s): CustomTerrainSource => (s.id === sourceId ? { ...s, diffOffsetM: value } : s)))
  }, [setCustomTerrainSources, sourceId])

  const measure = useCallback(async () => {
    const map = mapRef.current?.getMap()
    if (!map || !opA || !opB) {
      pushToast({ key: "ndsm-offset", title: "Cannot sample the difference yet", body: "Both operands have to be resolvable first — one is still loading its metadata, or is itself a difference." })
      return
    }
    setBusy(true)
    try {
      // Tiles under the viewport, capped at z14 so a WMS operand is not asked
      // for a screenful of z18 GetMaps just for a statistic. A declared maxzoom
      // is deliberately NOT used as a cap any more: it lies often enough (see
      // the Mapterhorn note below) and the ancestor walk covers the real case.
      const b = map.getBounds()
      let z = Math.max(0, Math.min(Math.floor(map.getZoom()), 14))
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
      const ctrl = new AbortController()
      const samples: number[] = []
      const GRID = 24 // per tile per axis
      // fetchOperand/sampleOperand are the protocol's OWN pair (exported from
      // lib/demdiff-protocol.ts), so this measures exactly what gets rendered.
      // Crucially they walk up to an ancestor tile when a source has nothing at
      // this zoom: Mapterhorn declares maxzoom 18 but falls back to GLO-30 over
      // most of the world and 404s from z13 there, which is why sampling it
      // directly returned "not enough overlap" against a fine COG in Nepal.
      await Promise.all(tiles.map(async ([x, y]) => {
        const [a, c] = await Promise.all([
          fetchOperand(opA.template, opA.encoding, z, x, y, ctrl.signal),
          fetchOperand(opB.template, opB.encoding, z, x, y, ctrl.signal),
        ])
        if (!a || !c) return
        for (let r = 0; r < GRID; r++) for (let q = 0; q < GRID; q++) {
          const row = Math.floor(((r + 0.5) / GRID) * 256), col = Math.floor(((q + 0.5) / GRID) * 256)
          const va = sampleOperand(a, row, col, 256), vc = sampleOperand(c, row, col, 256)
          if (!Number.isFinite(va) || !Number.isFinite(vc)) continue
          samples.push(va - vc)
        }
      }))
      if (samples.length < 50) {
        pushToast({ key: "ndsm-offset", title: "Not enough overlap on screen", body: `Only ${samples.length} pixels had both operands here. Move to where both sources have data and try again.` })
        return
      }
      samples.sort((p, q) => p - q)
      const q1 = samples[Math.floor(samples.length * 0.25)], q3 = samples[Math.floor(samples.length * 0.75)]
      const inner = samples.filter((v) => v >= q1 && v <= q3)
      const mean = inner.reduce((acc, v) => acc + v, 0) / inner.length
      const median = samples[Math.floor(samples.length / 2)]
      // The protocol ADDS the offset, so the offset is minus what was measured.
      const next = Math.round(-mean * 10) / 10
      write(next)
      pushToast({
        key: "ndsm-offset",
        title: `Offset set to ${next > 0 ? "+" : ""}${next} m`,
        body: `Interquartile mean of ${samples.length.toLocaleString()} samples over ${tiles.length} tile${tiles.length === 1 ? "" : "s"} at z${z} (median ${median >= 0 ? "+" : ""}${median.toFixed(1)} m). The difference now centres on zero for this area — press again to reset.`,
        duration: 8000,
      })
    } finally {
      setBusy(false)
    }
  }, [mapRef, opA, opB, write])

  if (!isDiff) return null
  const hasOffset = offset !== 0
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-sm font-medium">Difference offset</span>
      <div className="flex items-center gap-1.5">
        {/* Typed as well as measured: a known datum shift (a geoid separation,
         *  a published co-registration bias) is a number you already have, and
         *  measuring it from the screen would only approximate it. */}
        <DraftBoundInput
          value={offset}
          onCommit={(v) => write(v && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined)}
          placeholder="0"
          className="h-7 py-1 px-2 text-sm w-20 min-w-0 text-right rounded-md border border-input bg-transparent shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] tabular-nums"
          step={0.1}
        />
        <span className="text-sm text-muted-foreground">m</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 cursor-pointer" disabled={busy}
                onClick={() => (hasOffset ? write(undefined) : void measure())}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : hasOffset ? <RotateCcw className="h-4 w-4" /> : <Sigma className="h-4 w-4" />}
              </Button>
            }
          />
          <TooltipContent>
            <p className="max-w-[260px]">
              {hasOffset
                ? `Reset the offset to 0 m. Use this for a true nDSM: zero means bare earth, and the measured constant was the height of what stands on it.`
                : `Measure the constant between the two sources over the area on screen (interquartile mean) and set the offset so the difference centres on zero — for a datum or co-registration difference, or two dates of the same ground.`}
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
