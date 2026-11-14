import type React from "react"
import { useState, useCallback, useEffect, useMemo } from "react"
import { Loader2, ChevronLeft, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SegmentedToggle } from "./controls-components"
import { useAtomValue } from "jotai"
import { sentinelHubInstanceIdAtom } from "@/lib/settings-atoms"
import { maskKeys, fillKeyPlaceholders, SH_INSTANCE_PLACEHOLDER } from "@/lib/key-placeholders"
import { fetchWmtsCapabilities, buildWmtsTileSource, usableMatrixSets, unusableReason, type WmtsCapabilities, type WmtsLayer, type WmtsChoice } from "@/lib/wmts-client"

export interface WmtsPickerSaveParams {
  name: string
  url: string
  type: "wmts"
  description?: string
  bounds?: [west: number, south: number, east: number, north: number]
  minzoom?: number
  maxzoom?: number
  attribution?: string
  infoUrl?: string
  role: "basemap" | "overlay"
  stack?: "under"
}

/**
 * The "WMTS (list layers)" type of Add Basemap: reads a WMTS GetCapabilities
 * document (KVP or RESTful WMTSCapabilities.xml, lib/wmts-client.ts), lists
 * its layers with a filter, and saves the picked layer as an ordinary custom
 * basemap of type "wmts" holding a {z}/{x}/{y} template. Same shape as
 * WmsPickerPanel; a layer offered only in another CRS is listed greyed with
 * the reason.
 */
export const WmtsPickerPanel: React.FC<{
  onSave: (params: WmtsPickerSaveParams) => void
  /** A capabilities URL found by Auto or handed over by the STAC search. */
  initialUrl?: string
  /** Open straight on this layer once the capabilities are read. */
  initialLayer?: string
}> = ({ onSave, initialUrl, initialLayer }) => {
  const [baseUrl, setBaseUrl] = useState(initialUrl ?? "")
  const [caps, setCaps] = useState<WmtsCapabilities | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState("")
  const [picked, setPicked] = useState<WmtsLayer | null>(null)
  const [role, setRole] = useState<"basemap" | "overlay">("basemap")
  const shInstanceId = useAtomValue(sentinelHubInstanceIdAtom)

  const handleFetch = useCallback(async (url = baseUrl) => {
    if (!url.trim()) return
    setIsLoading(true)
    setError("")
    setCaps(null)
    setPicked(null)
    try {
      // A key placeholder in the field ({shInstance}) is filled for the
      // request only; the field keeps showing the placeholder.
      const c = await fetchWmtsCapabilities(fillKeyPlaceholders(url.trim()))
      if (!c.layers.length) throw new Error("The capabilities list no layers.")
      setCaps(c)
      const start = initialLayer ? c.layers.find((l) => l.identifier === initialLayer) : c.layers.length === 1 ? c.layers[0] : undefined
      if (start) setPicked(start)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the WMTS capabilities.")
    } finally {
      setIsLoading(false)
    }
  }, [baseUrl, initialLayer])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialUrl) handleFetch(initialUrl) }, [])

  // Drawable layers first, each with its zoom range, computed once per document.
  const rows = useMemo(() => {
    if (!caps) return []
    return caps.layers
      .map((layer) => ({ layer, sets: usableMatrixSets(caps, layer) }))
      .sort((a, b) => Number(b.sets.length > 0) - Number(a.sets.length > 0))
  }, [caps])
  const q = filter.trim().toLowerCase()
  const shown = useMemo(() => (q ? rows.filter((r) => `${r.layer.title} ${r.layer.identifier}`.toLowerCase().includes(q)) : rows).slice(0, 400), [rows, q])
  const drawable = rows.filter((r) => r.sets.length).length

  return (
    <div className="space-y-3 w-full min-w-0 overflow-hidden">
      <p className="text-xs text-muted-foreground">
        A WMTS GetCapabilities URL (<code>…?SERVICE=WMTS&amp;REQUEST=GetCapabilities</code> or a <code>WMTSCapabilities.xml</code>): its layers are listed, and the one you pick is saved as a tile template.
      </p>
      <div className="flex gap-2 min-w-0">
        <Input
          autoFocus
          placeholder="https://example.com/wmts?SERVICE=WMTS&REQUEST=GetCapabilities"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleFetch() }}
          className="cursor-text min-w-0 flex-1"
        />
        <Button onClick={() => handleFetch()} disabled={isLoading || !baseUrl.trim()} className="cursor-pointer shrink-0">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "List Layers"}
        </Button>
      </div>
      {/* Your own Copernicus Sentinel Hub configuration: the field shows the
          placeholder, filled with the id from Settings when it is fetched. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground min-w-0">
        <Button size="sm" variant="outline" className="h-7 cursor-pointer text-xs" disabled={isLoading || !shInstanceId.trim()}
          title={shInstanceId.trim() ? "Lists the layers of your Copernicus Sentinel Hub configuration" : "Set your Copernicus Sentinel Hub instance id in Settings → API Keys first"}
          onClick={() => { const u = `https://sh.dataspace.copernicus.eu/ogc/wmts/${SH_INSTANCE_PLACEHOLDER}?SERVICE=WMTS&REQUEST=GetCapabilities`; setBaseUrl(u); handleFetch(u) }}>
          Copernicus Sentinel Hub (your configuration)
        </Button>
        {!shInstanceId.trim() && <span className="min-w-0">needs your instance id in Settings → API Keys</span>}
      </div>
      {isLoading && <p className="text-xs text-muted-foreground">Reading the capabilities (some services, NASA GIBS for one, send several megabytes)…</p>}
      {error && <p className="text-sm text-red-500 break-words">{error}</p>}

      {caps && !picked && (
        <div className="space-y-2 w-full min-w-0">
          <p className="text-xs text-muted-foreground break-words">
            <span className="font-medium text-foreground">{caps.title ?? "WMTS service"}</span>
            {caps.provider ? ` · ${caps.provider}` : ""} · {caps.layers.length} layers, {drawable} in Web Mercator
          </p>
          {drawable === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 break-words">
              {unusableReason(caps, caps.layers[0])}
              {/gibs\.earthdata\.nasa\.gov\/wmts\/epsg(4326|3413|3031)\//i.test(caps.url) && " NASA GIBS publishes the same layers in Web Mercator: replace epsg4326 (or epsg3413, epsg3031) with epsg3857 in the URL."}
            </p>
          )}
          <Input placeholder={`Filter ${caps.layers.length} layers…`} value={filter} onChange={(e) => setFilter(e.target.value)} className="cursor-text" />
          <div className="max-h-72 w-full overflow-y-auto overflow-x-hidden space-y-1">
            {shown.map(({ layer, sets }) => {
              const ok = sets.length > 0
              return (
                <button
                  key={layer.identifier}
                  type="button"
                  onClick={() => setPicked(layer)}
                  title={ok ? `${layer.identifier}\nz${sets[0].minzoom}-${sets[0].maxzoom} · ${sets.map((s) => s.set).join(", ")}` : unusableReason(caps, layer)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md p-2 text-left cursor-pointer hover:bg-muted/60 ${ok ? "" : "opacity-60"}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{layer.title}</span>
                    <span className="block text-xs text-muted-foreground truncate">{layer.identifier}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {ok ? `z${sets[0].minzoom}–${sets[0].maxzoom}${layer.dimensions.length ? ` · ${layer.dimensions.map((d) => d.identifier).join(", ")}` : ""}` : "other CRS"}
                  </span>
                </button>
              )
            })}
            {shown.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No layers match "{filter}"</p>}
            {shown.length === 400 && <p className="text-xs text-muted-foreground text-center py-2">First 400 shown: narrow the filter.</p>}
          </div>
        </div>
      )}

      {caps && picked && (
        <WmtsLayerForm
          caps={caps}
          layer={picked}
          role={role}
          onRoleChange={setRole}
          onBack={caps.layers.length > 1 ? () => setPicked(null) : undefined}
          onSave={onSave}
        />
      )}
    </div>
  )
}

/** One layer: style, format, matrix set and dimension values when there is
 *  a choice, the resulting template, and Add. */
const WmtsLayerForm: React.FC<{
  caps: WmtsCapabilities
  layer: WmtsLayer
  role: "basemap" | "overlay"
  onRoleChange: (r: "basemap" | "overlay") => void
  onBack?: () => void
  onSave: (params: WmtsPickerSaveParams) => void
}> = ({ caps, layer, role, onRoleChange, onBack, onSave }) => {
  const sets = useMemo(() => usableMatrixSets(caps, layer), [caps, layer])
  const [choice, setChoice] = useState<WmtsChoice>({})
  const built = useMemo(() => {
    try { return { source: buildWmtsTileSource(caps, layer, choice), error: "" } } catch (e) { return { source: null, error: (e as Error).message } }
  }, [caps, layer, choice])
  const src = built.source
  const formats = layer.formats.length ? layer.formats : [...new Set(layer.resourceUrls.map((r) => r.format))]

  const save = () => {
    if (!src) return
    const dims = Object.entries(src.dimensions).map(([k, v]) => `${k} ${v}`).join(", ")
    onSave({
      name: layer.title + (Object.keys(src.dimensions).some((k) => /^time$/i.test(k)) ? ` (${src.dimensions[Object.keys(src.dimensions).find((k) => /^time$/i.test(k))!]})` : ""),
      // A credential in the URL (a Sentinel Hub instance id) is saved as its
      // placeholder, filled again when tiles are requested.
      url: maskKeys(src.url),
      type: "wmts",
      description: [`WMTS ${caps.title ?? new URL(caps.url).host}`, layer.identifier, src.matrixSet, dims].filter(Boolean).join(" · "),
      bounds: src.bounds,
      minzoom: src.minzoom,
      maxzoom: src.maxzoom,
      attribution: src.attribution,
      infoUrl: caps.url,
      role,
      ...(role === "overlay" ? { stack: "under" as const } : {}),
    })
  }

  return (
    <div className="space-y-3 w-full min-w-0">
      <div className="flex items-start gap-2 min-w-0">
        {onBack && (
          <Button size="sm" variant="ghost" className="h-7 px-1.5 shrink-0 cursor-pointer" onClick={onBack} title="Back to the layer list">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words">{layer.title}</p>
          <p className="text-xs text-muted-foreground break-all">{layer.identifier}</p>
        </div>
      </div>
      {layer.abstract && <p className="text-xs text-muted-foreground line-clamp-3 break-words" title={layer.abstract}>{layer.abstract}</p>}

      {layer.styles.length > 1 && (
        <Row label="Style">
          <Select value={src?.style ?? choice.style ?? ""} onValueChange={(v) => v && setChoice((c) => ({ ...c, style: v as string }))} items={Object.fromEntries(layer.styles.map((s) => [s.identifier, s.title ?? s.identifier]))}>
            <SelectTrigger className="w-full cursor-pointer"><SelectValue /></SelectTrigger>
            <SelectContent>{layer.styles.map((s) => <SelectItem key={s.identifier} value={s.identifier}>{s.title ?? s.identifier}</SelectItem>)}</SelectContent>
          </Select>
        </Row>
      )}
      {formats.length > 1 && (
        <Row label="Format">
          <Select value={src?.format ?? choice.format ?? ""} onValueChange={(v) => v && setChoice((c) => ({ ...c, format: v as string }))} items={Object.fromEntries(formats.map((f) => [f, f]))}>
            <SelectTrigger className="w-full cursor-pointer"><SelectValue /></SelectTrigger>
            <SelectContent>{formats.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
        </Row>
      )}
      {sets.length > 1 && (
        <Row label="Tile grid">
          <Select value={src?.matrixSet ?? ""} onValueChange={(v) => v && setChoice((c) => ({ ...c, matrixSet: v as string }))} items={Object.fromEntries(sets.map((s) => [s.set, `${s.set} (z${s.minzoom}–${s.maxzoom}${s.kind === "epsg3395" ? ", EPSG:3395" : ""})`]))}>
            <SelectTrigger className="w-full cursor-pointer"><SelectValue /></SelectTrigger>
            <SelectContent>{sets.map((s) => <SelectItem key={s.set} value={s.set}>{`${s.set} (z${s.minzoom}–${s.maxzoom}${s.kind === "epsg3395" ? ", EPSG:3395" : ""})`}</SelectItem>)}</SelectContent>
          </Select>
        </Row>
      )}
      {layer.dimensions.map((d) => (
        <Row key={d.identifier} label={d.identifier}>
          {d.values.length > 1 && d.values.length <= 60 && d.values.every((v) => !v.includes("/")) ? (
            <Select value={src?.dimensions[d.identifier] ?? ""} onValueChange={(v) => v && setChoice((c) => ({ ...c, dimensions: { ...c.dimensions, [d.identifier]: v as string } }))} items={Object.fromEntries(d.values.map((v) => [v, v]))}>
              <SelectTrigger className="w-full cursor-pointer"><SelectValue /></SelectTrigger>
              <SelectContent>{d.values.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <div className="min-w-0 space-y-0.5">
              <Input
                value={choice.dimensions?.[d.identifier] ?? src?.dimensions[d.identifier] ?? ""}
                placeholder={d.default ?? ""}
                onChange={(e) => setChoice((c) => ({ ...c, dimensions: { ...c.dimensions, [d.identifier]: e.target.value } }))}
                className="cursor-text h-8"
              />
              {d.values.length > 0 && <p className="text-[10px] text-muted-foreground break-all" title={d.values.join("\n")}>Available: {d.values.length > 3 ? `${d.values.slice(0, 2).join(", ")} … ${d.values.at(-1)}` : d.values.join(", ")}</p>}
            </div>
          )}
        </Row>
      ))}

      {src && (
        <div className="rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground space-y-0.5 min-w-0">
          <p>Zooms {src.minzoom}–{src.maxzoom} · {src.matrixSet} · {src.encoding === "rest" ? "RESTful" : "KVP"}{src.tileSize !== 256 ? ` · ${src.tileSize} px tiles` : ""}{src.kind === "epsg3395" ? " · EPSG:3395, resampled to Web Mercator" : ""}</p>
          <p className="break-all font-mono">{src.url}</p>
        </div>
      )}
      {built.error && <p className="text-sm text-red-500 break-words">{built.error}</p>}

      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Add as</Label>
          <SegmentedToggle value={role} onChange={onRoleChange} options={[{ value: "basemap" as const, label: "Basemap" }, { value: "overlay" as const, label: "Overlay" }]} />
        </div>
        <Button size="sm" className="cursor-pointer shrink-0" disabled={!src} onClick={save}>
          <Plus className="h-4 w-4" /> Add layer
        </Button>
      </div>
    </div>
  )
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-2 min-w-0">
    <Label className="text-xs truncate" title={label}>{label}</Label>
    <div className="min-w-0">{children}</div>
  </div>
)
