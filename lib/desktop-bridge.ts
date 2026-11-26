// The page's half of the desktop (Electrobun) bridge. The main process
// (desktop/src/bun/index.ts) runs JavaScript in the page to report the
// updater's state; the page answers over __electrobunSendToHost, the same
// channel FullscreenControlThemed uses for fullscreen. In the browser none
// of this fires and `useDesktopUpdate()` stays at "idle".
import { createElement, useSyncExternalStore } from "react"
import { pushToast } from "@/components/ui/toast"
import { DesktopUpdateProgress } from "@/components/DesktopUpdateProgress"
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
  /** Seconds left while downloading, from the rate so far (none at first). */
  eta?: number
  message?: string
  /** The light build (docs online), whose feed is desktop-latest-light. */
  light?: boolean
  /** When the "up to date" answer was given (ISO): it is as old as the check. */
  checkedAt?: string
  /** The commit the feed's build comes from (its release notes): the version
   *  is the build day, so two builds of a day share it. */
  commit?: string
  /** The feed's download size, "67 MB". */
  size?: string
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

/** Asks the main process to check the feed now (desktop/src/bun/index.ts,
 *  host-message "check-update"): a newer build is downloaded and reported as
 *  "ready"; one already downloaded is reported as "ready" at once. */
let manualCheck = false
export function checkDesktopUpdate(): void {
  manualCheck = true
  hostSend()?.({ type: "check-update" })
}

/** Installs the downloaded update: the app quits, the updater swaps the
 *  bundle and starts it again (about half a minute). */
export function applyDesktopUpdate(): void {
  hostSend()?.({ type: "apply-update" })
}

/** "2026.11.25 (2ba6460)": the day alone does not tell two builds apart. */
export function desktopUpdateLabel(u: DesktopUpdate): string {
  return [u.version, u.commit ? `(${u.commit})` : ""].filter(Boolean).join(" ")
}

/** "about 2 min left", "a few seconds left". */
export function formatEta(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return ""
  if (seconds < 10) return "a few seconds left"
  if (seconds < 60) return `about ${Math.round(seconds / 5) * 5} s left`
  return `about ${Math.round(seconds / 60)} min left`
}

/** One line for the About section, or null outside the desktop app. */
export function describeDesktopUpdate(u: DesktopUpdate): string | null {
  const label = desktopUpdateLabel(u)
  const v = label ? ` ${label}` : ""
  switch (u.status) {
    case "idle": return null
    case "checking": return "Update: checking…"
    case "up-to-date": {
      const at = u.checkedAt ? new Date(u.checkedAt) : null
      return `Update: up to date${at && !Number.isNaN(at.getTime()) ? ` (checked at ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : ""}`
    }
    case "available": return `Update: ${v.trim() || "a new build"} available, starting the download…`
    case "downloading": return [`Update:${v} downloading…`, u.progress != null ? `${Math.round(u.progress)}%` : "", formatEta(u.eta)].filter(Boolean).join(" ")
    case "ready": return `Update:${v} downloaded, installs at the next launch`
    case "applying": return `Update:${v} installing, the app restarts…`
    case "installed": return `Update:${v} installed at this launch`
    case "error": return `Update check failed${u.message ? `: ${u.message}` : ""}`
  }
}

// Electrobun's status names (desktop/src/bun/index.ts forwards them as is)
// folded into the page's states.
type UpdateEvent = { status?: string; version?: string; progress?: number; message?: string; checkedAt?: string; bytes?: number; total?: number }
// The download's first sample, for the rate: bytes when the updater gives
// them, else the percentage.
let dlStart: { t: number; at: number } | null = null
function etaOf(progress: number | undefined, bytes: number | undefined, total: number | undefined): number | undefined {
  const at = bytes != null && total ? bytes : progress
  const end = bytes != null && total ? total : 100
  if (at == null) return current.eta
  const now = performance.now()
  if (!dlStart || at < dlStart.at) { dlStart = { t: now, at }; return undefined }
  const seconds = (now - dlStart.t) / 1000
  if (seconds < 1.5 || at <= dlStart.at) return current.eta
  return (end - at) / ((at - dlStart.at) / seconds)
}
function fold(detail: UpdateEvent): DesktopUpdate | null {
  const { status, version, progress, message, checkedAt, bytes, total } = detail
  switch (status) {
    // "installed" (this launch applied an update) stays shown over the
    // launch's own re-check, but not over one asked from About.
    case "checking": return current.status === "installed" && !manualCheck ? null : { status: "checking", version }
    case "no-update": return current.status === "installed" && !manualCheck ? null : { status: "up-to-date", version, checkedAt }
    case "update-available": dlStart = null; return { status: "available", version }
    case "download-starting": case "download-progress": case "checking-local-tar": case "local-tar-found":
    case "fetching-patch": case "patch-not-found": case "downloading-full-bundle": case "applying-patch":
      return { status: "downloading", version, progress: progress ?? current.progress, eta: status === "download-progress" ? etaOf(progress, bytes, total) : current.eta }
    case "decompressing": return { status: "downloading", version, progress: 100, message }
    // A "ready" may carry why the previous install did not finish.
    case "download-complete": case "ready": return { status: "ready", version, message: status === "ready" ? message : undefined }
    case "applying": case "launching-new-version": return { status: "applying", version }
    case "complete": return { status: "installed", version }
    // The reason: the updater's own message (a failed swap reports the feed
    // version too, which used to win and read "Update check failed:
    // 2026.11.25"), else the flow's, which arrives in the version slot.
    case "error": return { status: "error", version, message: message ?? version }
    default: return null
  }
}

/** The update bundle's size: the variant's usual size at once ("about 67 MB"
 *  light, "about 250 MB" full), then the exact size of the platform's
 *  .tar.zst on the rolling release (desktop-latest or desktop-latest-light,
 *  the feed the updater reads) once GitHub's API answers. */
const RELEASES_API = "https://api.github.com/repos/Iconem/terrain-viewer/releases/tags/"
function roughSize(light: boolean | undefined): string { return light ? "about 67 MB" : "about 250 MB" }
/** The feed's release: the bundle's size and the commit its notes name
 *  ("built on 2026-11-25 from `2ba6460`"). Never from the HTTP cache: a
 *  cached answer named the previous build. */
async function feedRelease(light: boolean | undefined, platform: string | undefined): Promise<{ size: string | null; commit: string | null }> {
  try {
    const res = await fetch(RELEASES_API + (light ? "desktop-latest-light" : "desktop-latest"), { headers: { accept: "application/vnd.github+json" }, cache: "no-store" })
    if (!res.ok) return { size: null, commit: null }
    const rel = await res.json()
    const commit = /from `([0-9a-f]{7,})`/.exec(String(rel.body ?? ""))?.[1]?.slice(0, 7) ?? null
    const assets = (rel.assets ?? []) as Array<{ name: string; size: number }>
    const asset = assets.find((a) => a.name.endsWith(".tar.zst") && (!platform || a.name.includes(`-${platform}-`)))
    const mb = asset ? asset.size / 1e6 : 0
    return { size: asset ? `${Math.round(mb)} MB` : null, commit }
  } catch { return { size: null, commit: null } }
}

// The toasts: one key, "desktop-update". While the bundle downloads it stays
// up (no timer) with a progress bar, the percentage and the time left
// (components/DesktopUpdateProgress.tsx reads the store), until the
// download ends, when "Update downloaded" with Restart and install replaces
// it, or until its × dismisses it.
function progressToast(): void {
  pushToast({ key: "desktop-update", title: "Update available", body: createElement(DesktopUpdateProgress), duration: Infinity })
}

let releaseAskedFor: string | null = null
export function initDesktopBridge(): void {
  window.addEventListener("tv-desktop-update", (ev) => {
    const detail = (ev as CustomEvent<UpdateEvent & { light?: boolean; platform?: string }>).detail ?? {}
    const folded = fold(detail)
    if (!folded) return
    const light = detail.light ?? current.light
    // The feed's commit and size, fetched once per feed version.
    const sameFeed = !!folded.version && folded.version === current.version
    const next: DesktopUpdate = { ...folded, light, commit: sameFeed ? current.commit : undefined, size: sameFeed ? current.size : undefined }
    if (next.status === "up-to-date" || next.status === "ready" || next.status === "error") manualCheck = false
    const was = current.status
    set(next)
    if ((next.status === "available" || next.status === "downloading" || next.status === "ready") && releaseAskedFor !== (next.version ?? "")) {
      const asked = next.version
      releaseAskedFor = asked ?? ""
      void feedRelease(light, detail.platform).then(({ size, commit }) => {
        if (current.version === asked) set({ ...current, size: size ?? current.size, commit: commit ?? current.commit })
      })
    }
    if (next.status === was && next.status !== "error") return
    const label = desktopUpdateLabel(next)
    const v = label ? `Terrain Viewer ${label}` : "A new Terrain Viewer build"
    if (next.status === "available" || (next.status === "downloading" && was !== "available")) {
      if (!next.size) set({ ...current, size: roughSize(light) })
      progressToast()
    } else if (next.status === "ready") {
      pushToast({
        key: "desktop-update",
        title: "Update downloaded",
        body: `${next.message ? `The last install did not finish (${next.message}). ` : ""}${v} is ready. Restart and install now (about half a minute, the app restarts itself), or it installs at the next launch. Also under About.`,
        duration: Infinity,
        action: { label: "Restart and install", onClick: applyDesktopUpdate },
      })
    } else if (next.status === "installed") {
      pushToast({ key: "desktop-update", title: "Updated", body: `${v} was installed at this launch.`, duration: 8000 })
    } else if (next.status === "error") {
      pushToast({ key: "desktop-update", tone: "alert", title: "Update check failed", body: next.message ?? "", duration: 8000 })
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
  initTileService()
}

// A file on the desktop app's command line (launcher.exe C:\path\project.json,
// a .zip project export or a plain sources list): when the page asks
// ("open-file-request", here at load), the main process places the file
// under the app's own scheme and dispatches "tv-desktop-open-file" with
// { name, url, size }, or { name, error } when it cannot (missing,
// unreadable). The page fetches the URL as bytes, as the Import button reads
// a File, so any size goes, then tells the main process to remove the copy
// ("open-file-done"). The main process answers once, so the reload after
// the import does not import again. The import is the Import button's
// (importProjectBytes); its toast is kept in sessionStorage across the reload.
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
    const { name = "file", url, error } = (ev as CustomEvent<{ name?: string; url?: string; size?: number; error?: string }>).detail ?? {}
    const fail = (message: string) => pushToast({ key: "desktop-open-file", title: `Could not open ${name}`, body: message, tone: "alert", duration: 15000 })
    if (error || !url) { fail(error ?? "No file was received."); return }
    void (async () => {
      let bytes: Uint8Array
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`The app could not read it back (${res.status}).`)
        bytes = new Uint8Array(await res.arrayBuffer())
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e))
        return
      } finally {
        hostSend()?.({ type: "open-file-done" })
      }
      const result = await importProjectBytes(name, bytes)
      if (!result.ok) { fail(result.error); return }
      track("actions-project", { action: "import", via: "command-line" })
      const title = result.kind === "project" ? `Project ${name} imported` : `Sources from ${name} imported`
      try { sessionStorage.setItem(OPEN_FILE_TOAST_KEY, JSON.stringify({ title, body: result.note })) } catch { /* toast lost, import kept */ }
      // The project's view state goes over the current URL's parameters
      // (those of a query also given on the command line), the merge the
      // Import button's setState does.
      const next = new URL(window.location.href)
      if (result.viewState) for (const [k, v] of new URLSearchParams(result.viewState)) next.searchParams.set(k, v)
      window.history.replaceState(window.history.state, "", next)
      window.location.reload()
    })().catch((e) => fail(String(e)))
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

/** Whether the page runs inside the desktop app: it loads the bundle over its
 *  own scheme (views://), never http(s). */
export const isDesktopApp = typeof location !== "undefined" && !/^https?:$/.test(location.protocol)

// The desktop app's local tile service (desktop/src/bun/tile-service.ts):
// the tile service shipped inside the app, run on this computer on a fixed
// port (3400 by default) for the QGIS plugin and other clients. Off by
// default; the setting lives in the main process (it starts the service at
// launch when it was left on), which reports every change as a
// "tv-desktop-tile-service" event. The page sends "tile-service-status" to
// ask and "tile-service-set" to change it. Settings > Desktop: local tile
// service shows it, in the desktop app only.
export type DesktopTileServiceState = "stopped" | "starting" | "running" | "stopping" | "error"
export interface DesktopTileService {
  /** False until the main process answered, or when the build ships no tile service. */
  available: boolean
  enabled: boolean
  port: number
  state: DesktopTileServiceState
  url?: string
  message?: string
  pid?: number
  log?: string
}
export const DESKTOP_TILE_SERVICE_PORT = 3400
let tileService: DesktopTileService = { available: false, enabled: false, port: DESKTOP_TILE_SERVICE_PORT, state: "stopped" }
const tileServiceListeners = new Set<() => void>()
const subscribeTileService = (l: () => void) => { tileServiceListeners.add(l); return () => { tileServiceListeners.delete(l) } }
const getTileService = () => tileService
let tileServiceAnswered = false

export function useDesktopTileService(): DesktopTileService & { answered: boolean } {
  const t = useSyncExternalStore(subscribeTileService, getTileService, getTileService)
  return { ...t, answered: tileServiceAnswered }
}

/** Turns the service on or off, or moves it to another port (restarted if running). */
export function setDesktopTileService(next: { enabled?: boolean; port?: number }): void {
  hostSend()?.({ type: "tile-service-set", ...next })
}

function initTileService(): void {
  window.addEventListener("tv-desktop-tile-service", (ev) => {
    const detail = (ev as CustomEvent<Partial<DesktopTileService>>).detail ?? {}
    const was = tileService
    tileServiceAnswered = true
    tileService = { ...tileService, ...detail, url: detail.url, message: detail.message, pid: detail.pid }
    for (const l of tileServiceListeners) l()
    if (was.state !== "error" && tileService.state === "error") {
      pushToast({ key: "desktop-tile-service", tone: "alert", title: "Local tile service stopped", body: tileService.message ?? "", duration: 10000 })
    }
  })
  const ask = () => hostSend()?.({ type: "tile-service-status" })
  ask()
  setTimeout(ask, 3000)
}
