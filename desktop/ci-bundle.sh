#!/usr/bin/env bash
# One desktop bundle, as the GitHub workflow runs it: regenerate the
# Electrobun config for the chosen docs mode, build, add the portable zip
# (Windows, Linux), then move the distributables into out/ with a suffix in
# their names. Called twice per platform: `ci-bundle.sh <label> bundled ""`
# and `ci-bundle.sh <label> online -online-doc`. Run from desktop/.
#
#   label   windows-x64 | macos-arm64 | linux-x64 (the runner's name for itself)
#   docs    bundled | online          (gen-config.mjs --docs=)
#   suffix  inserted before the extension of every file moved into out/
set -euo pipefail
label="$1"; docs="$2"; suffix="${3:-}"

rm -rf build artifacts
node gen-config.mjs --docs="$docs"
hutch electrobun build --env=stable

if [ "$(uname -s)" != "Darwin" ]; then
  # The application folder itself, zipped: unpack anywhere and run
  # bin/launcher.exe (bin/launcher on Linux). Electrobun has no single-file
  # executable; this is the closest thing. On macOS the .dmg already holds
  # the .app. Windows' Git Bash has no `zip`; 7-Zip is on the runner.
  app=$(ls -d build/stable-*/TerrainViewer* | head -n 1)
  out="$PWD/artifacts/terrain-viewer-portable-${label}.zip"
  ( cd "$(dirname "$app")"
    if command -v zip >/dev/null; then zip -qr "$out" "$(basename "$app")"; else 7z a -tzip -bso0 "$out" "$(basename "$app")"; fi )
fi

mkdir -p out
for f in artifacts/*; do
  name=$(basename "$f")
  case "$name" in
    *.tar.zst|*update.json) continue ;;                 # the updater feed, not a download
    *.tar.gz) dest="${name%.tar.gz}${suffix}.tar.gz" ;;
    *.*)      dest="${name%.*}${suffix}.${name##*.}" ;;
    *)        dest="${name}${suffix}" ;;
  esac
  mv "$f" "out/$dest"
done
ls -la out
