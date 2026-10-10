#!/usr/bin/env bash
# Historical imagery take v4 (v3 slowed for narrator subtitles, 3-4 s holds, the hand cursor), production historical host, 1920x1080: the Champ de Mars (Paris 2024).
# Split off on Esri Wayback 2024-10-05 with a slow pan; the 2x1 overlay (A Wayback, B Bing), the swipe divider
# both ways, three Wayback ticks for A (2013, 2017, 2025); Side and straight to the 3x2 grid (never a 3x1), E and
# F moved on the timeline, Sort views by date, Match Colors on/off/on/off/on; back to the overlay, Difference blend.
# Every view's terrain is Mapterhorn (terrainSourceA..F), so the pills name only the imagery and its date.
#   ./take-hist4.sh rehearse   -> the choreography without capture
#   ./take-hist4.sh <run-name> -> capture to historical-grid-v4-2026-10-10.mp4
set -e
RUN="${1:-rehearse}"
ROOT=/c/Users/jonathan/.t3/worktrees/terrain-viewer/t3code-a6b9bcf3
cd "$ROOT/video"
OUT="$(cd "$ROOT/.cache/recordings" && pwd -W)"; LOG="$OUT/record-hist4-$RUN.log"; : > "$LOG"
export MSYS_NO_PATHCONV=1
[ -d "$HOME/scoop/apps/ffmpeg/current/bin" ] && export PATH="$HOME/scoop/apps/ffmpeg/current/bin:$PATH"
S=tv-hist4
ab() { echo "> $*" >> "$LOG"; timeout "${T:-120}" npx agent-browser --session "$S" "$@" </dev/null >>"$LOG" 2>&1; }
CLIP="$OUT/historical-grid-v4-2026-10-10.mp4"
SITE=https://historical-satellite.iconem.com
TERR="terrainSourceA=mapterhorn&terrainSourceB=mapterhorn&terrainSourceC=mapterhorn&terrainSourceD=mapterhorn&terrainSourceE=mapterhorn&terrainSourceF=mapterhorn"
BASE="appMode=historical&viewMode=2d&pitch=0&bearing=0&basemapPerView=true&$TERR"
# the camera where the opening pan lands (read from the take log): the warm-ups must load this exact centre
CAM="$BASE&lat=48.8559&lng=2.2996"
# the start, offset so the opening pan (+140, +60 px at z15.5) lands on the Champ de Mars centre
CAM0="$BASE&lat=48.8553&lng=2.30175"
# A Wayback 2024-10-05, B Bing, C Google Earth 2024-08-06, D Wayback 2019-09-15, E Wayback 2013-08-20, F Google Earth 2022-03-10
VIEWS="basemapSourceA=historical&historicalActiveSourceA=wayback&dateA=1728086400000&basemapSourceB=historical&historicalActiveSourceB=bing&basemapSourceC=historical&historicalActiveSourceC=ge-historical&dateC=1722902400000&basemapSourceD=historical&historicalActiveSourceD=wayback&dateD=1568505600000&basemapSourceE=historical&historicalActiveSourceE=wayback&dateE=1376956800000&basemapSourceF=historical&historicalActiveSourceF=ge-historical&dateF=1646870400000"
# A after the three ticks (2013, 2017, 2025): Wayback 2025-04-12, the exact 3x2 at the switch
V25="basemapSourceA=historical&historicalActiveSourceA=wayback&dateA=1744416000000&basemapSourceB=historical&historicalActiveSourceB=bing&basemapSourceC=historical&historicalActiveSourceC=ge-historical&dateC=1722902400000&basemapSourceD=historical&historicalActiveSourceD=wayback&dateD=1568505600000&basemapSourceE=historical&historicalActiveSourceE=wayback&dateE=1376956800000&basemapSourceF=historical&historicalActiveSourceF=ge-historical&dateF=1646870400000"
# E dragged onto Google Earth 2016-08-07
EMID="basemapSourceA=historical&historicalActiveSourceA=wayback&dateA=1744416000000&basemapSourceB=historical&historicalActiveSourceB=bing&basemapSourceC=historical&historicalActiveSourceC=ge-historical&dateC=1722902400000&basemapSourceD=historical&historicalActiveSourceD=wayback&dateD=1568505600000&basemapSourceE=historical&historicalActiveSourceE=ge-historical&dateE=1470528000000&basemapSourceF=historical&historicalActiveSourceF=ge-historical&dateF=1646870400000"
# F dragged onto Wayback 2024-10-05
FINAL="basemapSourceA=historical&historicalActiveSourceA=wayback&dateA=1744416000000&basemapSourceB=historical&historicalActiveSourceB=bing&basemapSourceC=historical&historicalActiveSourceC=ge-historical&dateC=1722902400000&basemapSourceD=historical&historicalActiveSourceD=wayback&dateD=1568505600000&basemapSourceE=historical&historicalActiveSourceE=ge-historical&dateE=1470528000000&basemapSourceF=historical&historicalActiveSourceF=wayback&dateF=1728086400000"
# after Sort views by date (order as the app sorted it in the rehearsal)
SORTED="basemapSourceA=historical&historicalActiveSourceA=ge-historical&dateA=1470528000000&basemapSourceB=historical&historicalActiveSourceB=wayback&dateB=1568505600000&basemapSourceC=historical&historicalActiveSourceC=bing&dateC=1295049600000&basemapSourceD=historical&historicalActiveSourceD=ge-historical&dateD=1722902400000&basemapSourceE=historical&historicalActiveSourceE=wayback&dateE=1728086400000&basemapSourceF=historical&historicalActiveSourceF=wayback&dateF=1744416000000"
SETUP='localStorage.setItem("hasSeenTour","true");localStorage.setItem("isSidebarOpen","true");"ok"'
W=${WARM:-12000}

ab close || true
ab --args "--use-angle=d3d11,--ignore-gpu-blocklist,--enable-gpu-rasterization" set viewport 1920 1080
ab open "$SITE/robots.txt"
ab eval "$SETUP"
# warm-up through separate page loads, last scene first (the HTTP cache). SORTED is read from the rehearsal log.
# The exact 3x2 at the switch (V25: A on Wayback 2025-04) is loaded twice, the second time just before the start.
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=overlay&gridLayout=3x2&splitBlendModeEnabled=true&matchColorsToA=true&$SORTED"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=overlay&gridLayout=3x2&matchColorsToA=true&$SORTED"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x2&matchColorsToA=true&$SORTED"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x2&$SORTED"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x2&$FINAL"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x2&$EMID"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x2&$V25"
ab wait $((W + 6000))
for d in 1376956800000 1491696000000 1744416000000; do ab open "$SITE/?$CAM&zoom=15.5&splitStyle=overlay&gridLayout=2x1&${VIEWS/dateA=1728086400000/dateA=$d}"; ab wait $((W - 3000)); done
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=overlay&gridLayout=2x1&$VIEWS"
ab wait $W
ab open "$SITE/?$CAM&zoom=15.5&splitStyle=side-by-side&gridLayout=3x2&$V25"
ab wait $((W + 8000))
ab open "$SITE/?$CAM0&zoom=15.5&splitStyle=off&gridLayout=2x1&$VIEWS"
ab wait $((W + 3000))
CDP="$(npx agent-browser --session "$S" get cdp-url </dev/null 2>/dev/null | tail -1)"
echo "cdp $CDP" >> "$LOG"
node "$OUT/take-hist4.mjs" "$CDP" prep >>"$LOG" 2>&1
ab screenshot "$OUT/pre-take-hist4-$RUN.png"
if [ "$RUN" = rehearse ]; then
  node "$OUT/take-hist4.mjs" "$CDP" run >"$OUT/take-hist4-$RUN.log" 2>&1 || true
  ab screenshot "$OUT/end-hist4-$RUN.png"
else
  node scripts/capture.mjs "$CDP" "$CLIP" --seconds 120 >"$OUT/capture-hist4-$RUN.log" 2>&1 & CAP=$!
  sleep 0.4
  node "$OUT/take-hist4.mjs" "$CDP" run >"$OUT/take-hist4-$RUN.log" 2>&1 || true
  sleep 0.6; touch "$CLIP.stop"; wait "$CAP" || true
  cat "$OUT/capture-hist4-$RUN.log"
fi
ab close
cat "$OUT/take-hist4-$RUN.log"
