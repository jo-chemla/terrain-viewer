---
name: desktop-electrobun-gotchas
description: Electrobun 2.0.2 desktop app gotchas on Windows - no new-window handler in the WebView2 wrapper (window.open pops a bare WebView2 window, "new-window-open" never fires), how to drive the installed app over CDP, where the updater logs, shortcut-name collision between the two variants
type: project
---

Written 2026-10-02 after reproducing the "docs open in a strange window" report on the light Windows build.

**window.open on Windows never reaches the main process.** Electrobun 2.0.2's `nativeWrapper.cpp` (win) has no `NewWindowRequested` handler, so WebView2 opens its own bare popup window for `window.open(url, "_blank")` and `target="_blank"` anchors, and the `"new-window-open"` webview event (which `src/bun/index.ts` uses to send links to the system browser and the bundled docs to their own window) only fires from the preload's cmd-click path. Fix in place: `lib/desktop-bridge.ts` `routeNewWindowsThroughHost()` overrides `window.open` and captures `_blank` anchor clicks when `__electrobunSendToHost` exists, sending `{type:"open-external", url}`; the main process's host-message handler calls `openUrl()`. The stand-in docs page (`desktop/online-docs/index.html`) does the same. Keep the `new-window-open` listener for macOS/Linux.

**Driving the installed app for a reproduction.** Launch `launcher.exe` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, then Playwright `chromium.connectOverCDP("http://127.0.0.1:9333")` (scripts in `.cache/pw/desktop-*.mjs`): `http://127.0.0.1:9333/json` lists the page targets, so a popup shows up as a second page with an empty title. Closing the window via `CloseMainWindow()` leaves `msedgewebview2.exe` orphans but relaunch works.

**Updater.** Every updater step is logged to `%LOCALAPPDATA%\<identifier>\stable\updater.log`; the full cycle (download at launch 1, apply at launch 2 with a self-relaunch after ~25 s, "already on latest" at launch 3) was verified on 2026-10-02. The light build has no feed (`baseUrl` empty) by design.

**Two variants, one shortcut name.** The installer names the Desktop and Start menu shortcuts after `app.name`; with both variants named "Terrain Viewer" the second install overwrote the first's shortcut and an uninstall removed it. `gen-config.mjs` names the light build "Terrain Viewer Light" since fa3dc8d.

**Why:** three hours were lost assuming the `new-window-open` handler ran; nothing in Electrobun's docs says Windows lacks it.

**How to apply:** any new "open in browser" feature in the desktop app must go through the host-message route, not `window.open`; verify on the installed Windows build over CDP, not in the agent browser.

**Pinning pinned cottontail.exe (2026-10-10).** The window belongs to the
runtime process (cottontail.exe owns the HWND; launcher.exe only starts it),
so pinning the running app to the taskbar pinned cottontail.exe, which run on
its own prints its usage. Windows matches a running window to a Start menu
shortcut by AppUserModelID; the installer's shortcuts (target launcher.exe)
carry none. Fix in src/bun/index.ts: `SetCurrentProcessExplicitAppUserModelID`
over shell32 before the window is created, with `<identifier>.<channel>`
(com.iconem.terrain-viewer-light.stable), and once per install a PowerShell
script (written to the channel root, started with ShellExecuteW since the
runtime has no child_process) that sets System.AppUserModel.ID on every
.lnk targeting launcher.exe through IShellLink's IPropertyStore (tested by
hand on the installed light shortcuts: set 0, commit 0, read back). A marker
file aumid-shortcuts.txt in the channel root stops the rerun. Not verified
on an installed build yet: pin after the next update and check the pin's
target is launcher.exe.
