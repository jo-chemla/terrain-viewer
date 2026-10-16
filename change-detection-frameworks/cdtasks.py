#!/usr/bin/env python
"""cdtasks: plan, build and export before/after change detection annotation jobs
over any number of dated raster sources, chipped by TiTiler, in CVAT, Label Studio or labelme.

  python cdtasks.py plan  --sources sources.json --aoi 23.84,40.82,23.85,40.83 --aoi-crs EPSG:4326 --gsd 0.5 --chip 1024 --overlap 0.1 --pairs consecutive -o jobs.json
  python cdtasks.py build cvat|labelstudio|labelme jobs.json
  python cdtasks.py export cvat|labelstudio|labelme jobs.json -o merged.geojson [--dissolve]
  python cdtasks.py cvat-stage jobs.json --stage validation --assignee reviewer   # hand the jobs to review

sources.json:
  {"titiler": {"servers": "http://host.docker.internal:8010", "local": "http://127.0.0.1:8010"},
   "cvat_shim": "http://host.docker.internal:8020",
   "classes": ["no-change", "destruction", "construction", "modification"],
   "sources": [{"id": "esri_world_imagery", "date": "2010-01-01", "url": "/data/esri_tms18.xml"},
               {"id": "amphipolis_dsm_10cm", "date": "2024-05-01", "url": "https://.../dsm_cog.tif", "params": "rescale=80,200&colormap_name=terrain"},
               {"id": "amphipolis_rgb_10cm", "date": "2024-06-01", "url": "https://.../cog.tif"}]}
`params` is appended to every TiTiler request for that source: rescale and colormap for float rasters, bidx for band order.
`url` is anything GDAL opens through TiTiler: a COG, a local file in the TiTiler container, a GDAL TMS/WMS XML.
An AOI smaller than one chip gives a single cell centred on it, so the single-task case is the same command.
"""
import argparse, json, math, os, pathlib, re, sys, zipfile
from urllib.parse import quote

R = 6378137.0
CRS = "EPSG:3857"

# ----------------------------------------------------------------------------- geometry helpers
def lnglat_to_merc(lng, lat):
    return math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R

def merc_to_lat(y):
    return math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)

def parse_aoi(aoi, aoi_crs):
    """bbox string or GeoJSON path -> (minx, miny, maxx, maxy) in EPSG:3857"""
    if os.path.exists(aoi):
        gj = json.loads(pathlib.Path(aoi).read_text())
        coords = []
        def walk(c):
            if isinstance(c[0], (int, float)): coords.append(c)
            else: [walk(x) for x in c]
        feats = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
        for f in feats: walk((f.get("geometry") or f)["coordinates"])
        xs, ys = zip(*[(c[0], c[1]) for c in coords]); box = (min(xs), min(ys), max(xs), max(ys))
    else:
        box = tuple(float(v) for v in aoi.split(","))
    if aoi_crs.upper() in ("EPSG:4326", "WGS84"):
        x0, y0 = lnglat_to_merc(box[0], box[1]); x1, y1 = lnglat_to_merc(box[2], box[3]); box = (x0, y0, x1, y1)
    elif aoi_crs.upper() != CRS:
        from pyproj import Transformer
        t = Transformer.from_crs(aoi_crs, CRS, always_xy=True)
        x0, y0 = t.transform(box[0], box[1]); x1, y1 = t.transform(box[2], box[3]); box = (x0, y0, x1, y1)
    return box

def chip_url(base, src, bbox, w, h, fmt, params=""):
    """params: extra TiTiler query, e.g. "rescale=80,200&colormap_name=terrain" for a float DSM, "bidx=4&bidx=3&bidx=2" for a band order"""
    return f"{base}/cog/bbox/{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}/{w}x{h}.{fmt}?url={src}&coord_crs={CRS}&dst_crs={CRS}" + (f"&{params}" if params else "")

# ----------------------------------------------------------------------------- plan
def cmd_plan(a):
    cfg = json.loads(pathlib.Path(a.sources).read_text())
    srcs = sorted(cfg["sources"], key=lambda s: s["date"])
    minx, miny, maxx, maxy = parse_aoi(a.aoi, a.aoi_crs)
    lat = merc_to_lat((miny + maxy) / 2)
    # ground sample distance -> Web Mercator pixel size at this latitude
    res = a.gsd / math.cos(math.radians(lat)) if a.gsd else 2 * math.pi * R / 256 / 2 ** a.zoom
    chip_m = res * a.chip
    step = chip_m * (1 - a.overlap)
    w_m, h_m = maxx - minx, maxy - miny
    if w_m <= chip_m and h_m <= chip_m:                      # single task: one chip centred on the AOI
        cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
        origins = [(cx - chip_m / 2, cy + chip_m / 2)]; ncol = nrow = 1
    else:
        ncol = max(1, math.ceil((w_m - chip_m) / step) + 1); nrow = max(1, math.ceil((h_m - chip_m) / step) + 1)
        origins = [(minx + c * step, maxy - r * step) for r in range(nrow) for c in range(ncol)]
    cells = []
    for i, (ox, oy) in enumerate(origins):
        r, c = divmod(i, ncol)
        bbox = [ox, oy - chip_m, ox + chip_m, oy]
        cells.append({"cell_id": f"{a.name}_r{r:02d}c{c:02d}", "row": r, "col": c, "bbox": bbox,
                      "geotransform": [ox, res, 0.0, oy, 0.0, -res]})
    if a.pairs == "consecutive": pairs = [(srcs[i]["id"], srcs[i + 1]["id"]) for i in range(len(srcs) - 1)]
    elif a.pairs == "all": pairs = [(x["id"], y["id"]) for i, x in enumerate(srcs) for y in srcs[i + 1:]]
    else: pairs = [tuple(p.split(":")) for p in a.pairs.split(",")]
    by_id = {s["id"]: s for s in srcs}
    T = cfg["titiler"]
    def images(cell, s, k):
        return {"id": s["id"], "date": s["date"], "index": k,
                "url": chip_url(T["servers"], s["url"], cell["bbox"], a.chip, a.chip, "png", s.get("params", "")),
                "url_local": chip_url(T["local"], s["url"], cell["bbox"], a.chip, a.chip, "png", s.get("params", "")),
                "tif_local": chip_url(T["local"], s["url"], cell["bbox"], a.chip, a.chip, "tif", s.get("params", ""))}
    units = []
    for cell in cells:
        cell["dates"] = [images(cell, s, k) for k, s in enumerate(srcs)]
        for b, af in pairs:
            units.append({"unit_id": f"{cell['cell_id']}__{b}__{af}", "cell_id": cell["cell_id"],
                          "before": next(d for d in cell["dates"] if d["id"] == b),
                          "after": next(d for d in cell["dates"] if d["id"] == af)})
    jobs = {"name": a.name, "crs": CRS, "chip": a.chip, "gsd_m": a.gsd, "pixel_size_m": res, "overlap": a.overlap,
            "aoi": [minx, miny, maxx, maxy], "grid": [nrow, ncol], "classes": cfg.get("classes", ["change"]),
            "cvat_shim": cfg.get("cvat_shim"), "sources": srcs, "cells": cells, "units": units}
    pathlib.Path(a.out).write_text(json.dumps(jobs, indent=1))
    print(f"{len(cells)} cells ({nrow}x{ncol}) x {len(pairs)} pairs = {len(units)} units, chip {a.chip}px = {chip_m:.0f} m, "
          f"{res:.3f} m/px in {CRS} ({a.gsd or 'zoom ' + str(a.zoom)} requested) -> {a.out}")

# ----------------------------------------------------------------------------- build
def frame_name(jobs, cell, d):
    return f"{cell['cell_id']}__{d['index']:02d}__{d['date']}__{d['id']}.png"

def build_cvat(jobs, a):
    from cvat_sdk import make_client
    from cvat_sdk.core.proxies.tasks import ResourceType
    shim = jobs["cvat_shim"]; dates = len(jobs["sources"])
    attr = {"name": "drawn_on", "mutable": False, "input_type": "select", "default_value": jobs["sources"][-1]["id"],
            "values": [s["id"] for s in jobs["sources"]]}
    labels = [{"name": c, "type": "polygon", "attributes": [attr]} for c in jobs["classes"]]
    created = []
    with make_client(os.environ.get("CVAT_URL", "http://localhost:8085"), credentials=(os.environ["CVAT_USER"], os.environ["CVAT_PASS"])) as client:
        for cell in jobs["cells"]:
            if a.layout == "series":                       # one job per cell, all dates, flicker along the timeline
                seq = cell["dates"]; seg = dates
            else:                                          # consecutive pairs as two-frame jobs: 1,2,2,3,3,4...
                seq = [d for i, d in enumerate(cell["dates"]) for _ in range(2 if 0 < i < dates - 1 else 1)]; seg = 2
            remote = [f"{shim}/{frame_name(jobs, cell, d)}?u={quote(d['url_local'], safe='')}" for d in seq]
            # CVAT rejects duplicate file names: suffix the repeated frame of the pairs layout
            seen = {}; fixed = []
            for u in remote:
                n = u.split("?")[0]; seen[n] = seen.get(n, 0) + 1
                fixed.append(u if seen[n] == 1 else u.replace(".png?", f"__dup{seen[n]}.png?"))
            spec = {"name": f"{jobs['name']} {cell['cell_id']}", "labels": labels, "segment_size": seg}
            task = client.tasks.create_from_data(spec=spec, resource_type=ResourceType.REMOTE, resources=fixed,
                                                 data_params={"image_quality": 100, "sorting_method": "predefined"})
            created.append({"cell_id": cell["cell_id"], "task_id": task.id}); print("cvat task", task.id, cell["cell_id"], "frames", task.size)
    pathlib.Path(a.state).write_text(json.dumps({"cvat": created}, indent=1))

def ls_config(jobs):
    labels = "".join(f'<Label value="{c}"/>' for c in jobs["classes"])
    return f"""<View>
  <Header value="$unit_id : before = $before_id ($before_date), after = $after_id ($after_date)"/>
  <View style="display:flex; gap:8px">
    <View style="flex:1"><Header value="BEFORE"/><Image name="before" value="$before" zoom="true" zoomControl="true" rotateControl="false"/></View>
    <View style="flex:1"><Header value="AFTER"/><Image name="after" value="$after" zoom="true" zoomControl="true" rotateControl="false"/></View>
  </View>
  <PolygonLabels name="change_before" toName="before" strokeWidth="2">{labels}</PolygonLabels>
  <PolygonLabels name="change_after" toName="after" strokeWidth="2">{labels}</PolygonLabels>
</View>"""

def build_labelstudio(jobs, a):
    from label_studio_sdk.client import LabelStudio
    ls = LabelStudio(base_url=os.environ.get("LS_URL", "http://127.0.0.1:8081"), api_key=os.environ["LS_API_KEY"])
    project = ls.projects.create(title=f"Change detection {jobs['name']}", label_config=ls_config(jobs))
    cells = {c["cell_id"]: c for c in jobs["cells"]}
    tasks = [{"data": {"unit_id": u["unit_id"], "cell_id": u["cell_id"], "crs": jobs["crs"],
                       "geotransform": cells[u["cell_id"]]["geotransform"],
                       "before": u["before"]["url_local"], "before_id": u["before"]["id"], "before_date": u["before"]["date"],
                       "after": u["after"]["url_local"], "after_id": u["after"]["id"], "after_date": u["after"]["date"]}}
             for u in jobs["units"]]
    r = ls.projects.import_tasks(id=project.id, request=tasks)
    print("label studio project", project.id, "tasks", r.task_count)
    pathlib.Path(a.state).write_text(json.dumps({"labelstudio": {"project_id": project.id}}, indent=1))

def build_labelme(jobs, a):
    import requests
    root = pathlib.Path(a.labelme_dir) / jobs["name"]; root.mkdir(parents=True, exist_ok=True)
    (root / "labels.txt").write_text("__ignore__\n" + "\n".join(jobs["classes"]) + "\n")
    for cell in jobs["cells"]:
        d = root / cell["cell_id"]; d.mkdir(exist_ok=True)
        for img in cell["dates"]:
            f = d / frame_name(jobs, cell, img).replace(".png", ".tif")
            if not f.exists():
                r = requests.get(img["tif_local"], timeout=300); r.raise_for_status(); f.write_bytes(r.content)
        (d / "cell.json").write_text(json.dumps(cell, indent=1))
        print("labelme folder", d, len(cell["dates"]), "GeoTIFFs")
    print(f"run: python -m labelme {root}/<cell> --labels {root/'labels.txt'}   (A/D walks the dates)")
    pathlib.Path(a.state).write_text(json.dumps({"labelme": {"root": str(root)}}, indent=1))

def cmd_build(a):
    jobs = json.loads(pathlib.Path(a.jobs).read_text())
    {"cvat": build_cvat, "labelstudio": build_labelstudio, "labelme": build_labelme}[a.tool](jobs, a)

# ----------------------------------------------------------------------------- export
def feature(jobs, cell, ring_px, label, drawn_on, before, after, extra):
    gt = cell["geotransform"]
    ring = [[gt[0] + x * gt[1] + y * gt[2], gt[3] + x * gt[4] + y * gt[5]] for x, y in ring_px]
    if ring[0] != ring[-1]: ring.append(ring[0])
    props = {"class": label, "drawn_on": drawn_on, "cell_id": cell["cell_id"],
             "before_id": before["id"] if before else None, "before_date": before["date"] if before else None,
             "after_id": after["id"] if after else None, "after_date": after["date"] if after else None, **extra}
    return {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props}

def parse_frame(name):
    m = re.match(r"(?P<cell>.+?)__(?P<idx>\d\d)__(?P<date>[^_]+)__(?P<id>.+?)(__dup\d)?\.png$", name)
    return m.groupdict() if m else None

def export_cvat(jobs, a):
    import xml.etree.ElementTree as ET
    from cvat_sdk import make_client
    state = json.loads(pathlib.Path(a.state).read_text())["cvat"]
    cells = {c["cell_id"]: c for c in jobs["cells"]}; feats = []
    tmp = pathlib.Path(a.workdir); tmp.mkdir(exist_ok=True)
    with make_client(os.environ.get("CVAT_URL", "http://localhost:8085"), credentials=(os.environ["CVAT_USER"], os.environ["CVAT_PASS"])) as client:
        for s in state:
            z = tmp / f"cvat_{s['task_id']}.zip"; z.unlink(missing_ok=True)
            client.tasks.retrieve(s["task_id"]).export_dataset("CVAT for images 1.1", z, include_images=False)
            root = ET.fromstring(zipfile.ZipFile(z).read("annotations.xml"))
            for img in root.iter("image"):
                fr = parse_frame(img.get("name")); cell = cells[fr["cell"]]
                this = cell["dates"][int(fr["idx"])]
                prev = cell["dates"][int(fr["idx"]) - 1] if int(fr["idx"]) > 0 else None
                for poly in img.iter("polygon"):
                    pts = [tuple(map(float, p.split(","))) for p in poly.get("points").split(";")]
                    attrs = {x.get("name"): x.text for x in poly.iter("attribute")}
                    drawn = attrs.get("drawn_on", this["id"])
                    feats.append(feature(jobs, cell, pts, poly.get("label"), drawn, prev, this, {"cvat_task": s["task_id"], "frame": img.get("name")}))
    return feats

def export_labelstudio(jobs, a):
    import requests
    pid = json.loads(pathlib.Path(a.state).read_text())["labelstudio"]["project_id"]
    base = os.environ.get("LS_URL", "http://127.0.0.1:8081")
    r = requests.get(f"{base}/api/projects/{pid}/export", params={"exportType": "JSON"}, headers={"Authorization": f"Token {os.environ['LS_API_KEY']}"}, timeout=300)
    r.raise_for_status(); cells = {c["cell_id"]: c for c in jobs["cells"]}; units = {u["unit_id"]: u for u in jobs["units"]}; feats = []
    for task in r.json():
        u = units[task["data"]["unit_id"]]; cell = cells[u["cell_id"]]
        for ann in task.get("annotations", []):
            for res in ann["result"]:
                if res["type"] != "polygonlabels": continue
                pts = [(x / 100 * res["original_width"], y / 100 * res["original_height"]) for x, y in res["value"]["points"]]
                drawn = u["before"]["id"] if res["to_name"] == "before" else u["after"]["id"]
                feats.append(feature(jobs, cell, pts, res["value"]["polygonlabels"][0], drawn, u["before"], u["after"], {"ls_task": task["id"]}))
    return feats

def export_labelme(jobs, a):
    root = pathlib.Path(json.loads(pathlib.Path(a.state).read_text())["labelme"]["root"])
    cells = {c["cell_id"]: c for c in jobs["cells"]}; feats = []
    for jf in root.rglob("*.json"):
        if jf.name == "cell.json": continue
        data = json.loads(jf.read_text()); fr = parse_frame(data["imagePath"].replace(".tif", ".png"))
        if not fr: continue
        cell = cells[fr["cell"]]; this = cell["dates"][int(fr["idx"])]; prev = cell["dates"][int(fr["idx"]) - 1] if int(fr["idx"]) > 0 else None
        for s in data["shapes"]:
            if s["shape_type"] not in ("polygon", "rectangle"): continue
            pts = s["points"]
            if s["shape_type"] == "rectangle": (x0, y0), (x1, y1) = pts; pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            feats.append(feature(jobs, cell, pts, s["label"], this["id"], prev, this, {"labelme_file": jf.name}))
    return feats

def dissolve(feats):
    """Merge polygons that touch across cell overlaps when class, before and after match."""
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    groups = {}
    for f in feats:
        p = f["properties"]; groups.setdefault((p["class"], p["before_id"], p["after_id"], p["drawn_on"]), []).append(f)
    out = []
    for key, fs in groups.items():
        merged = unary_union([shape(f["geometry"]) for f in fs])
        polys = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
        for g in polys:
            props = {k: v for k, v in fs[0]["properties"].items() if k not in ("cell_id", "frame", "cvat_task", "ls_task", "labelme_file")}
            props["n_source_polygons"] = sum(1 for f in fs if shape(f["geometry"]).intersects(g))
            out.append({"type": "Feature", "geometry": mapping(g), "properties": props})
    return out

def cmd_export(a):
    jobs = json.loads(pathlib.Path(a.jobs).read_text())
    feats = {"cvat": export_cvat, "labelstudio": export_labelstudio, "labelme": export_labelme}[a.tool](jobs, a)
    n = len(feats)
    if a.dissolve: feats = dissolve(feats)
    gj = {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::3857"}}, "features": feats}
    pathlib.Path(a.out).write_text(json.dumps(gj, indent=1))
    print(f"{n} polygons" + (f", {len(feats)} after dissolve" if a.dissolve else "") + f" -> {a.out}")


# ----------------------------------------------------------------------------- cvat review stages
def cmd_cvat_stage(a):
    """Move every job of the plan's CVAT tasks to a stage (annotation, validation, acceptance) and optionally assign it.
    CVAT creates jobs in the annotation stage with no assignee; review is a stage change, nothing is created for it."""
    from cvat_sdk import make_client
    state = json.loads(pathlib.Path(a.state).read_text())["cvat"]
    with make_client(os.environ.get("CVAT_URL", "http://localhost:8085"), credentials=(os.environ["CVAT_USER"], os.environ["CVAT_PASS"])) as client:
        assignee = None
        if a.assignee:
            users = {u.username: u.id for u in client.users.list()}
            if a.assignee not in users: sys.exit(f"no CVAT user {a.assignee!r}, have {sorted(users)}")
            assignee = users[a.assignee]
        for s in state:
            for job in client.tasks.retrieve(s["task_id"]).get_jobs():
                patch = {"stage": a.stage}
                if assignee is not None: patch["assignee"] = assignee
                if a.state_value: patch["state"] = a.state_value
                job.update(patch); print(f"task {s['task_id']} job {job.id}: stage={a.stage}" + (f" assignee={a.assignee}" if a.assignee else ""))

# ----------------------------------------------------------------------------- cli
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("--sources", required=True); p.add_argument("--aoi", required=True, help="minx,miny,maxx,maxy or a GeoJSON file")
    p.add_argument("--aoi-crs", default="EPSG:4326"); p.add_argument("--gsd", type=float, help="ground sample distance in metres per pixel")
    p.add_argument("--zoom", type=float, help="alternative to --gsd: Web Mercator zoom"); p.add_argument("--chip", type=int, default=1024)
    p.add_argument("--overlap", type=float, default=0.1); p.add_argument("--pairs", default="consecutive", help="consecutive | all | a:b,c:d")
    p.add_argument("--name", default="cd"); p.add_argument("-o", "--out", default="jobs.json"); p.set_defaults(func=cmd_plan)
    b = sub.add_parser("build"); b.add_argument("tool", choices=["cvat", "labelstudio", "labelme"]); b.add_argument("jobs")
    b.add_argument("--layout", choices=["series", "pairs"], default="series", help="CVAT: all dates in one job, or two-frame pair jobs")
    b.add_argument("--labelme-dir", default="labelme_files"); b.add_argument("--state", default=None); b.set_defaults(func=cmd_build)
    e = sub.add_parser("export"); e.add_argument("tool", choices=["cvat", "labelstudio", "labelme"]); e.add_argument("jobs")
    e.add_argument("-o", "--out", default="merged.geojson"); e.add_argument("--dissolve", action="store_true"); e.add_argument("--workdir", default="exports")
    e.add_argument("--state", default=None); e.set_defaults(func=cmd_export)
    st = sub.add_parser("cvat-stage", help="move the plan's CVAT jobs to a review stage and assign them"); st.add_argument("jobs")
    st.add_argument("--stage", choices=["annotation", "validation", "acceptance"], required=True); st.add_argument("--assignee", help="CVAT username")
    st.add_argument("--state-value", choices=["new", "in progress", "rejected", "completed"], dest="state_value"); st.add_argument("--state", default=None)
    st.set_defaults(func=cmd_cvat_stage, tool="cvat")
    a = ap.parse_args()
    if hasattr(a, "state") and a.state is None: a.state = f"state_{a.tool}.json"
    if a.cmd == "plan" and not (a.gsd or a.zoom): ap.error("--gsd or --zoom is required")
    a.func(a)

if __name__ == "__main__":
    main()
