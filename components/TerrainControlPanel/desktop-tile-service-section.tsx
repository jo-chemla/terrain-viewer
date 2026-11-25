import type React from "react"
import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useDesktopTileService, setDesktopTileService, DESKTOP_TILE_SERVICE_PORT } from "@/lib/desktop-bridge"

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
  const address = `http://localhost:${t.port}`

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
      <p className="text-xs break-words" role="status">
        <span className="font-semibold">Status: </span>
        {!t.answered ? "asking the app…" : describe(t)}
      </p>
      {t.log && t.state === "error" && <p className="text-[11px] text-muted-foreground font-mono break-all">Log: {t.log}</p>}
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
