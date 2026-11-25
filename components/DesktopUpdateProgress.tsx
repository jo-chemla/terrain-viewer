import type React from "react"
import { Loader2 } from "lucide-react"
import { useDesktopUpdate, desktopUpdateLabel, formatEta } from "@/lib/desktop-bridge"

/** The body of the desktop app's "Update available" toast (pushed by
 *  lib/desktop-bridge.ts, kept up while the bundle downloads): a progress
 *  bar with the percentage and the time left, or a spinner until the
 *  updater reports a percentage. */
export const DesktopUpdateProgress: React.FC = () => {
  const u = useDesktopUpdate()
  const label = desktopUpdateLabel(u)
  const name = label ? `Terrain Viewer ${label}` : "A new Terrain Viewer build"
  const pct = u.progress != null ? Math.max(0, Math.min(100, u.progress)) : null
  const preparing = u.status === "downloading" && pct === 100
  return (
    <div className="space-y-1.5 min-w-0">
      <p className="break-words">
        {name} is downloading{u.size ? ` (${u.size})` : ""}. It installs when you restart, or at the next launch.
      </p>
      {pct == null ? (
        <p className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin shrink-0" /> Starting the download…</p>
      ) : (
        <>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Update download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="flex items-center justify-between gap-2 font-mono text-[11px] tabular-nums">
            <span>{Math.round(pct)}%</span>
            <span>{preparing ? "unpacking…" : formatEta(u.eta)}</span>
          </p>
        </>
      )}
    </div>
  )
}
