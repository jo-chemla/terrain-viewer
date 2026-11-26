"""terrain_viewer/assets/app_defaults.json: what the panel needs to read an
app link the way the app reads it, with no tile service (the Python backend):

- defaults: every URL parameter of the app with its default, from
  docs/src/generated/url-params.json (scanned from QUERY_STATE_PARSERS in
  components/TerrainViewer.tsx by docs/scripts/build-url-params.mjs: run
  `pnpm run url-params` first when the app's parameters changed). A link
  that leaves a parameter out means its default: showTerrainAnalysis=true
  alone shows the slope, since showSlope defaults to true.
- basemaps: the app's built-in basemaps with a fixed tile address
  (lib/basemap-sources.ts): the choices of the panel's Basemap row (a keyed
  one, `apiKey`, offered once the panel holds that key), which a link's
  showRasterBasemap=true also drives.

No service needed:

    python make_app_defaults.py

Run it when the app's URL parameters or built-in basemaps change, then
commit terrain_viewer/assets/app_defaults.json."""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "terrain_viewer", "assets", "app_defaults.json")


def defaults():
    with open(os.path.join(ROOT, "docs", "src", "generated", "url-params.json"), encoding="utf-8") as f:
        params = json.load(f)["params"]
    return {p["key"]: p["default"] for p in params if "default" in p and isinstance(p["default"], (bool, int, float, str))}


def basemaps():
    with open(os.path.join(ROOT, "lib", "basemap-sources.ts"), encoding="utf-8") as f:
        text = f.read()
    out = []
    for line in text.splitlines():
        if not re.match(r"\s*\{\s*id:", line):
            continue
        entry = {k: v for k, v in re.findall(r'(\w+):\s*"([^"]*)"', line)}
        z = re.search(r"maxzoom:\s*(\d+)", line)
        out.append({"id": entry["id"], "name": entry.get("name", entry["id"]), "url": entry["url"],
                    "maxzoom": int(z.group(1)) if z else 19, **({"apiKey": entry["apiKey"]} if "apiKey" in entry else {})})
    return out


def main():
    data = {"defaults": defaults(), "basemaps": basemaps()}
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=1, sort_keys=False)
        f.write("\n")
    print(f"wrote {OUT}: {len(data['defaults'])} parameters, {len(data['basemaps'])} basemaps")


if __name__ == "__main__":
    main()
