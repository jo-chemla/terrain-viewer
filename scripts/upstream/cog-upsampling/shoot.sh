#!/usr/bin/env bash
# Reproduction for the maplibre-cog-protocol upsampling issue: serve the repo root first
# (python -m http.server 8765 --bind 127.0.0.1), then ./shoot.sh writes protocol.png and maplibre.png here.
# Screenshots of index.html in both modes, headless Chrome on the GPU (agent-browser from video/).
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/video"
OUT="$(cd "$(dirname "$0")" && pwd -W)"; LOG="$OUT/shoot.log"; : > "$LOG"
export MSYS_NO_PATHCONV=1
S=tv-cogshot
ab() { echo "> $*" >> "$LOG"; timeout "${T:-120}" npx agent-browser --session "$S" "$@" </dev/null >>"$LOG" 2>&1; }
ab close || true
ab --args "--use-angle=d3d11,--ignore-gpu-blocklist,--enable-gpu-rasterization" set viewport 1200 800
for m in protocol maplibre; do
  ab open "http://127.0.0.1:8765/scripts/upstream/cog-upsampling/index.html?mode=$m"
  ab wait 25000
  ab eval "JSON.stringify({idle: window.__idle, info: window.__info, errors: window.__errors.slice(0,3)})"
  ab screenshot "$OUT/$m.png"
done
ab close
cat "$LOG" | tail -12
