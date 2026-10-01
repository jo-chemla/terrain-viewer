#!/usr/bin/env bash
# One desktop bundle, as the GitHub workflow runs it: regenerate the
# Electrobun config for the chosen docs mode, build, add the portable zip
# (Windows, Linux), then move the distributables into out/ renamed as
#   TerrainViewer-<Setup|Portable>-<platform>-<variant>.<ext>
# e.g. TerrainViewer-Setup-win-x64-with-offline-docs.zip. Called twice per
# platform: `ci-bundle.sh bundled with-offline-docs` and
# `ci-bundle.sh online light-online-docs`. Run from desktop/.
#
#   docs     bundled | online   (gen-config.mjs --docs=)
#   variant  the last part of every output name
set -euo pipefail
docs="$1"; variant="$2"

rm -rf build artifacts
node gen-config.mjs --docs="$docs"
hutch electrobun build --env=stable

# Hutch names the build folder stable-<platform>: win-x64, macos-arm64, linux-x64.
builddir=$(ls -d build/stable-* | head -n 1)
platform=${builddir#build/stable-}

if [ "$(uname -s)" != "Darwin" ]; then
  # The application folder itself, zipped: unpack anywhere and run
  # bin/launcher.exe (bin/launcher on Linux). Electrobun has no single-file
  # executable; this is the closest thing. On macOS the .dmg already holds
  # the .app. Windows' Git Bash has no `zip`; 7-Zip is on the runner.
  app=$(ls -d "$builddir"/TerrainViewer* | head -n 1)
  out="$PWD/artifacts/portable.zip"
  ( cd "$(dirname "$app")"
    if command -v zip >/dev/null; then zip -qr "$out" "$(basename "$app")"; else 7z a -tzip -bso0 "$out" "$(basename "$app")"; fi )
fi

mkdir -p out
for f in artifacts/*; do
  name=$(basename "$f")
  case "$name" in
    *.tar.zst|*update.json) continue ;;   # the updater feed, not a download
    portable.zip) kind=Portable; ext=zip ;;
    *.tar.gz)     kind=Setup; ext=tar.gz ;;
    *.dmg)        kind=Setup; ext=dmg ;;   # the macOS installer image
    *)            kind=Setup; ext=${name##*.} ;;
  esac
  mv "$f" "out/TerrainViewer-${kind}-${platform}-${variant}.${ext}"
done
ls -la out
