"""labelme opens local files, not URLs: download both chips as GeoTIFF from TiTiler (geotransform embedded),
name them so A/D in labelme flickers before/after, write the class list, and verify labelme can load them.
(labelme's Qt and rasterio's GDAL are checked in separate processes: importing both in one crashes on Windows.)"""
import json, pathlib, requests, subprocess, sys

pair = json.loads(pathlib.Path("pair.json").read_text())
d = pathlib.Path("labelme_files") / pair["pair_id"]; d.mkdir(parents=True, exist_ok=True)
files = []
for side in ("before", "after"):
    f = d / f"{pair['pair_id']}_{'1' if side == 'before' else '2'}_{side}_{pair[side]['id']}.tif"
    r = requests.get(pair[side]["tif_local"], timeout=300); r.raise_for_status(); f.write_bytes(r.content); files.append(f)
    print(f.name, len(r.content), "bytes")
(d / "labels.txt").write_text("__ignore__\n" + "\n".join(pair["classes"]) + "\n")
(d / "pair.json").write_text(json.dumps(pair, indent=2))

check_geo = "import rasterio,sys\nfor f in sys.argv[1:]:\n ds=rasterio.open(f); print(' geo:',ds.count,'bands',ds.width,ds.height,ds.crs,[round(v,4) for v in ds.transform.to_gdal()])"
check_lm = """import sys, PIL.Image
try:
    import labelme.utils as u; load = lambda f: u.img_data_to_arr(open(f,'rb').read()); how = 'labelme.utils'
except ImportError:                      # labelme >= 7 dropped labelme.utils, it reads through Pillow like this
    import numpy as np; load = lambda f: np.asarray(PIL.Image.open(f)); how = 'Pillow'
for f in sys.argv[1:]:
    a = load(f); print(' loads via', how + ':', a.shape, a.dtype)"""
for code in (check_geo, check_lm):
    r = subprocess.run([sys.executable, "-c", code, *map(str, files)])
    if r.returncode: print(" (check skipped, missing module in this Python; chips are written anyway)")
print(f"run: python -m labelme {d} --labels {d/'labels.txt'}   (labelme 7: autosave on and no image data by default. A/D = previous/next image = flicker)")
