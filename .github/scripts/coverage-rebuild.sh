#!/usr/bin/env bash
# Rebuilds the coverage footprints that need no key (Esri Integrated Mesh,
# FLAI open LiDAR, OpenTopography, Bing 3D) and replaces them on the
# dataset-indexes release when they changed. Google 3D is left out: it needs
# an API key and moves rarely. Each script runs alone with a time limit; a
# failure, a file that is not GeoJSON, or one that lost more than 40 % of its
# features keeps the previous file. Prints CHANGED=<n> for the workflow.
#
# Versioned: each replaced file is also kept on the release as
# <name>.<YYYY-MM>.geojson, and coverage-history.json (an asset of the same
# release) gains one line per source and month: features before and after,
# how many are new and how many went away. The current file stays under its
# plain name, which is what the site reads.
set -u
cd "$(dirname "$0")/../.."
changed=0
month=$(date -u +%Y-%m)
release=dataset-indexes
repo=Iconem/terrain-viewer
history=/tmp/coverage-history.json
curl -fsSL "https://github.com/$repo/releases/download/$release/coverage-history.json" -o "$history" 2>/dev/null || echo '[]' > "$history"
# new and gone features between two GeoJSON files, a feature being its
# geometry and properties as written
diffcount() {
  node -e '
    const fs = require("fs")
    const keys = (p) => { try { return new Set(JSON.parse(fs.readFileSync(p, "utf8")).features.map((f) => JSON.stringify([f.geometry, f.properties]))) } catch { return new Set() } }
    const a = keys(process.argv[1]), b = keys(process.argv[2])
    let added = 0, removed = 0
    for (const k of b) if (!a.has(k)) added++
    for (const k of a) if (!b.has(k)) removed++
    console.log(added + " " + removed)' "$1" "$2"
}
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
    read -r added removed < <(diffcount "/tmp/$name.bak" "$f")
    cp -f "$f" "/tmp/$name.$month.geojson"
    gh release upload "$release" "/tmp/$name.$month.geojson" -R "$repo" --clobber
    node -e '
      const fs = require("fs"), [p, month, name, before, after, added, removed] = process.argv.slice(1)
      const h = JSON.parse(fs.readFileSync(p, "utf8")).filter((e) => !(e.month === month && e.source === name))
      h.push({ month, source: name, before: +before, after: +after, added: +added, removed: +removed, snapshot: name + "." + month + ".geojson" })
      fs.writeFileSync(p, JSON.stringify(h, null, 1) + "
")' "$history" "$month" "$name" "$before" "$after" "$added" "$removed"
    echo "::notice title=coverage::$name: $before -> $after features ($added new, $removed gone), uploaded with a $month snapshot"
  fi
  echo "::endgroup::"
}
run esri-3d node docs/scripts/build-esri-3d-coverage.mjs
run flai-open-lidar node docs/scripts/build-flai-coverage.mjs
run opentopo-raster node scripts/build-opentopo-coverage.mjs
# the OpenTopography script writes both files; the second is compared on its own
run opentopo-pointcloud true
run bing-3d node docs/scripts/build-bing-3d-coverage.mjs
[ "$changed" -gt 0 ] && gh release upload "$release" "$history" -R "$repo" --clobber
echo "CHANGED=$changed" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "coverage: $changed file(s) replaced on the release"
