#!/usr/bin/env bash
# Historical imagery take, production historical host, 1920x1080: the Champ de Mars (Paris 2024).
# A 2x1 overlay (A Esri Wayback 2024-10-05, B Bing), the swipe divider, A's handle scrubbed back and
# a Wayback tick; Side, the 3x2 grid (C..F preloaded through the URL), E and F moved on the timeline;
# Sort views by date; a small zoom out.
#   ./take-hist.sh rehearse   -> the choreography without capture
#   ./take-hist.sh <run-name> -> capture to historical-grid-2026-10-10.mp4 (log suffix <run-name>)
set -e
RUN="${1:-rehearse}"
ROOT=/c/Users/jonathan/.t3/worktrees/terrain-viewer/t3code-a6b9bcf3
cd "$ROOT/video"
OUT="$(cd "$ROOT/.cache/recordings" && pwd -W)"; LOG="$OUT/record-hist-$RUN.log"; : > "$LOG"
export MSYS_NO_PATHCONV=1
[ -d "$HOME/scoop/apps/ffmpeg/current/bin" ] && export PATH="$HOME/scoop/apps/ffmpeg/current/bin:$PATH"
S=tv-hist
ab() { echo "> $*" >> "$LOG"; timeout "${T:-120}" npx agent-browser --session "$S" "$@" </dev/null >>"$LOG" 2>&1; }
CLIP="$OUT/historical-grid-2026-10-10.mp4"
SITE=https://historical-satellite.iconem.com
CAM="appMode=historical&viewMode=2d&lat=48.8565&lng=2.2975&pitch=0&bearing=0&basemapPerView=true"
# A Wayback 2024-10-05, B Bing, C Google Earth 2024-08-06, D Wayback 2019-09-15, E Wayback 2013-08-20, F Google Earth 2022-03-10
VIEWS="basemapSourceA=historical&historicalActiveSourceA=wayback&dateA=1728086400000&basemapSourceB=historical&historicalActiveSourceB=bing&basemapSourceC=historical&historicalActiveSourceC=ge-historical&dateC=1722902400000&basemapSourceD=historical&historicalActiveSourceD=wayback&dateD=1568505600000&basemapSourceE=historical&historicalActiveSourceE=wayback&dateE=1376956800000&basemapSourceF=historical&historicalActiveSourceF=ge-historical&dateF=1646870400000"
# the grid before the sort (A Wayback 2017, E Google Earth 2016-08, F Wayback 2024-10) and after it, to warm the tile cache
FINAL="basemapSourceA=historical&historicalActiveSourceA=wayback&dateA=1491696000000&basemapSourceB=historical&historicalActiveSourceB=bing&basemapSourceC=historical&historicalActiveSourceC=ge-historical&dateC=1722902400000&basemapSourceD=historical&historicalActiveSourceD=wayback&dateD=1568505600000&basemapSourceE=historical&historicalActiveSourceE=ge-historical&dateE=1470528000000&basemapSourceF=historical&historicalActiveSourceF=wayback&dateF=1728086400000"
SETUP='localStorage.setItem("hasSeenTour","true");localStorage.setItem("isSidebarOpen","true");"ok"'
W=${WARM:-12000}

ab close || true
ab --args "--use-angle=d3d11,--ignore-gpu-blocklist,--enable-gpu-rasterization" set viewport 1920 1080
ab open "$SITE/robots.txt"
ab eval "$SETUP"
# warm-up: the final grid at the start zoom and zoomed out, then the start state
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x2&$FINAL"
ab wait $W
SORTED="basemapSourceA=historical&historicalActiveSourceA=ge-historical&dateA=1470528000000&basemapSourceB=historical&historicalActiveSourceB=wayback&dateB=1491696000000&basemapSourceC=historical&historicalActiveSourceC=wayback&dateC=1568505600000&basemapSourceD=historical&historicalActiveSourceD=bing&basemapSourceE=historical&historicalActiveSourceE=ge-historical&dateE=1722902400000&basemapSourceF=historical&historicalActiveSourceF=wayback&dateF=1728086400000"
ab open "$SITE/?$CAM&zoom=15.95&splitStyle=side-by-side&gridLayout=3x2&$SORTED"
ab wait $W
# A on each Wayback date the overlay clicks (2025-04-12, 2013-08-20, 2017-04-09)
for d in 1744416000000 1376956800000 1491696000000; do ab open "$SITE/?$CAM&zoom=15.5&splitStyle=overlay&gridLayout=2x1&${VIEWS/dateA=1728086400000/dateA=$d}"; ab wait $((W - 3000)); done
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x2&$VIEWS"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=overlay&gridLayout=2x1&$VIEWS"
ab wait $((W + 3000))
CDP="$(npx agent-browser --session "$S" get cdp-url </dev/null 2>/dev/null | tail -1)"
echo "cdp $CDP" >> "$LOG"
node "$OUT/take-hist.mjs" "$CDP" prep >>"$LOG" 2>&1
ab screenshot "$OUT/pre-take-hist-$RUN.png"
if [ "$RUN" = rehearse ]; then
  node "$OUT/take-hist.mjs" "$CDP" run >"$OUT/take-hist-$RUN.log" 2>&1 || true
  ab screenshot "$OUT/end-hist-$RUN.png"
else
  node scripts/capture.mjs "$CDP" "$CLIP" --seconds 60 >"$OUT/capture-hist-$RUN.log" 2>&1 & CAP=$!
  sleep 0.4
  node "$OUT/take-hist.mjs" "$CDP" run >"$OUT/take-hist-$RUN.log" 2>&1 || true
  sleep 0.6; touch "$CLIP.stop"; wait "$CAP" || true
  cat "$OUT/capture-hist-$RUN.log"
fi
ab close
cat "$OUT/take-hist-$RUN.log"
