// Terrain Viewer as a desktop app: one window on the packaged Vite build.
// The main process does nothing else yet. Local COGs already open through the
// browser's own file picker inside the app (the cog-local source), so no
// native dialog bridge is needed for the offline case; online sources
// (Mapterhorn, basemaps, WMS) still need the network.
import { BrowserWindow, Utils, Updater } from "electrobun/main";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

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
async function updateOnLaunch() {
  try {
    const local = await Updater.getLocalInfo();
    if (!local.baseUrl || local.channel === "dev") return;
    const info = await Updater.checkForUpdate();
    if (info.updateReady) { await Updater.applyUpdate(); return; }
    if (info.updateAvailable) await Updater.downloadUpdate();
  } catch (e) {
    console.warn("update check:", e);
  }
}
void updateOnLaunch();

// Links the app opens in a new tab (target="_blank"): the docs, when bundled
// (views://app/docs/), get their own window; anything on the web (GitHub,
// data providers, the online docs) goes to the system browser rather than
// replacing the map.
mainWindow.webview.on("new-window-open", (event: unknown) => {
  const detail = (event as { data?: { detail?: unknown } }).data?.detail;
  const url = typeof detail === "string" ? detail : (detail as { url?: string } | undefined)?.url;
  if (!url) return;
  if (url.startsWith("views://")) {
    applyWindowIcon(new BrowserWindow({ title: "Terrain Viewer docs", url, frame: { width: 1100, height: 800, x: 140, y: 100 } }));
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
});
