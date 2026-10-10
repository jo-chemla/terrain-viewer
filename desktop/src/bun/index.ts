// Terrain Viewer as a desktop app: one window on the packaged Vite build.
// The main process does nothing else yet. Local COGs already open through the
// browser's own file picker inside the app (the cog-local source), so no
// native dialog bridge is needed for the offline case; online sources
// (Mapterhorn, basemaps, WMS) still need the network.
import { BrowserWindow, Utils, Updater } from "electrobun/main";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";

// Windows groups and pins windows by AppUserModelID. The window belongs to
// the runtime process (cottontail.exe, the process that owns the HWND), so
// pinning the running app pinned cottontail.exe, which run on its own only
// prints its usage. The fix is the same id on the process (set before any
// window exists) and on the Start menu and Desktop shortcuts that target
// launcher.exe: the shell then pins the shortcut. The shortcuts come from
// the installer without the property, so a PowerShell script writes it once
// per install (System.AppUserModel.ID on the .lnk, through IPropertyStore),
// started with ShellExecuteW since the runtime has no child_process.
// The id is <identifier>.<channel> from the install path
// (%LOCALAPPDATA%\com.iconem.terrain-viewer-light\stable\app\bin).
const channelRoot = join(dirname(process.execPath), "..", "..");
const appUserModelId = `${basename(dirname(channelRoot))}.${basename(channelRoot)}`;
const SET_AUMID_PS1 = String.raw`param([string]$Launcher, [string]$Id, [string]$Marker)
$code = @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
public class ShellLinkCo {}
[StructLayout(LayoutKind.Sequential)]
public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
[StructLayout(LayoutKind.Explicit, Size = 24)]
public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int GetAt(uint i, out PROPERTYKEY key);
  [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
  [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
  [PreserveSig] int Commit();
}
public static class Aumid {
  public static int Set(string lnk, string id) {
    var link = new ShellLinkCo();
    var file = (IPersistFile)link;
    file.Load(lnk, 2);
    var store = (IPropertyStore)link;
    var key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    var v = new PROPVARIANT { vt = 31, p = Marshal.StringToCoTaskMemUni(id) };
    int hr = store.SetValue(ref key, ref v);
    if (hr == 0) hr = store.Commit();
    Marshal.FreeCoTaskMem(v.p);
    if (hr == 0) file.Save(lnk, true);
    return hr;
  }
}
"@
Add-Type -TypeDefinition $code
$sh = New-Object -ComObject WScript.Shell
$done = 0
foreach ($d in @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:USERPROFILE\Desktop", "$env:PUBLIC\Desktop")) {
  if (-not (Test-Path $d)) { continue }
  foreach ($f in Get-ChildItem -Path $d -Filter *.lnk -ErrorAction SilentlyContinue) {
    try { $l = $sh.CreateShortcut($f.FullName); if ($l.TargetPath -ieq $Launcher) { if ([Aumid]::Set($f.FullName, $Id) -eq 0) { $done++ } } } catch {}
  }
}
if ($done -gt 0) { Set-Content -Path $Marker -Value ("{0} shortcut(s) {1}" -f $done, (Get-Date -Format o)) }
`;
function applyAppUserModelId() {
  if (process.platform !== "win32") return;
  try {
    const shell32 = dlopen("shell32.dll", {
      SetCurrentProcessExplicitAppUserModelID: { args: [FFIType.ptr], returns: FFIType.i32 },
      ShellExecuteW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.ptr },
    });
    const kept: Buffer[] = [];
    const wide = (text: string) => { const b = Buffer.from(text + "\0", "utf16le"); kept.push(b); return ptr(b); };
    shell32.symbols.SetCurrentProcessExplicitAppUserModelID(wide(appUserModelId));
    const marker = join(channelRoot, "aumid-shortcuts.txt");
    if (!existsSync(marker)) {
      const script = join(channelRoot, "set-aumid.ps1");
      writeFileSync(script, SET_AUMID_PS1);
      const launcher = join(dirname(process.execPath), "launcher.exe");
      const args = `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}" -Launcher "${launcher}" -Id "${appUserModelId}" -Marker "${marker}"`;
      shell32.symbols.ShellExecuteW(null, wide("open"), wide("powershell.exe"), wide(args), null, 0);
    }
  } catch (e) {
    console.warn("app user model id:", e);
  }
}
applyAppUserModelId();

// A query string on the command line opens the app on that state, the way
// a link does: launcher.exe "?lat=45.92&lng=7.03&zoom=11&viewMode=3d"
// (or the full https://terrain-viewer.iconem.com/?... link: its query is
// taken). Everything the URL API offers (docs/dev/url-api) works here:
// sources, modes, projects, drawings by URL, bookmarks.
const startQuery = (() => {
  for (const arg of process.argv.slice(1)) {
    if (/^?[^s]+$/.test(arg)) return arg;
    if (/^https?:///.test(arg)) { try { return new URL(arg).search; } catch { /* not a URL */ } }
  }
  return "";
})();
const mainWindow = new BrowserWindow({
  title: "Terrain Viewer",
  url: "views://app/index.html" + startQuery,
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
// The light build ships no docs: its identifier ends in "-light"
// (desktop/gen-config.mjs), and views://app/docs/ holds only a stand-in.
// Read once from the bundle's own version.json.
const docsOnline = (() => {
  try { return String(JSON.parse(readFileSync(join(dirname(process.execPath), "..", "Resources", "version.json"), "utf8")).identifier ?? "").endsWith("-light"); } catch { return false; }
})();
type UpdateDetail = { status: string; version?: string; progress?: number; message?: string; light?: boolean; platform?: string };
let lastUpdateDetail: UpdateDetail | null = null;
let feedVersion = "";
function announceUpdate(status: string, version?: string, extra: Partial<UpdateDetail> = {}) {
  // light and platform let the page name the right release and asset for
  // the download size (the light bundle is about 37 MB, the full one 220).
  const detail: UpdateDetail = { status, version: version || feedVersion || undefined, light: docsOnline, platform: `${process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`, ...extra };
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

const DOCS_SITE = "https://terrain-viewer.iconem.com/docs/";

// Links the app opens in a new tab (target="_blank"): the docs, when bundled
// (views://app/docs/), get their own window; anything on the web (GitHub,
// data providers, the online docs) goes to the system browser rather than
// replacing the map. Two routes land here: Electrobun's "new-window-open"
// event (macOS, Linux), and the page's own host-message "open-external"
// (lib/desktop-bridge.ts), because on Windows the WebView2 wrapper (2.0.2)
// has no new-window handler, so window.open there used to pop WebView2's
// own bare window and the event never fired.
function urlOfNewWindowEvent(event: unknown): string | undefined {
  const detail = (event as { data?: { detail?: unknown } }).data?.detail;
  if (typeof detail === "string") {
    try { return (JSON.parse(detail) as { url?: string }).url ?? detail; } catch { return detail; }
  }
  return (detail as { url?: string } | undefined)?.url;
}
function openUrl(url: string | undefined) {
  if (!url) return;
  if (url.startsWith("views://")) {
    const docsPath = url.match(/^views:\/\/app\/docs\/?(.*)$/)?.[1];
    if (docsOnline && docsPath !== undefined) { Utils.openExternal(DOCS_SITE + docsPath); return; }
    const w = new BrowserWindow({ title: "Terrain Viewer docs", url, frame: { width: 1100, height: 800, x: 140, y: 100 } });
    applyWindowIcon(w);
    // Links inside the bundled docs (GitHub, data providers) go to the browser too.
    w.webview.on("new-window-open", (ev: unknown) => {
      const u = urlOfNewWindowEvent(ev);
      if (u && /^https?:/.test(u)) Utils.openExternal(u);
    });
    w.webview.on("host-message", (ev: unknown) => {
      const msg = (ev as { data?: { detail?: unknown } }).data?.detail as { type?: string; url?: string } | undefined;
      if (msg?.type === "open-external" && msg.url && /^https?:/.test(msg.url)) Utils.openExternal(msg.url);
    });
  } else if (/^https?:/.test(url)) {
    Utils.openExternal(url);
  }
}
mainWindow.webview.on("new-window-open", (event: unknown) => openUrl(urlOfNewWindowEvent(event)));

// The app's fullscreen button uses the HTML Fullscreen API, which in WebView2
// only fills the webview; the window stays. The page reports every change
// through __electrobunSendToHost (FullscreenControlThemed.tsx) and the
// window follows.
mainWindow.webview.on("host-message", (event: unknown) => {
  const msg = (event as { data?: { detail?: unknown } }).data?.detail as { type?: string; on?: boolean; url?: string } | undefined;
  if (msg?.type === "fullscreen") mainWindow.setFullScreen(!!msg.on);
  if (msg?.type === "open-external") openUrl(msg.url);
  if (msg?.type === "apply-update") void Updater.applyUpdate();
  // The page has loaded (or wants a refresh): replay the latest state.
  if (msg?.type === "update-status" && lastUpdateDetail) {
    const { status, version, message, progress } = lastUpdateDetail;
    announceUpdate(status, version, { message, progress });
  }
});
