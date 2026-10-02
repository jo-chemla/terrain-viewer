// The page's half of the desktop (Electrobun) bridge. The main process
// (desktop/src/bun/index.ts) runs JavaScript in the page to announce an
// update it has downloaded; the page answers over __electrobunSendToHost,
// the same channel FullscreenControlThemed uses for fullscreen. In the
// browser none of this fires.
import { pushToast } from "@/components/ui/toast"

type HostSend = (message: unknown) => void
const hostSend = (): HostSend | undefined => (window as unknown as { __electrobunSendToHost?: HostSend }).__electrobunSendToHost

export function initDesktopBridge(): void {
  window.addEventListener("tv-desktop-update", (ev) => {
    const detail = (ev as CustomEvent<{ version?: string; status?: string }>).detail ?? {}
    if (detail.status === "ready") {
      pushToast({
        key: "desktop-update",
        title: "Update downloaded",
        body: `Terrain Viewer ${detail.version ?? ""} is ready. It installs at the next launch, or now.`.replace("  ", " "),
        duration: 20000,
        action: { label: "Restart now", onClick: () => hostSend()?.({ type: "apply-update" }) },
      })
    } else if (detail.status === "error") {
      pushToast({ key: "desktop-update", title: "Update check failed", body: detail.version ?? "", duration: 8000 })
    }
  })
}
