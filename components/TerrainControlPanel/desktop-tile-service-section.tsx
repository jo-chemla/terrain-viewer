import type React from "react"
import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useAtom } from "jotai"
import { Check, ChevronDown, Copy, ExternalLink } from "lucide-react"
import { isSettingsDesktopQuickstartOpenAtom } from "@/lib/settings-atoms"
import { useDesktopTileService, setDesktopTileService, DESKTOP_TILE_SERVICE_PORT } from "@/lib/desktop-bridge"
import { tileServiceBase, tileServiceQuickstart } from "@/lib/tile-service-quickstart"
import { cn } from "@/lib/utils"

/** Settings > Desktop: local tile service. Rendered by the settings dialog in
 *  the desktop app only (isDesktopApp): the tile service shipped inside the
 *  app, run on this computer for the QGIS plugin (Connect to
 *  http://localhost:3400) and any other XYZ client. Off by default; the main
 *  process keeps the setting and starts the service at launch when it was
 *  left on (desktop/src/bun/tile-service.ts). */
export const DesktopTileServiceSettings: React.FC = () => {
  const t = useDesktopTileService()
  const [port, setPort] = useState(String(t.port))
  useEffect(() => { setPort(String(t.port)) }, [t.port])
  const portNumber = Number(port)
  const portValid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535
  const busy = t.state === "starting" || t.state === "stopping"
  const address = tileServiceBase(t.port)
  const running = t.state === "running"
  const [quickstartOpen, setQuickstartOpen] = useAtom(isSettingsDesktopQuickstartOpenAtom)

  if (t.answered && !t.available) {
    return (
      <p className="text-xs text-muted-foreground">
        This build of the desktop app does not include the tile service. Install a build from 2026-11-25 or later.
      </p>
    )
  }
  return (
    <div className="space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <Label htmlFor="desktop-tile-service" className="text-sm font-normal min-w-0">Run the tile service on this computer</Label>
        <Switch
          id="desktop-tile-service"
          checked={t.enabled}
          disabled={!t.answered || busy}
          className="cursor-pointer shrink-0"
          onCheckedChange={(checked) => setDesktopTileService({ enabled: checked })}
        />
      </div>
      <p className="text-xs text-muted-foreground break-words">
        Serves the terrain modes as XYZ tiles on <span className="font-mono">{address}</span>, for the QGIS plugin
        (Terrain Viewer panel, address <span className="font-mono">{address}</span>, Connect) or any other map
        client. Flat, north-up tiles only, drawn on this computer; the elevation still comes from the online
        sources. Off by default; when on, it starts again with the app.
      </p>
      <div className="flex items-center gap-2 min-w-0">
        <Label htmlFor="desktop-tile-service-port" className="text-xs font-normal shrink-0">Port</Label>
        <Input
          id="desktop-tile-service-port"
          inputMode="numeric"
          value={port}
          className="h-8 w-24 font-mono text-xs"
          onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter" && portValid && portNumber !== t.port) setDesktopTileService({ port: portNumber }) }}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!t.answered || !portValid || portNumber === t.port || busy}
          onClick={() => setDesktopTileService({ port: portNumber })}
        >
          Apply
        </Button>
        {t.port !== DESKTOP_TILE_SERVICE_PORT && (
          <Button variant="ghost" size="sm" className="h-8" disabled={busy} onClick={() => setDesktopTileService({ port: DESKTOP_TILE_SERVICE_PORT })}>
            Default ({DESKTOP_TILE_SERVICE_PORT})
          </Button>
        )}
      </div>
      {!portValid && port !== "" && <p className="text-xs text-destructive">A port between 1024 and 65535.</p>}
      <p className="text-xs break-words flex items-center gap-1.5 min-w-0" role="status">
        <span
          aria-hidden
          className={cn(
            "inline-block h-2 w-2 rounded-full shrink-0",
            running ? "bg-green-500" : t.state === "error" ? "bg-red-500" : busy ? "bg-amber-500" : "bg-muted-foreground/50",
          )}
        />
        <span className="min-w-0"><span className="font-semibold">Status: </span>{!t.answered ? "asking the app…" : describe(t)}</span>
      </p>
      {t.log && t.state === "error" && <p className="text-[11px] text-muted-foreground font-mono break-all">Log: {t.log}</p>}
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold shrink-0">Endpoint</span>
          <code className="text-xs font-mono truncate min-w-0" title={address}>{address}</code>
          <CopyButton text={address} label="Copy the endpoint" />
          <a
            href={`${address}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn("inline-flex items-center gap-1 text-xs underline shrink-0", !running && "opacity-60")}
            title={running ? "The service's API reference (Scalar)" : "The API reference opens once the service runs"}
          >
            API reference <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
      <Collapsible open={quickstartOpen} onOpenChange={setQuickstartOpen} className="min-w-0">
        <CollapsibleTrigger className="flex items-center gap-1 text-xs font-semibold cursor-pointer text-left">
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !quickstartOpen && "-rotate-90")} />
          Quick start
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1.5 min-w-0">
        <ul className="space-y-1.5 min-w-0">
          {tileServiceQuickstart(address).map((q) => (
            <li key={q.url} className="min-w-0">
              <p className="text-xs break-words">{q.label} <span className="text-muted-foreground">· {q.hint}</span></p>
              <div className="flex items-center gap-1 min-w-0">
                <code className="text-[11px] font-mono text-muted-foreground truncate min-w-0" title={q.url}>{q.url}</code>
                <CopyButton text={q.url} label={`Copy: ${q.label}`} />
              </div>
            </li>
          ))}
        </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function describe(t: ReturnType<typeof useDesktopTileService>): string {
  switch (t.state) {
    case "running": return `running on ${t.url ?? `http://localhost:${t.port}`}${t.pid ? ` (process ${t.pid})` : ""}`
    case "starting": return "starting…"
    case "stopping": return "stopping…"
    case "error": return `stopped: ${t.message ?? "unknown error"}`
    default: return t.message ?? "stopped"
  }
}

/** Copies through the async Clipboard API, falling back to a hidden textarea
 *  and execCommand: the desktop app's views:// page may not count as a secure
 *  context for navigator.clipboard. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.setAttribute("readonly", "")
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

const CopyButton: React.FC<{ text: string; label: string }> = ({ text, label }) => {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 cursor-pointer"
      title={label}
      aria-label={label}
      onClick={() => { void copyText(text).then((ok) => { if (ok) setCopied(true) }) }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  )
}
