// Terrain Viewer as a desktop app: one window on the packaged Vite build.
// The main process does nothing else yet. Local COGs already open through the
// browser's own file picker inside the app (the cog-local source), so no
// native dialog bridge is needed for the offline case; online sources
// (Mapterhorn, basemaps, WMS) still need the network.
import { BrowserWindow, Utils } from "electrobun/main";

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

// Links the app opens in a new tab (target="_blank"): the docs, when bundled
// (views://app/docs/), get their own window; anything on the web (GitHub,
// data providers, the online docs) goes to the system browser rather than
// replacing the map.
mainWindow.webview.on("new-window-open", (event: unknown) => {
  const detail = (event as { data?: { detail?: unknown } }).data?.detail;
  const url = typeof detail === "string" ? detail : (detail as { url?: string } | undefined)?.url;
  if (!url) return;
  if (url.startsWith("views://")) {
    new BrowserWindow({ title: "Terrain Viewer docs", url, frame: { width: 1100, height: 800, x: 140, y: 100 } });
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
