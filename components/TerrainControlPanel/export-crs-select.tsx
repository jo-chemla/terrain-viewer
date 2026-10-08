import type React from "react"
import { useState } from "react"
import { useAtom } from "jotai"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { exportCrsAtom } from "@/lib/settings-atoms"
import { crsLabel, suggestUtmEpsg } from "@/lib/output-crs"

/** The output CRS of the DEM, layer and snapshot exports (exportCrsAtom):
 *  Web Mercator, WGS 84, the UTM zone of the export's centre, or any EPSG
 *  code. The pixels stay on the Web Mercator grid; the georeferencing is
 *  an affine fitted in the chosen CRS (lib/output-crs.ts). */
export const ExportCrsSelect: React.FC<{
  /** Centre of the current export extent, for the UTM option's label. */
  center?: { lng: number; lat: number } | null
  disabled?: boolean
  className?: string
}> = ({ center, disabled, className }) => {
  const [value, setValue] = useAtom(exportCrsAtom)
  const preset = value === "3857" || value === "4326" || value === "utm"
  const [other, setOther] = useState(preset ? "" : value)
  const choice = preset ? value : "other"
  const utmEpsg = suggestUtmEpsg(center?.lng ?? 0, center?.lat ?? 0)
  const utmLabel = center ? crsLabel(utmEpsg).replace(/^EPSG:(\d+) \((.*)\)$/, "$2 (EPSG:$1)") : "UTM zone of the export centre"
  const items = [
    { value: "3857", label: "EPSG:3857 (Web Mercator)" },
    { value: "4326", label: "EPSG:4326 (WGS 84)" },
    { value: "utm", label: utmLabel },
    { value: "other", label: other ? `EPSG:${other}` : "Other EPSG code…" },
  ]
  return (
    <div className={`flex items-center gap-2 min-w-0 ${className ?? ""}`}>
      <Select
        value={choice}
        disabled={disabled}
        onValueChange={(v) => { if (!v) return; if (v === "other") setValue(other || "other"); else setValue(v) }}
        items={items}
      >
        <SelectTrigger className="flex-1 w-0 min-w-0 cursor-pointer h-7" aria-label="Output CRS">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {choice === "other" && (
        <Input
          type="number" min={1} step={1} placeholder="e.g. 2154" aria-label="EPSG code" disabled={disabled}
          value={other}
          onChange={(e) => { setOther(e.target.value); setValue(e.target.value || "other") }}
          className="cursor-text h-7 w-24 shrink-0 text-right"
        />
      )}
    </div>
  )
}
