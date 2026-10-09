#!/usr/bin/env bash
# Historical imagery take v2, production historical host, 1920x1080: the Champ de Mars (Paris 2024).
# Split off on Esri Wayback 2024-10-05 with a slow pan; the 2x1 overlay (A Wayback, B Bing), the swipe
# divider both ways, three Wayback ticks for A; Side 3x1 with Match Colors toggled; the 3x2 grid, E and F
# moved on the timeline, Sort views by date; back to the overlay with the Difference blend, a small pan.
# Every view's terrain is Mapterhorn (terrainSourceA..F), so the pills name only the imagery and its date.
#   ./take-hist2.sh rehearse   -> the choreography without capture
#   ./take-hist2.sh <run-name> -> capture to historical-grid-v2-2026-10-10.mp4
set -e
RUN="${1:-rehearse}"
ROOT=/c/Users/jonathan/.t3/worktrees/terrain-viewer/t3code-a6b9bcf3
cd "$ROOT/video"
OUT="$(cd "$ROOT/.cache/recordings" && pwd -W)"; LOG="$OUT/record-hist2-$RUN.log"; : > "$LOG"
export MSYS_NO_PATHCONV=1
[ -d "$HOME/scoop/apps/ffmpeg/current/bin" ] && export PATH="$HOME/scoop/apps/ffmpeg/current/bin:$PATH"
S=tv-hist2
ab() { echo "> $*" >> "$LOG"; timeout "${T:-120}" npx agent-browser --session "$S" "$@" </dev/null >>"$LOG" 2>&1; }
CLIP="$OUT/historical-grid-v2-2026-10-10.mp4"
SITE=https://historical-satellite.iconem.com
TERR="terrainSourceA=mapterhorn&terrainSourceB=mapterhorn&terrainSourceC=mapterhorn&terrainSourceD=mapterhorn&terrainSourceE=mapterhorn&terrainSourceF=mapterhorn"
BASE="appMode=historical&viewMode=2d&pitch=0&bearing=0&basemapPerView=true&$TERR"
CAM="$BASE&lat=48.8565&lng=2.2975"
# the start, offset so the opening pan (+140, +60 px at z15.5) lands on the Champ de Mars centre
CAM0="$BASE&lat=48.8553&lng=2.30175"
# A Wayback 2024-10-05, B Bing, C Google Earth 2024-08-06, D Wayback 2019-09-15, E Wayback 2013-08-20, F Google Earth 2022-03-10
VIEWS="basemapSourceA=historical&historicalActiveSourceA=wayback&dateA=1728086400000&basemapSourceB=historical&historicalActiveSourceB=bing&basemapSourceC=historical&historicalActiveSourceC=ge-historical&dateC=1722902400000&basemapSourceD=historical&historicalActiveSourceD=wayback&dateD=1568505600000&basemapSourceE=historical&historicalActiveSourceE=wayback&dateE=1376956800000&basemapSourceF=historical&historicalActiveSourceF=ge-historical&dateF=1646870400000"
V17="${VIEWS/dateA=1728086400000/dateA=1491696000000}"
FINAL="basemapSourceA=historical&historicalActiveSourceA=wayback&dateA=1491696000000&basemapSourceB=historical&historicalActiveSourceB=bing&basemapSourceC=historical&historicalActiveSourceC=ge-historical&dateC=1722902400000&basemapSourceD=historical&historicalActiveSourceD=wayback&dateD=1568505600000&basemapSourceE=historical&historicalActiveSourceE=ge-historical&dateE=1470528000000&basemapSourceF=historical&historicalActiveSourceF=wayback&dateF=1728086400000"
SORTED="basemapSourceA=historical&historicalActiveSourceA=ge-historical&dateA=1470528000000&basemapSourceB=historical&historicalActiveSourceB=wayback&dateB=1491696000000&basemapSourceC=historical&historicalActiveSourceC=wayback&dateC=1568505600000&basemapSourceD=historical&historicalActiveSourceD=bing&basemapSourceE=historical&historicalActiveSourceE=ge-historical&dateE=1722902400000&basemapSourceF=historical&historicalActiveSourceF=wayback&dateF=1728086400000"
SETUP='localStorage.setItem("hasSeenTour","true");localStorage.setItem("isSidebarOpen","true");"ok"'
W=${WARM:-12000}

ab close || true
ab --args "--use-angle=d3d11,--ignore-gpu-blocklist,--enable-gpu-rasterization" set viewport 1920 1080
ab open "$SITE/robots.txt"
ab eval "$SETUP"
# warm-up through separate page loads, last scene first (the HTTP cache): the overlay of the sorted A/B with the
# Difference blend, the sorted and unsorted grids, the 3x1, A on each Wayback date the overlay clicks, the start.
# (Run 2 warmed inside one page instead, history.pushState + popstate: every map stayed mounted, the renderer
# slowed the take by 8 s and the white flashes on layout changes stayed. Kept as run 1 did it.)
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=overlay&gridLayout=3x2&splitBlendModeEnabled=true&matchColorsToA=true&$SORTED"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x2&matchColorsToA=true&$SORTED"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x2&matchColorsToA=true&$FINAL"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x2&$V17"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x1&matchColorsToA=true&$V17"
ab wait $W
for d in 1744416000000 1376956800000 1491696000000; do ab open "$SITE/?$CAM&zoom=15.5&splitStyle=overlay&gridLayout=2x1&${VIEWS/dateA=1728086400000/dateA=$d}"; ab wait $((W - 3000)); done
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=overlay&gridLayout=2x1&$VIEWS"
ab wait $W
ab open "$SITE/?$CAM0&zoom=15.5&splitStyle=off&gridLayout=2x1&$VIEWS"
ab wait $((W + 3000))
CDP="$(npx agent-browser --session "$S" get cdp-url </dev/null 2>/dev/null | tail -1)"
echo "cdp $CDP" >> "$LOG"
node "$OUT/take-hist2.mjs" "$CDP" prep >>"$LOG" 2>&1
ab screenshot "$OUT/pre-take-hist2-$RUN.png"
if [ "$RUN" = rehearse ]; then
  node "$OUT/take-hist2.mjs" "$CDP" run >"$OUT/take-hist2-$RUN.log" 2>&1 || true
  ab screenshot "$OUT/end-hist2-$RUN.png"
else
  node scripts/capture.mjs "$CDP" "$CLIP" --seconds 90 >"$OUT/capture-hist2-$RUN.log" 2>&1 & CAP=$!
  sleep 0.4
  node "$OUT/take-hist2.mjs" "$CDP" run >"$OUT/take-hist2-$RUN.log" 2>&1 || true
  sleep 0.6; touch "$CLIP.stop"; wait "$CAP" || true
  cat "$OUT/capture-hist2-$RUN.log"
fi
ab close
cat "$OUT/take-hist2-$RUN.log"
