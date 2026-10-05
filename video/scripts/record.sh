#!/usr/bin/env bash
# Two demo takes of Terrain Viewer, driven by agent-browser (headless Chrome
# on the real GPU through ANGLE/D3D11) and captured over the DevTools
# protocol by scripts/capture.mjs. agent-browser's own `record` pipes frames
# into ffmpeg live and drops the whole take when the encoder falls 500 ms
# behind, which dense map frames always did on this laptop; the capture
# writes frames to disk and assembles them afterwards, at their real timing.
# Needs the app on :5204. Output: recordings/clip-paper.mp4, clip-isoline.mp4,
# then `pnpm clips` scales them into public/ for the composition.
set -e
cd "$(dirname "$0")/.."
OUT="$(pwd -W 2>/dev/null || pwd)/recordings"; mkdir -p "$OUT"; LOG="$OUT/record.log"; : > "$LOG"
export MSYS_NO_PATHCONV=1   # Git Bash would rewrite "/..." arguments into Windows paths
[ -d "$HOME/scoop/apps/ffmpeg/current/bin" ] && export PATH="$HOME/scoop/apps/ffmpeg/current/bin:$PATH"
S=tv-demo
# stdin/stdout never a pipe: the daemon a first command spawns would inherit it.
ab() { echo "> $*" >> "$LOG"; timeout "${T:-120}" npx agent-browser --session "$S" "$@" </dev/null >>"$LOG" 2>&1; }
capture() { node scripts/capture.mjs "$(npx agent-browser --session "$S" get cdp-url </dev/null 2>/dev/null | tail -1)" "$1" --seconds 90 >>"$LOG" 2>&1 & CAP=$!; sleep 3; }
stop_capture() { touch "$1.stop"; wait "$CAP"; }

MAP=1d3318002984790c   # Rumsey, Atlas du plan général de la ville de Paris (72 sheets): clean cream paper
SETUP='localStorage.setItem("hasSeenTour","true");localStorage.setItem("isSidebarOpen","true");localStorage.setItem("sectionOpen",JSON.stringify({general:false,visualizationModes:false,rasterBasemap:true,contour:true}));localStorage.setItem("customBasemapSources",JSON.stringify([{id:"custom-basemap-allmaps-'$MAP'",name:"Rumsey · Atlas du plan général de la ville de Paris",url:"https://annotations.allmaps.org/maps/'$MAP'",type:"iiif",role:"overlay",stack:"top",provider:"allmaps"}]));localStorage.setItem("allmapsRemoveColor",JSON.stringify({enabled:false,auto:true,autoGain:0.5,color:"#ffffff",threshold:0.3,hardness:0.7}));"ok"'
CHECK='label[for="allmaps-remove-bg"]'

ab close || true
ab --args "--use-angle=d3d11,--ignore-gpu-blocklist,--enable-gpu-rasterization" set viewport 1280 720
# The storage is written from a same-origin page that is not the app: the
# app saves its own defaults on its first load and would overwrite it.
ab open "http://localhost:5204/@vite/client"
ab eval "$SETUP"

# ── Take A: the atlas over today's imagery, its paper removed automatically ──
# All of Paris at 13.25: the whole sheet in view and few IIIF tiles (Rumsey's
# server takes ~2 s a tile; at 14.3 the sheet was still loading after 2 min).
ab open "http://localhost:5204/?lat=48.856&lng=2.352&zoom=13.25&viewMode=2d&showRasterBasemap=true&basemapSource=esri&overlayBasemapIds=custom-basemap-allmaps-$MAP&showHillshade=false"
ab wait 45000
ab scrollintoview "$CHECK"
ab mouse move 300 400
capture "$OUT/clip-paper.mp4"
ab wait 2500
ab click "$CHECK"      # removal on
ab wait 5500
ab click "$CHECK"      # off: the sheet as scanned
ab wait 1500
ab click "$CHECK"      # on again
ab wait 5000
stop_capture "$OUT/clip-paper.mp4"

# ── Take B: the Iso-line, an iso-slope at 45° with its fill, then contours of the slope ──
ab open "http://localhost:5204/?lat=45.9763&lng=7.6586&zoom=13.2&viewMode=2d&showHillshade=true&showContoursAndGraticules=true&showContours=false&showIsoline=true&isolineMeasure=slope&isolineMode=value&isolineValue=45&isolineFill=true&isolineFillOpacity=0.35&isolineColor=%23ef4444"
ab wait 4000
ab find text "Every interval" hover
ab wait 18000
ab mouse move 400 600
capture "$OUT/clip-isoline.mp4"
ab wait 2000
ab find text "Every interval" click
ab wait 8000
ab find text "At a value" click
ab wait 5000
stop_capture "$OUT/clip-isoline.mp4"
ab close
grep -E "frames, |✗" "$LOG" || true
