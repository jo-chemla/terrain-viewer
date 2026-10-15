#!/usr/bin/env bash
# Generic driver of a declarative take (scripts/take.mjs): what video/takes/historical-grid-v5/take-hist5.sh
# does by hand, from the take's JSON. agent-browser launches headless Chrome on the GPU at 1920x1080, the
# localStorage of the JSON's "storage" (plus hasSeenTour and isSidebarOpen) is written from the site's
# /robots.txt, the warm-up states ("warmup" merged over "start") are loaded one page load each so the tiles
# are in the HTTP cache, then the start state; take.mjs injects the cursor and plays the steps over the
# DevTools websocket, captured by scripts/capture.mjs in record mode. Outputs under .cache/recordings/:
# <clip>.mp4, <clip>.json (the captions' seconds), the logs and the pre-take / end screenshots.
#   scripts/take.sh <take.json> rehearse          -> the choreography without capture
#   scripts/take.sh <take.json> record [<clip>]   -> capture to <clip>.mp4 (default <name>-<today>)
set -e
JSON="$(cd "$(dirname "$1")" && pwd -W)/$(basename "$1")"
RUN="${2:-rehearse}"
cd "$(dirname "$0")/.."
ROOT="$(cd .. && pwd)"
mkdir -p "$ROOT/.cache/recordings"
OUT="$(cd "$ROOT/.cache/recordings" && pwd -W)"
export MSYS_NO_PATHCONV=1
[ -d "$HOME/scoop/apps/ffmpeg/current/bin" ] && export PATH="$HOME/scoop/apps/ffmpeg/current/bin:$PATH"
PLAN="$(node scripts/take.mjs plan "$JSON")"
NAME="$(printf '%s\n' "$PLAN" | sed -n 's/^NAME //p')"
SETUP="$(printf '%s\n' "$PLAN" | sed -n 's/^SETUP //p')"
WARM_S="$(printf '%s\n' "$PLAN" | sed -n 's/^WARM_S //p')"
SETTLE_S="$(printf '%s\n' "$PLAN" | sed -n 's/^SETTLE_S //p')"
START="$(printf '%s\n' "$PLAN" | sed -n 's/^START //p')"
SITE="${START%%\?*}"; SITE="${SITE%/}"
CLIPNAME="${3:-$NAME-$(date +%F)}"
CLIP="$OUT/$CLIPNAME.mp4"
LOG="$OUT/record-$NAME-$RUN.log"; : > "$LOG"
S="tv-$NAME"
ab() { echo "> $*" >> "$LOG"; timeout "${T:-120}" npx agent-browser --session "$S" "$@" </dev/null >>"$LOG" 2>&1; }
CURSORS="${CURSORS:-$(pwd -W)/takes/historical-grid-v5}"

ab close || true
ab --args "--use-angle=d3d11,--ignore-gpu-blocklist,--enable-gpu-rasterization" set viewport 1920 1080
ab open "$SITE/robots.txt"
ab eval "$SETUP"
# warm-up through separate page loads, in the JSON's order, then the start state
while IFS= read -r u; do [ -n "$u" ] || continue; ab open "$u"; ab wait $((WARM_S * 1000 + 6000)); done <<< "$(printf '%s\n' "$PLAN" | sed -n 's/^WARM //p')"
ab open "$START"
ab wait $((SETTLE_S * 1000 + 8000))
CDP="$(npx agent-browser --session "$S" get cdp-url </dev/null 2>/dev/null | tail -1)"
echo "cdp $CDP" >> "$LOG"
node scripts/take.mjs prep "$JSON" "$CDP" --cursors "$CURSORS" >>"$LOG" 2>&1
ab screenshot "$OUT/pre-take-$NAME-$RUN.png"
if [ "$RUN" = rehearse ]; then
  node scripts/take.mjs run "$JSON" "$CDP" --cursors "$CURSORS" >"$OUT/take-$NAME-$RUN.log" 2>&1 || true
  ab screenshot "$OUT/end-$NAME-$RUN.png"
else
  node scripts/capture.mjs "$CDP" "$CLIP" --seconds "${CAP_S:-160}" >"$OUT/capture-$NAME-$RUN.log" 2>&1 & CAP=$!
  sleep 0.4
  node scripts/take.mjs run "$JSON" "$CDP" --cursors "$CURSORS" --captions "$OUT/$CLIPNAME.json" --offset 0.4 >"$OUT/take-$NAME-$RUN.log" 2>&1 || true
  sleep 0.6; touch "$CLIP.stop"; wait "$CAP" || true
  cat "$OUT/capture-$NAME-$RUN.log"
fi
ab close
cat "$OUT/take-$NAME-$RUN.log"
