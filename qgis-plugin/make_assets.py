"""The pictures and the catalog snapshot the Terrain Viewer plugin carries in
terrain_viewer/assets/, so the panel shows ramp and matcap previews and the
modes tree without asking anything at runtime (and with no tile service at
all, for the Python backend):

- colorramps.png + colorramps.json: every color ramp of the app
  (lib/color-ramps.ts) as a 96x12 strip, one under the other, drawn by the
  tile service's /colorramps/{id}.png (the app's own ramp code).
- matcaps.png + matcaps.json: every matcap of the app (lib/matcap-textures.ts:
  its two pictures from public/, Potree's from GitHub), 48x48 each, in a
  column.
- catalog.json: the panel tree of /processes?expand=true (each mode's
  forms, settings, defaults; as service.mode_of_process reads it), the ramp
  ids and names, every parameter name the modes take, and /terrain-sources (id,
  name, type, address, zoom, bounds, key), trimmed.

Needs a running tile service (cd tile-server && pnpm start, or the desktop
app's) and Pillow:

    python make_assets.py [http://localhost:3400]

Run it when the app's ramps, matcaps, modes or sources change, then commit
terrain_viewer/assets/."""
import io
import json
import os
import re
import sys
import urllib.request

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "terrain_viewer", "assets")
sys.path.insert(0, HERE)

RAMP_W, RAMP_H = 96, 12
MATCAP = 48
UA = {"User-Agent": "terrain-viewer-make-assets"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def get_json(url):
    return json.loads(get(url).decode("utf-8"))


def clean_enum(values):
    """The generator once left `live" as const` in an inline literal."""
    return [str(v).split('"')[0].strip() for v in values]


def mode_of_process(p):
    """service.mode_of_process without QGIS (the same fields)."""
    settings = []
    for key, spec in (p.get("inputs") or {}).items():
        if spec.get("x-tv-role") != "setting":
            continue
        schema = spec.get("schema") or {}
        s = {"key": spec.get("x-tv-url-param", key), "type": spec.get("x-tv-type") or schema.get("type", "string")}
        if schema.get("enum"):
            s["enum"] = clean_enum(schema["enum"])
        for k in ("default", "minimum", "maximum"):
            if k in schema:
                s[k] = schema[k]
        if spec.get("description") and spec["description"] != "--":
            s["note"] = spec["description"][:240]
        settings.append(s)
    mode = {"id": p["id"], "name": p.get("title", p["id"]), "form": p.get("x-tv-form", "raster"),
            "shading": p.get("x-tv-shading", False), "vector": p.get("x-tv-vector", False),
            "switches": p.get("x-tv-switches", {}), "settings": settings}
    if p.get("x-tv-opacity-key"):
        mode["opacityKey"] = p["x-tv-opacity-key"]
        op = (p.get("inputs") or {}).get(p["x-tv-opacity-key"], {}).get("schema", {})
        if "default" in op:
            mode["opacityDefault"] = op["default"]
    if p.get("x-tv-values"):
        mode["values"] = p["x-tv-values"]
    return mode


def tree_of(groups, modes):
    out = []
    for g in groups:
        node = {k: g[k] for k in ("group",) if g.get(k)}
        if g.get("groups"):
            node["groups"] = tree_of(g["groups"], modes)
        if g.get("items"):
            node["items"] = [modes[i] for i in g["items"] if i in modes]
        out.append(node)
    return out


def catalog(base):
    listing = get_json(f"{base}/processes?expand=true")
    modes = {p["id"]: mode_of_process(p) for p in listing.get("processes", [])}
    inputs = sorted({spec.get("x-tv-url-param", k) for p in listing.get("processes", []) for k, spec in (p.get("inputs") or {}).items()})
    ramps = get_json(f"{base}/colorramps").get("colorramps", [])
    keep = ("id", "name", "type", "url", "maxzoom", "bounds", "key", "resolutionM")
    sources = [{k: s[k] for k in keep if k in s} for s in get_json(f"{base}/terrain-sources").get("sources", [])]
    return {"tree": tree_of(listing.get("x-tv-groups", []), modes), "inputs": inputs,
            "colorramps": [{"id": r["id"], "name": r.get("name", r["id"])} for r in ramps], "sources": sources}, ramps


def ramp_sprite(base, ramps):
    sheet = Image.new("RGBA", (RAMP_W, RAMP_H * len(ramps)), (0, 0, 0, 0))
    ids = []
    for i, r in enumerate(ramps):
        rid = r["id"]
        img = Image.open(io.BytesIO(get(f"{base}/colorramps/{urllib.request.quote(rid)}.png?width={RAMP_W}&height={RAMP_H}"))).convert("RGBA")
        if img.size != (RAMP_W, RAMP_H):
            img = img.resize((RAMP_W, RAMP_H))
        sheet.paste(img, (0, i * RAMP_H))
        ids.append(rid)
    sheet.save(os.path.join(OUT, "colorramps.png"), optimize=True)
    with open(os.path.join(OUT, "colorramps.json"), "w", encoding="utf-8") as f:
        json.dump({"width": RAMP_W, "height": RAMP_H, "ids": ids}, f, indent=0)
    return len(ids)


def matcap_sprite():
    ts = open(os.path.join(ROOT, "lib", "matcap-textures.ts"), encoding="utf-8").read()
    base = re.search(r'const BASE_URL = "([^"]+)"', ts).group(1)
    normal = re.search(r'const NORMAL_SPHERE_MATCAP_URL = "([^"]+)"', ts).group(1)
    entries = []
    for m in re.finditer(r'\{ id: "([^"]+)", name: "([^"]+)", url: (NORMAL_SPHERE_MATCAP_URL|"[^"]+"|`[^`]+`) \}', ts):
        tid, name, url = m.groups()
        url = url.strip()
        if url == "NORMAL_SPHERE_MATCAP_URL":
            url = normal
        url = url.strip('"`').replace("${BASE_URL}", base)
        entries.append((tid, name, url))
    sheet = Image.new("RGB", (MATCAP, MATCAP * len(entries)), (0, 0, 0))
    for i, (tid, name, url) in enumerate(entries):
        data = open(os.path.join(ROOT, "public", url.lstrip("/")), "rb").read() if url.startswith("/") else get(url)
        img = Image.open(io.BytesIO(data)).convert("RGB").resize((MATCAP, MATCAP), Image.LANCZOS)
        sheet.paste(img, (0, i * MATCAP))
    sheet.save(os.path.join(OUT, "matcaps.png"), optimize=True)
    default = re.search(r'DEFAULT_MATCAP_ID = "([^"]+)"', ts).group(1)
    with open(os.path.join(OUT, "matcaps.json"), "w", encoding="utf-8") as f:
        json.dump({"size": MATCAP, "default": default, "items": [{"id": t, "name": n} for t, n, _ in entries]}, f, indent=0)
    return len(entries)


def main():
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3400").rstrip("/")
    os.makedirs(OUT, exist_ok=True)
    cat, ramps = catalog(base)
    with open(os.path.join(OUT, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(cat, f, separators=(",", ":"))
    n_ramps = ramp_sprite(base, ramps)
    n_matcaps = matcap_sprite()
    for name in sorted(os.listdir(OUT)):
        print(f"{name:18} {os.path.getsize(os.path.join(OUT, name)) / 1024:7.1f} KB")
    print(f"{n_ramps} ramps, {n_matcaps} matcaps, {sum(1 for _ in walk(cat['tree']))} modes, {len(cat['sources'])} sources")


def walk(groups):
    for g in groups:
        yield from walk(g.get("groups", []))
        yield from g.get("items", [])


if __name__ == "__main__":
    main()
