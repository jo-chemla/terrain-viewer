// The page's half of the desktop (Electrobun) bridge. The main process
// (desktop/src/bun/index.ts) runs JavaScript in the page to report the
// updater's state; the page answers over __electrobunSendToHost, the same
// channel FullscreenControlThemed uses for fullscreen. In the browser none
// of this fires and `useDesktopUpdate()` stays at "idle".
import { useSyncExternalStore } from "react"
import { pushToast } from "@/components/ui/toast"
import { importProjectBytes } from "@/lib/project-export"
import { track } from "@/lib/analytics"

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

/** The update bundle's size: the variant's usual size at once ("about 37 MB"
 *  light, "about 220 MB" full), then the exact size of the platform's
 *  .tar.zst on the rolling release (desktop-latest or desktop-latest-light,
 *  the feed the updater reads) once GitHub's API answers. */
const RELEASES_API = "https://api.github.com/repos/Iconem/terrain-viewer/releases/tags/"
function roughSize(light: boolean | undefined): string { return light ? "about 37 MB" : "about 220 MB" }
async function exactSize(light: boolean | undefined, platform: string | undefined): Promise<string | null> {
  try {
    const res = await fetch(RELEASES_API + (light ? "desktop-latest-light" : "desktop-latest"), { headers: { accept: "application/vnd.github+json" } })
    if (!res.ok) return null
    const assets = ((await res.json()).assets ?? []) as Array<{ name: string; size: number }>
    const asset = assets.find((a) => a.name.endsWith(".tar.zst") && (!platform || a.name.includes(`-${platform}-`)))
    if (!asset) return null
    const mb = asset.size / 1e6
    return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(0)} MB`
  } catch { return null }
}

export function initDesktopBridge(): void {
  window.addEventListener("tv-desktop-update", (ev) => {
    const detail = (ev as CustomEvent<{ version?: string; status?: string; progress?: number; message?: string; light?: boolean; platform?: string }>).detail ?? {}
    const next = fold(detail)
    if (!next) return
    const was = current.status
    set(next)
    if (next.status === was && next.status !== "error") return
    const v = next.version ? `Terrain Viewer ${next.version}` : "A new Terrain Viewer build"
    if (next.status === "available") {
      const body = (size: string) => `${v} is downloading in the background (${size}, a few minutes). It installs at the next launch: the app then restarts itself once, which takes about half a minute. Progress shows under About.`
      pushToast({ key: "desktop-update", title: "Update available", body: body(roughSize(detail.light)), duration: 15000 })
      void exactSize(detail.light, detail.platform).then((size) => {
        if (size && current.status === "available") pushToast({ key: "desktop-update", title: "Update available", body: body(size), duration: 15000 })
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
  initOpenFile()
}

// A file on the desktop app's command line (launcher.exe C:\path\project.json,
// a .zip project export or a plain sources list): the main process reads it
// and, when the page asks ("open-file-request", here at load), dispatches
// "tv-desktop-open-file" with { name, bytesBase64 }, or { name, error } when
// it cannot send it (too large, unreadable). The main process answers once,
// so the reload after the import does not import again. The import is the
// Import button's (importProjectBytes); its toast is kept in sessionStorage
// across the reload.
const OPEN_FILE_TOAST_KEY = "tv-desktop-open-file-toast"
function initOpenFile(): void {
  try {
    const pending = sessionStorage.getItem(OPEN_FILE_TOAST_KEY)
    if (pending) {
      sessionStorage.removeItem(OPEN_FILE_TOAST_KEY)
      const { title, body } = JSON.parse(pending) as { title: string; body?: string }
      pushToast({ key: "desktop-open-file", title, body, duration: 10000 })
    }
  } catch { /* storage off or a stale entry */ }
  window.addEventListener("tv-desktop-open-file", (ev) => {
    const { name = "file", bytesBase64, error } = (ev as CustomEvent<{ name?: string; bytesBase64?: string; error?: string }>).detail ?? {}
    const fail = (message: string) => pushToast({ key: "desktop-open-file", title: `Could not open ${name}`, body: message, tone: "alert", duration: 15000 })
    if (error || !bytesBase64) { fail(error ?? "No content was received."); return }
    let bytes: Uint8Array
    try {
      const binary = atob(bytesBase64)
      bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    } catch { fail("The content did not decode."); return }
    void importProjectBytes(name, bytes).then((result) => {
      if (!result.ok) { fail(result.error); return }
      track("actions-project", { action: "import", via: "command-line" })
      const title = result.kind === "project" ? `Project ${name} imported` : `Sources from ${name} imported`
      try { sessionStorage.setItem(OPEN_FILE_TOAST_KEY, JSON.stringify({ title, body: result.note })) } catch { /* toast lost, import kept */ }
      // The project's view state goes over the current URL's parameters
      // (those of a query also given on the command line), the merge the
      // Import button's setState does.
      const url = new URL(window.location.href)
      if (result.viewState) for (const [k, v] of new URLSearchParams(result.viewState)) url.searchParams.set(k, v)
      window.history.replaceState(window.history.state, "", url)
      window.location.reload()
    }, (e) => fail(String(e)))
  })
  const ask = () => hostSend()?.({ type: "open-file-request" })
  ask()
  setTimeout(ask, 3000)
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
