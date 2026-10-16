"""Build a before/after chip pair manifest for a map viewport, served as URLs by TiTiler.
No chip files are needed for CVAT or Label Studio: they load the URLs. labelme needs files, see labelme_task.py.
Usage: python make_pair.py [size_px] [titiler_base_for_servers] [titiler_base_for_this_machine]
"""
import json, math, sys, pathlib

CENTER_LNG, CENTER_LAT, ZOOM = 23.845, 40.8227, 18.4          # from the terrain-viewer URL
W = H = int(sys.argv[1]) if len(sys.argv) > 1 else 1024
# TiTiler as seen by the annotation servers (CVAT runs in Docker, so host.docker.internal) and by this machine.
TITILER_FOR_SERVERS = sys.argv[2] if len(sys.argv) > 2 else "http://host.docker.internal:8010"
TITILER_LOCAL = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8010"

COG_URL = "https://3d.iconem.com/greece/amphipolis/Amphipolis_general_rgb_10cm_cog_cropped_alpha.tif"
ESRI_SRC = "/data/esri_tms18.xml"   # GDAL TMS description mounted in the TiTiler container, any GDAL source works

R = 6378137.0
cx = math.radians(CENTER_LNG) * R
cy = math.log(math.tan(math.pi / 4 + math.radians(CENTER_LAT) / 2)) * R
res = 2 * math.pi * R / 256 / 2 ** ZOOM
minx, maxx = cx - res * W / 2, cx + res * W / 2
miny, maxy = cy - res * H / 2, cy + res * H / 2
bbox = f"{minx},{miny},{maxx},{maxy}"

def chip(base, src, fmt): return f"{base}/cog/bbox/{bbox}/{W}x{H}.{fmt}?url={src}&coord_crs=EPSG:3857&dst_crs=EPSG:3857"

pair = {
    "pair_id": "amphipolis_pair_001",
    "crs": "EPSG:3857",
    "geotransform": [minx, res, 0.0, maxy, 0.0, -res],   # GDAL order, north-up because TiTiler warped to dst_crs
    "width": W, "height": H,
    "classes": ["no-change", "destruction", "construction", "modification"],
    "before": {"id": "esri_world_imagery", "date": "unknown",
               "url": chip(TITILER_FOR_SERVERS, ESRI_SRC, "png"), "url_local": chip(TITILER_LOCAL, ESRI_SRC, "png"),
               "tif_local": chip(TITILER_LOCAL, ESRI_SRC, "tif")},
    "after": {"id": "amphipolis_rgb_10cm", "date": "2024",
              "url": chip("https://titiler.xyz", COG_URL, "png"), "url_local": chip(TITILER_LOCAL, COG_URL, "png"),
              "tif_local": chip(TITILER_LOCAL, COG_URL, "tif"), "source_cog": COG_URL},
}
pathlib.Path("pair.json").write_text(json.dumps(pair, indent=2))
print(json.dumps({k: pair[k] for k in ("pair_id", "crs", "geotransform", "width", "height")}, indent=1))
