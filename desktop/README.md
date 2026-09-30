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

## What the build writes, and where

Hutch writes everything inside `desktop/` (or wherever the config lives), never into the app's `dist/`:

- `build/stable-win-x64/TerrainViewer/` (`.app` on macOS): the application bundle itself, `bin/launcher.exe` plus `Resources/app/views/app/` holding the copied dist. This folder runs as is - it is the "portable" form; there is no single-file executable, the webview runtime and the Bun main process are separate files next to the launcher.
- `build/stable-win-x64/Terrain Viewer-Setup.exe`, the `.tar.zst` update archive and `update.json`: the installer and the updater feed (`.dmg` on macOS, self-extracting `.tar.gz` on Linux).
- `artifacts/`: the distributable files only, e.g. `win-x64-TerrainViewer-Setup.zip`; this is what the workflow uploads.

## Icon, docs, fullscreen

- `icons/` holds `public/favicon.svg` rasterised (`.cache/pw/favicon-png.mjs` at 1024 px, then Pillow): `icon.ico` (16-256 px) for the Windows installer, shortcut and taskbar, `icon.iconset/` for the macOS `.app` (converted by `iconutil` on the runner), `icon.png` (512 px) for the Linux desktop entry. `gen-config.mjs` points `build.win.icon`, `build.mac.icons` and `build.linux.icon` at them.
- Docs: when `dist/docs/index.html` exists (the workflow merges the Next export there like the Pages deploy does), `gen-config.mjs` bundles it and the sidebar's Documentation button resolves to `views://app/docs/` offline; `src/bun/index.ts` opens `target="_blank"` links to `views://` in a second window and http(s) ones in the system browser. Untested: whether the `views://` handler serves `index.html` for a directory URL (the docs export uses trailing-slash URLs). If `views://app/docs/` shows nothing, the fix is a `will-navigate` rewrite to `.../index.html` or serving the docs from a local port.
- Fullscreen: the map's fullscreen button uses the browser Fullscreen API on the map container. WebView2 and WKWebView implement it inside the webview (the element fills the window's content area); whether the native window frame drops needs a check - Electrobun has `BrowserWindow.setFullScreen()` for that, not wired yet.

The GitHub workflow `.github/workflows/desktop.yml` runs the same steps on a macOS, a Windows and an Ubuntu runner (manual trigger) and uploads `desktop/artifacts` for each.

## Building from a git worktree

`hutch electrobun build` failed with `could not project the Electrobun 2.0.2 devkit: AccessDenied` when run inside a git worktree checkout (a `.t3/worktrees/...` path on Windows), and succeeded from a plain copy of this folder in `C:\tmp` (2026-09-30, a 36 MB `win-x64-TerrainViewer-Setup.zip` in `artifacts/`). If the build fails that way, copy `desktop/` and `dist/` (as `../dist`) somewhere plain and build there; the GitHub runners are plain checkouts.

On Windows run the build from PowerShell or cmd, not Git Bash: the release step shells out to `tar`, and Git Bash puts GNU tar first in PATH, which fails with `command failed: tar` / `ReleaseCommandFailed` after the bundle is already built; Windows' own bsdtar (`C:\Windows\System32	ar.exe`) works. There is no lockfile in this folder, so `hutch install` (without `--frozen-lockfile`) is what a fresh copy needs before the first build.

## Known unknowns

- Web Workers and the custom `views://` scheme: MapLibre and the COG reader run workers, and a custom scheme may not allow them in every system webview. If a build opens on a blank map, that is the first thing to check; the fallback is serving `dist/` from a local HTTP port in the main process instead of `views://`.
- WebGL 2 is required (MapLibre 6); all three system webviews have it.
- Linux needs GTK 3, WebKitGTK 4.1, Ayatana AppIndicator and librsvg at runtime.
- macOS Gatekeeper refuses an unsigned download; right-click, Open, or sign with `mac.codesign: true` and an Apple identity.
