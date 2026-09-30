# Terrain Viewer desktop (experimental)

The web app packaged as a desktop application with [Electrobun](https://blackboard.sh/electrobun/): the system webview (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux) showing the Vite build, no bundled Chromium, so the installer is small. The point is working offline on local data: a COG picked from disk opens through the app's own file picker, and every mode runs in the browser engine. Online sources (Mapterhorn, basemaps, WMS services) still need the network.

Status: a first attempt. Not signed, not notarized, not released; the workflow builds artifacts to download and try.

## Build

Electrobun builds for the machine it runs on: one build per platform, on that platform. Targets: macOS arm64, Windows x64, Linux x64 and arm64.

```bash
# 1. the web app
pnpm install && pnpm build          # writes dist/

# 2. Hutch, Electrobun's build CLI (once)
curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh                 # macOS, Linux
& ([scriptblock]::Create((irm https://hutch.blackboard.sh/hutch/install.ps1)))  # Windows PowerShell

# 3. the desktop bundle
cd desktop
node gen-config.mjs                  # electrobun.config.ts from dist/ (a copy entry per file)
hutch run install
hutch electrobun build --env=stable  # artifacts/ : .dmg / setup .exe / self-extracting installer
```

`hutch electrobun dev` opens the window on the current dist without packaging.

The GitHub workflow `.github/workflows/desktop.yml` runs the same steps on a macOS, a Windows and an Ubuntu runner (manual trigger) and uploads `desktop/artifacts` for each.

## Known unknowns

- Web Workers and the custom `views://` scheme: MapLibre and the COG reader run workers, and a custom scheme may not allow them in every system webview. If a build opens on a blank map, that is the first thing to check; the fallback is serving `dist/` from a local HTTP port in the main process instead of `views://`.
- WebGL 2 is required (MapLibre 6); all three system webviews have it.
- Linux needs GTK 3, WebKitGTK 4.1, Ayatana AppIndicator and librsvg at runtime.
- macOS Gatekeeper refuses an unsigned download; right-click, Open, or sign with `mac.codesign: true` and an Apple identity.
