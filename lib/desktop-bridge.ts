// The page's half of the desktop (Electrobun) bridge. The main process
// (desktop/src/bun/index.ts) runs JavaScript in the page to report the
// updater's state; the page answers over __electrobunSendToHost, the same
// channel FullscreenControlThemed uses for fullscreen. In the browser none
// of this fires and `useDesktopUpdate()` stays at "idle".
import { useSyncExternalStore } from "react"
import { pushToast } from "@/components/ui/toast"

type HostSend = (message: unknown) => void
const hostSend = (): HostSend | undefined => (window as unknown as { __electrobunSendToHost?: HostSend }).__electrobunSendToHost

/** The updater's state as the About section shows it. "installed" is the
 *  first launch on a build the updater put in place. */
export type DesktopUpdateStatus =
  | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "applying" | "installed" | "error"
export interface DesktopUpdate {
  status: DesktopUpdateStatus
  version?: string
  /** 0-100 while downloading. */
  progress?: number
  message?: string
}

let current: DesktopUpdate = { status: "idle" }
const listeners = new Set<() => void>()
function set(next: DesktopUpdate) {
  current = next
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const getSnapshot = () => current
const IDLE: DesktopUpdate = { status: "idle" }
const getServerSnapshot = () => IDLE

export function useDesktopUpdate(): DesktopUpdate {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** One line for the About section, or null outside the desktop app. */
export function describeDesktopUpdate(u: DesktopUpdate): string | null {
  const v = u.version ? ` ${u.version}` : ""
  switch (u.status) {
    case "idle": return null
    case "checking": return "Update: checking…"
    case "up-to-date": return "Update: up to date"
    case "available": return `Update: ${v.trim() || "a new build"} available, starting the download…`
    case "downloading": return `Update:${v} downloading… ${u.progress != null ? `${Math.round(u.progress)}%` : ""}`.trimEnd()
    case "ready": return `Update:${v} downloaded, installs at the next launch`
    case "applying": return `Update:${v} installing, the app restarts…`
    case "installed": return `Update:${v} installed at this launch`
    case "error": return `Update check failed${u.message ? `: ${u.message}` : ""}`
  }
}

// Electrobun's status names (desktop/src/bun/index.ts forwards them as is)
// folded into the page's states.
function fold(detail: { status?: string; version?: string; progress?: number; message?: string }): DesktopUpdate | null {
  const { status, version, progress, message } = detail
  switch (status) {
    case "checking": return current.status === "installed" ? null : { status: "checking", version }
    case "no-update": return current.status === "installed" ? null : { status: "up-to-date", version }
    case "update-available": return { status: "available", version }
    case "download-starting": case "download-progress": case "checking-local-tar": case "local-tar-found":
    case "fetching-patch": case "patch-not-found": case "downloading-full-bundle": case "applying-patch":
      return { status: "downloading", version, progress: progress ?? current.progress }
    case "decompressing": return { status: "downloading", version, progress: 100, message }
    case "download-complete": case "ready": return { status: "ready", version }
    case "applying": case "launching-new-version": return { status: "applying", version }
    case "complete": return { status: "installed", version }
    case "error": return { status: "error", version, message: version ?? message }
    default: return null
  }
}

export function initDesktopBridge(): void {
  window.addEventListener("tv-desktop-update", (ev) => {
    const detail = (ev as CustomEvent<{ version?: string; status?: string; progress?: number; message?: string }>).detail ?? {}
    const next = fold(detail)
    if (!next) return
    const was = current.status
    set(next)
    if (next.status === was && next.status !== "error") return
    const v = next.version ? `Terrain Viewer ${next.version}` : "A new Terrain Viewer build"
    if (next.status === "available") {
      pushToast({
        key: "desktop-update",
        title: "Update available",
        body: `${v} is downloading in the background (about 220 MB, a few minutes). It installs at the next launch: the app then restarts itself once, which takes about half a minute. Progress shows under About.`,
        duration: 15000,
      })
    } else if (next.status === "ready") {
      pushToast({
        key: "desktop-update",
        title: "Update downloaded",
        body: `${v} is ready. It installs at the next launch, or now; installing takes about half a minute, during which the app restarts itself.`,
        duration: 20000,
        action: { label: "Restart now", onClick: () => hostSend()?.({ type: "apply-update" }) },
      })
    } else if (next.status === "installed") {
      pushToast({ key: "desktop-update", title: "Updated", body: `${v} was installed at this launch.`, duration: 8000 })
    } else if (next.status === "error") {
      pushToast({ key: "desktop-update", title: "Update check failed", body: next.message ?? "", duration: 8000 })
    }
  })
  // Ask for the state the main process reached before the page loaded (the
  // "complete" of a just-applied update fires early). The host channel may
  // not be there yet on the very first tick.
  const ask = () => hostSend()?.({ type: "update-status" })
  ask()
  setTimeout(ask, 3000)
  routeNewWindowsThroughHost()
}

// On Windows, Electrobun 2.0.2's WebView2 wrapper has no handler for the
// webview's new-window request: window.open and target="_blank" links open
// WebView2's own bare popup window, and the main process's "new-window-open"
// event (what sends links to the system browser, and the bundled docs to
// their own window) never fires. So the page routes them itself over the
// host-message channel; desktop/src/bun/index.ts opens them. Decided per
// call, since the host channel appears with the preload.
function routeNewWindowsThroughHost(): void {
  const resolve = (u: unknown): string | null => {
    if (u == null || u === "") return null
    try { return new URL(String(u), window.location.href).href } catch { return null }
  }
  const openViaHost = (u: unknown): boolean => {
    const send = hostSend()
    const url = resolve(u)
    if (!send || !url) return false
    send({ type: "open-external", url })
    return true
  }
  const originalOpen = window.open.bind(window)
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    if ((!target || target === "_blank") && openViaHost(url)) return null
    return originalOpen(url, target, features)
  }) as typeof window.open
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!a || a.target !== "_blank") return
    if (openViaHost(a.href)) e.preventDefault()
  }, true)
}
