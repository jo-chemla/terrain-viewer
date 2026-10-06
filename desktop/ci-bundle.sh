#!/usr/bin/env bash
# One desktop bundle, as the GitHub workflow runs it: regenerate the
# Electrobun config for the chosen docs mode, build, add the portable zip
# (Windows, Linux), then move the distributables into out/ renamed as
#   TerrainViewer-<variant>-v<YYYY.MM.DD>-<Setup|Portable>-<platform>.<ext>
# e.g. TerrainViewer-light-online-docs-v2026.10.02-Portable-win-x64.zip. Called twice per
# platform: `ci-bundle.sh bundled with-offline-docs` and
# `ci-bundle.sh online light-online-docs`. Run from desktop/.
#
#   docs     bundled | online   (gen-config.mjs --docs=)
#   variant  the last part of every output name
set -euo pipefail
docs="$1"; variant="$2"

rm -rf build artifacts
node gen-config.mjs --docs="$docs"

if [ "$(uname -s)" != "Darwin" ] && [ "$(uname -s)" != "Linux" ] && [ -z "${COTTONTAIL_NAMED:-}" ]; then
  # cottontail.exe (the Bun-compatible runtime that owns the window) ships
  # with an empty version resource, so Windows names the process, the
  # taskbar tooltip and a pinned icon "cottontail". Stamp the devkit copy
  # Hutch bundles, once per job (both variants build from it); rcedit comes
  # from npm. Harmless if the exe is not found.
  exe=$(find "$USERPROFILE/.hutch/releases/cottontail" -iname cottontail.exe 2>/dev/null | head -n 1 || true)
  if [ -n "$exe" ]; then
    # The npm package has no CLI entry, but ships rcedit-x64.exe; a file
    # version is set too, or Windows reports the strings as empty.
    ico="$PWD/icons/icon.ico"
    ver="${BUILD_VERSION:-$(date -u +%Y.%-m.%-d)}"
    tmp=$(mktemp -d)
    ( cd "$tmp" && npm init -y >/dev/null 2>&1 && npm i --no-save --silent rcedit@5 >/dev/null 2>&1       && "$tmp/node_modules/rcedit/bin/rcedit-x64.exe" "$exe" --set-file-version "$ver" --set-product-version "$ver" --set-version-string FileDescription "Terrain Viewer" --set-version-string ProductName "Terrain Viewer" --set-version-string CompanyName "Iconem" --set-icon "$ico"       && echo "named: $exe ($ver)" ) || echo "rcedit failed (continuing)"
  fi
  export COTTONTAIL_NAMED=1
fi

hutch electrobun build --env=stable

# Hutch names the build folder stable-<platform>: win-x64, macos-arm64, linux-x64.
builddir=$(ls -d build/stable-* | head -n 1)
platform=${builddir#build/stable-}

if [ "$(uname -s)" = "Darwin" ]; then
  # No Apple developer certificate, so no real signature or notarization.
  # An app with NO signature that carries the download quarantine flag is
  # refused as "damaged" on recent macOS, with no way through but
  # `xattr -cr`. An ad-hoc signature (identity "-", no certificate) turns
  # that into "unidentified developer", which System Settings > Privacy &
  # Security > Open Anyway lets through. Hutch has already written the
  # dmg by now, so the signed .app is repacked into a fresh one.
  app=$(find "$builddir" -maxdepth 1 -name "*.app" | head -n 1)
  codesign --force --deep --sign - "$app"
  codesign --verify --deep --strict "$app" && echo "ad-hoc signed: $app"
  rm -f artifacts/*.dmg
  # hdiutil right after Hutch's own dmg step failed once on the runner with
  # no message (the second variant of the run): give it a few tries.
  for attempt in 1 2 3 4; do
    if hdiutil create -volname "Terrain Viewer" -srcfolder "$app" -ov -format UDZO "artifacts/TerrainViewer.dmg"; then break; fi
    echo "hdiutil failed (attempt $attempt), retrying"; sleep 10
    [ "$attempt" = 4 ] && exit 1
  done
else
  # A true portable build. What Hutch leaves in build/<channel>/TerrainViewer
  # is NOT the app: its bin/launcher.exe is the self-extracting installer
  # stub and Resources/ holds the real app as one .tar.zst, which the stub
  # unpacks into %LOCALAPPDATA% (~/.local/share on Linux) on first run.
  # Running that stub from a zip viewer, or anywhere without its payload,
  # fails with "the installer package is incomplete". Unpacking the
  # payload here gives the installed layout (bin/launcher.exe, cottontail,
  # Resources/main.js...), which runs from any folder: verified on Windows
  # 2026-10-01 from C:\tmp. The launcher must stay in bin/ (it finds
  # Resources through ../Resources), so a one-line starter sits at the top.
  stub=$(ls -d "$builddir"/TerrainViewer* | head -n 1)
  payload=$(ls "$stub"/Resources/*.tar.zst | head -n 1)
  rm -rf portable && mkdir -p portable
  python3 -m pip install --quiet --disable-pip-version-check zstandard
  python3 - "$payload" portable <<'PY'
import sys, io, tarfile, zstandard
src, dest = sys.argv[1], sys.argv[2]
with open(src, "rb") as f:
    data = zstandard.ZstdDecompressor().stream_reader(f).read()
tar = tarfile.open(fileobj=io.BytesIO(data))
try:
    tar.extractall(dest, filter="fully_trusted")   # Python 3.12+: keep modes as shipped
except TypeError:
    tar.extractall(dest)
PY
  app=$(ls -d portable/* | head -n 1)
  if [ "$(uname -s)" = "Linux" ]; then
    chmod +x "$app"/bin/* 2>/dev/null || true
    printf '#!/bin/sh\ncd "$(dirname "$0")" && exec bin/launcher "$@"\n' > "$app/terrain-viewer"
    chmod +x "$app/terrain-viewer"
  else
    printf '@echo off\r\nstart "" "%%~dp0bin\\launcher.exe" %%*\r\n' > "$app/Terrain Viewer.cmd"
  fi
  printf 'Terrain Viewer, portable: no installation. Start it with "Terrain Viewer.cmd" (Windows) or ./terrain-viewer (Linux); the program itself is bin/launcher.\nUnzip the whole folder first: starting it from inside the zip viewer runs it without its files.\nhttps://terrain-viewer.iconem.com/docs/features/advanced/desktop/\n' > "$app/README.txt"
  out="$PWD/artifacts/portable.zip"
  ( cd "$(dirname "$app")"
    if command -v zip >/dev/null; then zip -qr "$out" "$(basename "$app")"; else 7z a -tzip -bso0 "$out" "$(basename "$app")"; fi )
fi

if [ "$(uname -s)" != "Darwin" ] && [ "$(uname -s)" != "Linux" ]; then
  # One self-contained Setup.exe instead of Hutch's zip (Setup.exe plus a
  # hidden .installer folder, which fails when the exe is run on its own).
  # Hutch only concatenates the payload into the executable on Linux, but
  # the extractor looks for the same embedded layout on Windows when no
  # adjacent payload exists (package/src/extractor/main.zig):
  #   exe ++ "ELECTROBUN_METADATA_V1" ++ metadata.json ++ "ELECTROBUN_ARCHIVE_V1" ++ archive
  # Verified 2026-10-01: the result installs and launches. Delta patches do
  # not apply to an embedded install; the updater then downloads the full
  # bundle, which is what generatePatch: false makes it do anyway.
  # Named after app.name ("Terrain Viewer-Setup.exe", "Terrain Viewer
  # Light-Setup.exe"): found by glob, not spelled out, since a renamed
  # variant once silently fell back to the zip.
  setup=$(ls "$builddir"/*-Setup.exe 2>/dev/null | head -n 1)
  setup="${setup%.exe}"
  if [ -n "$setup" ] && [ -f "$setup.exe" ] && [ -f "$setup.metadata.json" ] && [ -f "$setup.tar.zst" ]; then
    rm -f artifacts/*-Setup.zip
    { cat "$setup.exe"; printf 'ELECTROBUN_METADATA_V1'; cat "$setup.metadata.json"; printf 'ELECTROBUN_ARCHIVE_V1'; cat "$setup.tar.zst"; } > artifacts/Setup.exe
  fi
fi

# Asset names: TerrainViewer-<variant>-v<YYYY.MM.DD>-<Setup|Portable>-<platform>.<ext>
stamp="v$(date -u +%Y.%m.%d)"
mkdir -p out
for f in artifacts/*; do
  name=$(basename "$f")
  case "$name" in
    *.tar.zst|*update.json)
      # The updater feed: names must stay exactly as Hutch wrote them
      # (stable-<platform>-update.json points at the .tar.zst by name), and
      # only the full build has a feed (gen-config.mjs).
      if [ "$docs" = "bundled" ]; then mv "$f" "out/$name"; fi
      continue ;;
    portable.zip) kind=Portable; ext=zip ;;
    Setup.exe)    kind=Setup; ext=exe ;;
    *.tar.gz)     kind=Setup; ext=tar.gz ;;
    *.dmg)        kind=Setup; ext=dmg ;;   # the macOS installer image
    *)            kind=Setup; ext=${name##*.} ;;
  esac
  mv "$f" "out/TerrainViewer-${variant}-${stamp}-${kind}-${platform}.${ext}"
done
ls -la out
