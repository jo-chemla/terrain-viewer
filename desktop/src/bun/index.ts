// Terrain Viewer as a desktop app: one window on the packaged Vite build.
// The main process does nothing else yet. Local COGs already open through the
// browser's own file picker inside the app (the cog-local source), so no
// native dialog bridge is needed for the offline case; online sources
// (Mapterhorn, basemaps, WMS) still need the network.
import { BrowserWindow, Utils, Updater } from "electrobun/main";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";

const mainWindow = new BrowserWindow({
  title: "Terrain Viewer",
  url: "views://app/index.html",
  frame: {
    width: 1400,
    height: 900,
    x: 100,
    y: 60,
  },
});

// Windows draws the generic icon in the title bar: Electrobun registers its
// window class without an icon and its setWindowIcon is a no-op there
// (nativeWrapper.cpp, 2026-10). The taskbar is fine, that comes from the
// exe. So the window gets WM_SETICON from here, through user32 over
// bun:ffi, with the .ico Hutch copies to Resources/app.ico. win.ptr is the
// HWND. Handles are kept for the window's lifetime on purpose.
const keptIcons: unknown[] = [];
function applyWindowIcon(win: BrowserWindow) {
  if (process.platform !== "win32") return;
  try {
    const hwnd = (win as unknown as { ptr?: unknown }).ptr;
    if (!hwnd) return;
    const ico = [join(dirname(process.execPath), "..", "Resources", "app.ico"), join(dirname(process.execPath), "..", "Resources", "app", "views", "app", "favicon.ico")].find((p) => existsSync(p));
    if (!ico) return;
    const user32 = dlopen("user32.dll", {
      LoadImageW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
      SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr], returns: FFIType.i64 },
    });
    const wide = Buffer.from(ico + "\0", "utf16le");
    const IMAGE_ICON = 1, LR_LOADFROMFILE = 0x10, LR_DEFAULTSIZE = 0x40, WM_SETICON = 0x80;
    const big = user32.symbols.LoadImageW(null, ptr(wide), IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE);
    const small = user32.symbols.LoadImageW(null, ptr(wide), IMAGE_ICON, 16, 16, LR_LOADFROMFILE);
    if (big) { user32.symbols.SendMessageW(hwnd as never, WM_SETICON, 1n, big); keptIcons.push(big); }
    if (small) { user32.symbols.SendMessageW(hwnd as never, WM_SETICON, 0n, small); keptIcons.push(small); }
  } catch (e) {
    console.warn("window icon:", e);
  }
}
applyWindowIcon(mainWindow);

// Updates, install-on-next-launch: the full build's config points
// release.baseUrl at the rolling GitHub Release (gen-config.mjs), where
// desktop.yml uploads stable-<platform>-update.json and the .tar.zst next
// to the installers. A launch checks the feed; a newer build is downloaded
// in the background and applied (the updater quits and relaunches) at the
// following launch, so nothing interrupts a session. The light build has
// no feed and skips this; the dev channel never reports updates.
// The launcher does not forward the main process's console, so updater
// lines also go to <channel root>/updater.log, readable after a failed apply.
const updaterLogPath = join(dirname(process.execPath), "..", "..", "updater.log");
function ulog(...parts: unknown[]) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}`;
  console.log("[updater]", line);
  try { appendFileSync(updaterLogPath, line + String.fromCharCode(10)); } catch {}
}

// Tells the page (lib/desktop-bridge.ts), which toasts the milestones and
// shows the state under the version in About. Every Electrobun status entry
// is forwarded as is (checking, update-available, download-progress,
// download-complete, applying, complete, no-update...), plus "ready" and
// "error" from the flow below. The last one is kept and replayed when the
// page asks (host-message "update-status"): the "complete" of a freshly
// applied update fires before the page has loaded.
type UpdateDetail = { status: string; version?: string; progress?: number; message?: string };
let lastUpdateDetail: UpdateDetail | null = null;
let feedVersion = "";
function announceUpdate(status: string, version?: string, extra: Partial<UpdateDetail> = {}) {
  const detail: UpdateDetail = { status, version: version || feedVersion || undefined, ...extra };
  lastUpdateDetail = detail;
  try {
    mainWindow.webview.executeJavascript(`window.dispatchEvent(new CustomEvent("tv-desktop-update", { detail: ${JSON.stringify(detail)} }))`);
  } catch (e) {
    console.warn("announce update:", e);
  }
}
async function updateOnLaunch() {
  try {
    const local = await Updater.getLocalInfo();
    if (!local.baseUrl || local.channel === "dev") { ulog("no feed (baseUrl empty) or dev channel"); return; }
    const info = await Updater.checkForUpdate();
    ulog("check", info);
    feedVersion = info.version ?? "";
    if (info.error) { announceUpdate("error", info.error); return; }
    if (info.updateReady) {
      // Apply at most once per downloaded build. If the apply helper fails
      // (the app quits, nothing comes back), the next launch must not quit
      // again four seconds in: it shows the toast instead, and "Restart now"
      // is the user's explicit retry.
      const dir = join(dirname(process.execPath), "..", "..");
      const marker = join(dir, "update-attempted.json");
      let attempted: string | null = null;
      try { attempted = JSON.parse(readFileSync(marker, "utf8")).hash ?? null; } catch {}
      if (attempted === info.hash) {
        ulog("apply of", info.hash, "already attempted once; not retrying automatically");
        announceUpdate("ready", info.version ?? "");
        return;
      }
      try { mkdirSync(dir, { recursive: true }); writeFileSync(marker, JSON.stringify({ hash: info.hash, at: new Date().toISOString() })); } catch (e) { ulog("marker error", String(e)); }
      ulog("applying", info.hash);
      await Updater.applyUpdate();
      ulog("applyUpdate returned");
      return;
    }
    if (info.updateAvailable) {
      await Updater.downloadUpdate();
      if (Updater.updateInfo().updateReady) announceUpdate("ready", info.version ?? "");
    }
  } catch (e) {
    ulog("update check failed", String(e));
    announceUpdate("error", String(e));
  }
}
Updater.onStatusChange((entry) => {
  ulog(entry.status, entry.message, entry.details ?? "");
  const d = (entry.details ?? {}) as { progress?: number; version?: string };
  announceUpdate(entry.status, d.version, { message: entry.message, progress: typeof d.progress === "number" ? d.progress : undefined });
});
// A beat after the window exists, so the page is there to receive the toast.
setTimeout(() => { void updateOnLaunch(); }, 4000);

// The light build ships no docs: its identifier ends in "-light"
// (desktop/gen-config.mjs), and views://app/docs/ holds only a stand-in.
// Read once from the bundle's own version.json.
const docsOnline = (() => {
  try { return String(JSON.parse(readFileSync(join(dirname(process.execPath), "..", "Resources", "version.json"), "utf8")).identifier ?? "").endsWith("-light"); } catch { return false; }
})();
const DOCS_SITE = "https://terrain-viewer.iconem.com/docs/";

// Links the app opens in a new tab (target="_blank"): the docs, when bundled
// (views://app/docs/), get their own window; anything on the web (GitHub,
// data providers, the online docs) goes to the system browser rather than
// replacing the map.
mainWindow.webview.on("new-window-open", (event: unknown) => {
  const detail = (event as { data?: { detail?: unknown } }).data?.detail;
  const url = typeof detail === "string" ? detail : (detail as { url?: string } | undefined)?.url;
  if (!url) return;
  if (url.startsWith("views://")) {
    const docsPath = url.match(/^views:\/\/app\/docs\/?(.*)$/)?.[1];
    if (docsOnline && docsPath !== undefined) { Utils.openExternal(DOCS_SITE + docsPath); return; }
    const w = new BrowserWindow({ title: "Terrain Viewer docs", url, frame: { width: 1100, height: 800, x: 140, y: 100 } });
    applyWindowIcon(w);
    // Links inside the bundled docs (GitHub, data providers) go to the browser too.
    w.webview.on("new-window-open", (ev: unknown) => {
      const d = (ev as { data?: { detail?: unknown } }).data?.detail;
      const u = typeof d === "string" ? d : (d as { url?: string } | undefined)?.url;
      if (u && /^https?:/.test(u)) Utils.openExternal(u);
    });
  } else if (/^https?:/.test(url)) {
    Utils.openExternal(url);
  }
});

// The app's fullscreen button uses the HTML Fullscreen API, which in WebView2
// only fills the webview; the window stays. The page reports every change
// through __electrobunSendToHost (FullscreenControlThemed.tsx) and the
// window follows.
mainWindow.webview.on("host-message", (event: unknown) => {
  const msg = (event as { data?: { detail?: unknown } }).data?.detail as { type?: string; on?: boolean } | undefined;
  if (msg?.type === "fullscreen") mainWindow.setFullScreen(!!msg.on);
  if (msg?.type === "apply-update") void Updater.applyUpdate();
  // The page has loaded (or wants a refresh): replay the latest state.
  if (msg?.type === "update-status" && lastUpdateDetail) {
    const { status, version, message, progress } = lastUpdateDetail;
    announceUpdate(status, version, { message, progress });
  }
});
