#!/usr/bin/env bash
# Sixth take (take five plus the Data layers picker scrolled through), production site, 1920x1080: Mont Blanc 2D hillshade (kept on), a pan,
# Terrain Analysis, its options, Slope Range max swept to 60, the sidebar back up,
# Elevation Hypso, its options, the ramp to GMT_globe, the min/max bounds pulled in, a scroll-zoom.
set -e
ROOT=/c/Users/jonathan/.t3/worktrees/terrain-viewer/t3code-a6b9bcf3
cd "$ROOT/video"
OUT="$(cd "$ROOT/.cache/recordings" && pwd -W)"; LOG="$OUT/rehearse-v6.log"; : > "$LOG"
export MSYS_NO_PATHCONV=1
[ -d "$HOME/scoop/apps/ffmpeg/current/bin" ] && export PATH="$HOME/scoop/apps/ffmpeg/current/bin:$PATH"
S=tv-reh6
ab() { echo "> $*" >> "$LOG"; timeout "${T:-120}" npx agent-browser --session "$S" "$@" </dev/null >>"$LOG" 2>&1; }
CLIP="$OUT/basic-modes-v6-2026-10-10.mp4"
SITE=https://terrain-viewer.iconem.com
VIEW="lat=45.92&lng=7.03&zoom=11.5&viewMode=2d"
SETUP='localStorage.setItem("hasSeenTour","true");localStorage.setItem("isSidebarOpen","true");"ok"'

ab close || true
ab --args "--use-angle=d3d11,--ignore-gpu-blocklist,--enable-gpu-rasterization" set viewport 1920 1080
ab open "$SITE/robots.txt"
ab eval "$SETUP"
# warm-up: the slope tiles at the start view and around the pan, then the start state
ab open "$SITE/?$VIEW&showTerrainAnalysis=true&showColorRelief=true"
ab wait 6000
ab open "$SITE/?lat=45.93&lng=7.09&zoom=11.5&viewMode=2d&showTerrainAnalysis=true&showColorRelief=true"
ab wait 6000
ab open "$SITE/?lat=45.915&lng=7.02&zoom=12.6&viewMode=2d&showTerrainAnalysis=true&showColorRelief=true"
ab wait 6000
ab open "$SITE/?$VIEW&openDataLayers=true"
ab wait 3000
ab eval 'document.querySelectorAll("#tour-data-layers img").forEach((i) => { i.loading = "eager" }); document.querySelectorAll("#tour-data-layers img").length'
ab wait 8000
ab eval '[...document.querySelectorAll("#tour-data-layers img")].filter((i) => i.complete && i.naturalWidth > 0).length'
ab open "$SITE/?$VIEW"
ab wait 6000
CDP="$(npx agent-browser --session "$S" get cdp-url </dev/null 2>/dev/null | tail -1)"
echo "cdp $CDP" >> "$LOG"
node "$OUT/take-v6.mjs" "$CDP" prep >>"$LOG" 2>&1
ab screenshot "$OUT/pre-take-v6.png"
node "$OUT/take-v6.mjs" "$CDP" run >"$OUT/rehearse-v6-run.log" 2>&1
ab screenshot "$OUT/rehearse-v6-end.png"; ab close
cat "$OUT/rehearse-v6-run.log"
