// Terrain Viewer as a desktop app: one window on the packaged Vite build.
// The main process does nothing else yet. Local COGs already open through the
// browser's own file picker inside the app (the cog-local source), so no
// native dialog bridge is needed for the offline case; online sources
// (Mapterhorn, basemaps, WMS) still need the network.
import { BrowserWindow } from "electrobun/main";

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

void mainWindow;
