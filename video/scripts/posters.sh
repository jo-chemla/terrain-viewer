#!/usr/bin/env bash
# Poster frames for the docs' Demo videos page (docs/public/screenshots/videos/<id>.jpg):
# one frame of each MP4 listed in docs/src/components/demo-videos.tsx, at the second given.
#   ./posters.sh <recordings-dir>       # the directory holding the MP4s (video/recordings or .cache/recordings)
set -e
cd "$(dirname "$0")/.."
SRC="${1:-recordings}"
OUT=../docs/public/screenshots/videos; mkdir -p "$OUT"
[ -d "$HOME/scoop/apps/ffmpeg/current/bin" ] && export PATH="$HOME/scoop/apps/ffmpeg/current/bin:$PATH"
# An MP4 missing from the directory is skipped, not fatal: the cut lives in out/ and the takes in
# .cache/recordings, so no single directory holds them all.
shot() { [ -f "$SRC/$2" ] || { echo "skip $1 (no $SRC/$2)"; return 0; }; ffmpeg -y -loglevel error -ss "$3" -i "$SRC/$2" -frames:v 1 -vf scale=1280:720 -q:v 4 "$OUT/$1.jpg"; echo "$OUT/$1.jpg"; }
shot demo-v5 terrain-viewer-demo-v5-2026-10-14.mp4 5
shot basic-modes-v8 basic-modes-v8-2026-10-14.mp4 12
shot historical-grid-v5 historical-grid-v5-2026-10-14.mp4 40
shot coastline-draw-v1 coastline-draw-v1-2026-10-15.mp4 90
