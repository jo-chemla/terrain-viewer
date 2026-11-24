"""The plugin's "Open in" list against the web app's: python test_open_in.py
(plain Python and Node, no QGIS). Every destination of OPEN_IN_DESTINATIONS in
components/TerrainControlPanel/open-in-links.tsx must be in
send2map_app/destinations.py with the same id, label, availability and, for a
set of cameras, the same URL (byte for byte, except a float's last digit:
V8's Math.cos and C's cos can differ by one ulp); the plugin's own extras are
marked plugin_only."""
import json
import os
import re
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(here, "send2map_app"))
from destinations import DESTINATIONS, Context, js_str, to_fixed, js_round  # noqa: E402

failures = []
NUM = re.compile(r"-?\d+\.\d+")


def same_url(a, b):
    if a == b:
        return True
    if NUM.sub("#", a) != NUM.sub("#", b):
        return False
    return all(abs(float(x) - float(y)) <= 1e-12 * max(1.0, abs(float(y))) for x, y in zip(NUM.findall(a), NUM.findall(b)))


# The JS number formatting the URLs depend on.
for got, want in [(js_str(44.0), "44"), (js_str(0.1 + 0.2), "0.30000000000000004"), (js_str(1.5e-5), "0.000015"),
                  (js_str(1e-7), "1e-7"), (js_str(-4.0005), "-4.0005"), (to_fixed(0.125, 2), "0.13"),
                  (to_fixed(-0.125, 2), "-0.13"), (to_fixed(-0.0, 1), "0.0"), (to_fixed(1.005, 2), "1.00"),
                  (js_round(2.5), 3), (js_round(-2.5), -2)]:
    if got != want:
        failures.append(f"number formatting: {got!r} != {want!r}")

cameras = [
    dict(lat=44.5061, lng=4.0005, zoom=11.32, bearing=0, pitch=0),
    dict(lat=51.17886, lng=-1.82622, zoom=16.5, bearing=275.25, pitch=60),  # Stonehenge, in LiDAR Lens
    dict(lat=-33.8568, lng=151.2153, zoom=3, bearing=12.5, pitch=0.125),
    dict(lat=0.0, lng=-0.0, zoom=0.5, bearing=359.99, pitch=0),
    dict(lat=64.1466, lng=-21.9426, zoom=20.75, bearing=180, pitch=85),  # north of LiDAR Lens
]
for c in cameras:
    c["now_ms"] = 1795000000000
    c["bounds"] = None

ref = json.loads(subprocess.run(["node", os.path.join(here, "open_in_reference.mjs"), json.dumps(cameras)],
                                check=True, capture_output=True, text=True, encoding="utf-8").stdout)

shared = [d for d in DESTINATIONS if not d.plugin_only]
web_ids = [d["id"] for d in ref[0]]
if [d.id for d in shared] != web_ids:
    failures.append(f"ids: plugin {[d.id for d in shared]} != web app {web_ids}")
by_id = {d.id: d for d in DESTINATIONS}
for cam, row in zip(cameras, ref):
    ctx = Context(**cam)
    for w in row:
        d = by_id.get(w["id"])
        if d is None:
            continue
        if d.label != w["label"]:
            failures.append(f"{w['id']}: label {d.label!r} != {w['label']!r}")
        if d.is_available(ctx) != w["available"] or (w["hint"] and d.unavailable_hint != w["hint"]):
            failures.append(f"{w['id']}: availability at {cam['lat']},{cam['lng']}")
        if not same_url(d.build(ctx), w["url"]):
            failures.append(f"{w['id']}:\n  plugin {d.build(ctx)}\n  web    {w['url']}")

# The plugin's own: well formed for every camera.
for cam in cameras:
    ctx = Context(**cam)
    for d in DESTINATIONS:
        if d.plugin_only:
            out = d.build(ctx)
            ok = out.startswith("https://") if d.kind == "url" else "<LookAt>" in out
            if not ok:
                failures.append(f"{d.id}: {out[:80]}")
print(Context(**cameras[1]).__dict__)
for d in DESTINATIONS:
    print(f"  {'plugin' if d.plugin_only else 'shared'} {d.id:22} {d.build(Context(**cameras[1])).splitlines()[0][:110]}")
print(len(shared), "shared with the web app,", len(DESTINATIONS) - len(shared), "plugin only")
print("FAILURES:", failures or "none")
sys.exit(1 if failures else 0)
