import type React from "react"
import { useEffect, useRef, useState } from "react"
import { Loader2, Sparkles, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { detectFromUrl, detectByFetching, type DetectTarget, type DetectedSource } from "@/lib/source-url-detect"

/** The "Auto" type of the Add Basemap and Add Terrain dialogs: one URL field.
 *  A pasted URL is recognised by its shape at once, or by its response when
 *  the shape says nothing; the dialog then switches to the matching type with
 *  the URL in its field (onDetected). */
export const SourceUrlAutoPanel: React.FC<{
  target: DetectTarget
  onDetected: (d: DetectedSource) => void
  /** A URL handed over by the other dialog: detected at once. */
  initialUrl?: string
  /** Terrain only: open Add Basemap on this URL instead. */
  onSwitchToBasemap?: (url: string) => void
}> = ({ target, onDetected, initialUrl, onSwitchToBasemap }) => {
  const [url, setUrl] = useState(initialUrl ?? "")
  const [probing, setProbing] = useState(false)
  const [unknown, setUnknown] = useState(false)
  // Recognised, but not something this dialog adds.
  const [refused, setRefused] = useState<DetectedSource | null>(null)
  const accept = (d: DetectedSource) => { if (d.type === "unsupported") setRefused(d); else onDetected(d) }
  const ctrlRef = useRef<AbortController | null>(null)

  useEffect(() => {
    ctrlRef.current?.abort()
    setUnknown(false)
    setRefused(null)
    setProbing(false)
    const u = url.trim()
    if (!u) return
    const found = detectFromUrl(u, target)
    if (found) { accept(found); return }
    if (!/^https?:\/\/[^/]+\.[^/]+/i.test(u)) return
    // Nothing in the URL itself: read the response once typing pauses.
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    const t = setTimeout(() => {
      setProbing(true)
      detectByFetching(u, target, ctrl.signal).then((d) => {
        if (ctrl.signal.aborted) return
        setProbing(false)
        if (d) accept(d)
        else setUnknown(true)
      })
    }, 600)
    return () => { clearTimeout(t); ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, target])

  return (
    <div className="space-y-2">
      <Label htmlFor={`${target}-auto-url`}>URL</Label>
      <div className="relative">
        <Input
          id={`${target}-auto-url`}
          autoFocus
          type="text"
          placeholder="Paste any URL: tiles, WMS, COG, STAC, Allmaps, IIIF, TileJSON…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="cursor-text pr-7"
        />
        {probing && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-xs text-muted-foreground">
        {refused
          ? <><span className="font-medium text-foreground">{refused.label}.</span> {refused.note}{onSwitchToBasemap && <> <button type="button" className="underline text-foreground hover:opacity-80 cursor-pointer" onClick={() => onSwitchToBasemap(refused.url)}>Open Add Basemap with it</button></>}</>
          : unknown
          ? "Not recognised (or the server does not allow it to be read from here): pick the type above."
          : <>Recognised: {"{z}/{x}/{y}"} tile templates, {"{bbox-epsg-3857}"} and WMS GetMap or GetCapabilities, WMTS, ArcGIS MapServer and ImageServer, COG and VRT files, PMTiles, TileJSON, STAC catalogs and APIs, {target === "basemap" ? "Allmaps annotations and IIIF manifests or images" : "LERC tiles"}. The type then switches with the URL filled in.</>}
      </p>
    </div>
  )
}

/** Above the URL field once Auto has switched the type: what was recognised. */
export const DetectedNote: React.FC<{ detected: DetectedSource | null; onDismiss: () => void; onBack: () => void }> = ({ detected, onDismiss, onBack }) => {
  if (!detected) return null
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs">
      <Sparkles className="h-3.5 w-3.5 mt-px shrink-0 text-primary" />
      <div className="flex-1 min-w-0">
        <span className="font-medium">Detected: {detected.label}.</span>{" "}
        {detected.note && <span className="text-muted-foreground">{detected.note} </span>}
        <button type="button" className="underline text-muted-foreground hover:text-foreground cursor-pointer" onClick={onBack}>Back to Auto</button>
      </div>
      <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer" title="Hide" onClick={onDismiss}><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}
