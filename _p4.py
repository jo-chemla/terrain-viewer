import io, sys
CR, LF = chr(13), chr(10)

def patch(path, pairs):
    raw = io.open(path, encoding="utf-8", newline="").read()
    crlf = (CR + LF) in raw
    s = raw.replace(CR + LF, LF)
    for old, new in pairs:
        if s.count(old) != 1: sys.exit(f"{path}: no single match ({s.count(old)}) for:{LF}{old[:170]}")
        s = s.replace(old, new)
    io.open(path, "w", encoding="utf-8", newline="").write(s.replace(LF, CR + LF) if crlf else s)

patch("docs/scripts/build-url-params.mjs", [
(
'''  { key: "bookmarksGallery", type: "boolean", note: "Opens the Bookmarks gallery modal on arrival." },''',
'''  { key: "bookmarksGallery", type: "boolean", note: "Opens the Bookmarks gallery modal on arrival." },
  { key: "openLibrary", type: "string", note: "terrain | basemap | both - opens that Library modal (the curated dataset list) on arrival." },
  { key: "coverageOverlays", type: "array", items: "string", note: "Coverage footprints drawn on arrival: a group key (mapterhorn, library, basemapLibrary, eli, yourTerrain, yourBasemaps) or a single leaf id; opens Source Info with them." },''',
),
])

patch("docs/content/docs/features/embedding.mdx", [
(
'''| `bookmarksGallery=true` | Opens the Bookmarks gallery modal on arrival. |''',
'''| `bookmarksGallery=true` | Opens the Bookmarks gallery modal on arrival. |
| `openLibrary=terrain` / `basemap` / `both` | Opens the [Library](/features/terrain-sources) modal, the curated list of national and global datasets, on arrival. |
| `coverageOverlays=mapterhorn,library` | Draws those [coverage footprints](/features/coverage-overlays) on the map and opens Source Info, where the picker lives. A group key (`mapterhorn`, `library`, `basemapLibrary`, `eli`, `yourTerrain`, `yourBasemaps`) expands to its leaves; a single leaf id (`lib:<id>`, `blib:<id>`, `terrain:<id>`, `basemap:<id>`, `eli:<id>`) works too. |''',
),
])

patch("docs/content/docs/features/coverage-overlays.mdx", [
(
"## What is offered",
"""A link can turn them on directly: `?coverageOverlays=mapterhorn,library` draws Mapterhorn's own coverage and every terrain-library footprint, and opens Source Info where the picker lives. See [Embedding & URL parameters](/features/embedding).

## What is offered""",
),
])

patch("CHANGELOG.md", [
(
'''### Features''',
'''### Features
- Scrolling over the split gutter or its pill zooms the map underneath instead of doing nothing.
- `?openLibrary=terrain|basemap|both` opens the dataset Library on arrival, and `?coverageOverlays=mapterhorn,library` draws coverage footprints and opens Source Info. The product tour gained two steps for both.''',
),
])
print("ok 4")
