"""Convert annotations from labelme JSON, Label Studio JSON export, or CVAT XML into GeoJSON
using the pair manifest's CRS and geotransform. Usage: python to_geojson.py pair.json <export file> out.geojson"""
import json, sys, pathlib, xml.etree.ElementTree as ET

pair = json.loads(pathlib.Path(sys.argv[1]).read_text())
src, out = pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
gt = pair["geotransform"]; W, H = pair["width"], pair["height"]

def px_to_map(px, py):
    return [gt[0] + px * gt[1] + py * gt[2], gt[3] + px * gt[4] + py * gt[5]]

def feature(ring_px, label, drawn_on, extra=None):
    ring = [px_to_map(x, y) for x, y in ring_px]
    if ring[0] != ring[-1]: ring.append(ring[0])
    props = {"class": label, "drawn_on": drawn_on, "pair_id": pair["pair_id"],
             "before_id": pair["before"]["id"], "before_date": pair["before"]["date"],
             "after_id": pair["after"]["id"], "after_date": pair["after"]["date"], **(extra or {})}
    return {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props}

feats = []
if src.suffix == ".xml":                                   # CVAT for images 1.1
    root = ET.parse(src).getroot()
    for img in root.iter("image"):
        drawn_on = "before" if "before" in img.get("name") else "after"
        for poly in img.iter("polygon"):
            pts = [tuple(map(float, p.split(","))) for p in poly.get("points").split(";")]
            attrs = {a.get("name"): a.text for a in poly.iter("attribute")}
            feats.append(feature(pts, poly.get("label"), attrs.get("drawn_on", drawn_on), {"frame": img.get("name")}))
else:
    data = json.loads(src.read_text())
    if isinstance(data, dict) and "shapes" in data:        # labelme
        drawn_on = "before" if "before" in data.get("imagePath", "") else "after"
        for s in data["shapes"]:
            if s["shape_type"] in ("polygon", "rectangle"):
                pts = s["points"]
                if s["shape_type"] == "rectangle":
                    (x0, y0), (x1, y1) = pts; pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
                feats.append(feature(pts, s["label"], drawn_on, {"flags": s.get("flags") or None}))
    else:                                                  # Label Studio JSON export (list of tasks)
        for task in data:
            for ann in task.get("annotations", []):
                for r in ann["result"]:
                    if r["type"] != "polygonlabels": continue
                    pts = [(x / 100 * r["original_width"], y / 100 * r["original_height"]) for x, y in r["value"]["points"]]
                    feats.append(feature(pts, r["value"]["polygonlabels"][0], r["to_name"], {"task_id": task["id"]}))

out.write_text(json.dumps({"type": "FeatureCollection",
                           "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:{pair['crs'].replace(':', '::')}"}},
                           "features": feats}, indent=1))
print(f"{len(feats)} features -> {out}")
