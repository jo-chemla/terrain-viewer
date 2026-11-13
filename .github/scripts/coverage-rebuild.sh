#!/usr/bin/env bash
# Rebuilds the coverage footprints that need no key (Esri Integrated Mesh,
# FLAI open LiDAR, OpenTopography, Bing 3D) and replaces them on the
# dataset-indexes release when they changed. Google 3D is left out: it needs
# an API key and moves rarely. Each script runs alone with a time limit; a
# failure, a file that is not GeoJSON, or one that lost more than 40 % of its
# features keeps the previous file. Prints CHANGED=<n> for the workflow.
set -u
cd "$(dirname "$0")/../.."
changed=0
run() { # name, command...
  local name=$1; shift
  local f="public/coverage/$name.geojson"
  local before=0
  [ -f "$f" ] && before=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).features.length)' "$f" 2>/dev/null || echo 0)
  cp -f "$f" "/tmp/$name.bak" 2>/dev/null
  echo "::group::$name (was $before features)"
  if ! timeout 40m "$@"; then
    echo "::warning title=coverage::$name: the build failed or timed out; the previous file stays"
    cp -f "/tmp/$name.bak" "$f" 2>/dev/null; echo "::endgroup::"; return
  fi
  local after
  after=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).features.length)' "$f" 2>/dev/null || echo 0)
  if [ "$after" -eq 0 ] || [ $((after * 10)) -lt $((before * 6)) ]; then
    echo "::warning title=coverage::$name: $after features against $before before; refused, the previous file stays"
    cp -f "/tmp/$name.bak" "$f" 2>/dev/null; echo "::endgroup::"; return
  fi
  if cmp -s "$f" "/tmp/$name.bak"; then
    echo "$name: unchanged ($after features)"
  else
    node scripts/dataset-assets.mjs push --rolling "$f" && changed=$((changed + 1))
    echo "::notice title=coverage::$name: $before -> $after features, uploaded"
  fi
  echo "::endgroup::"
}
run esri-3d node docs/scripts/build-esri-3d-coverage.mjs
run flai-open-lidar node docs/scripts/build-flai-coverage.mjs
run opentopo-raster node scripts/build-opentopo-coverage.mjs
# the OpenTopography script writes both files; the second is compared on its own
run opentopo-pointcloud true
run bing-3d node docs/scripts/build-bing-3d-coverage.mjs
echo "CHANGED=$changed" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "coverage: $changed file(s) replaced on the release"
