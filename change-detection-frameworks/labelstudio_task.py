"""Create a Label Studio project for before/after change detection, import the pair as one task,
then (test only) add an annotation through the API and export JSON. Images are loaded by URL by the browser."""
import json, os, pathlib, sys
from label_studio_sdk.client import LabelStudio

LS_URL = os.environ.get("LS_URL", "http://127.0.0.1:8081"); LS_KEY = os.environ["LS_API_KEY"]
pair = json.loads(pathlib.Path("pair.json").read_text())
labels = "".join(f'<Label value="{c}"/>' for c in pair["classes"])

LABEL_CONFIG = f"""
<View>
  <Header value="Pair $pair_id : before = $before_id ($before_date), after = $after_id ($after_date). Hotkeys 1-4 = class."/>
  <View style="display:flex; gap:8px">
    <View style="flex:1"><Header value="BEFORE"/><Image name="before" value="$before" zoom="true" zoomControl="true" rotateControl="false"/></View>
    <View style="flex:1"><Header value="AFTER"/><Image name="after" value="$after" zoom="true" zoomControl="true" rotateControl="false"/></View>
  </View>
  <PolygonLabels name="change_before" toName="before" strokeWidth="2">{labels}</PolygonLabels>
  <PolygonLabels name="change_after" toName="after" strokeWidth="2">{labels}</PolygonLabels>
</View>"""

task = {"data": {"pair_id": pair["pair_id"], "crs": pair["crs"], "geotransform": pair["geotransform"],
                 "before": pair["before"]["url_local"], "before_id": pair["before"]["id"], "before_date": pair["before"]["date"],
                 "after": pair["after"]["url_local"], "after_id": pair["after"]["id"], "after_date": pair["after"]["date"]}}
pathlib.Path("labelstudio_tasks.json").write_text(json.dumps([task], indent=2))
pathlib.Path("labelstudio_config.xml").write_text(LABEL_CONFIG)

ls = LabelStudio(base_url=LS_URL, api_key=LS_KEY)
project = ls.projects.create(title=f"Change detection {pair['pair_id']}", label_config=LABEL_CONFIG)
imported = ls.projects.import_tasks(id=project.id, request=[task])
print("project", project.id, "imported", imported.task_count)

if "--test-annotation" in sys.argv:        # simulate what an analyst would draw: a polygon on the AFTER image
    tid = [t.id for t in ls.tasks.list(project=project.id)][0]
    W, H = pair["width"], pair["height"]
    poly_px = [(400, 420), (470, 420), (470, 480), (400, 480)]
    result = [{"type": "polygonlabels", "from_name": "change_after", "to_name": "after",
               "original_width": W, "original_height": H, "image_rotation": 0,
               "value": {"points": [[x / W * 100, y / H * 100] for x, y in poly_px], "polygonlabels": ["construction"]}}]
    ls.annotations.create(id=tid, result=result)
    import requests
    r = requests.get(f"{LS_URL}/api/projects/{project.id}/export", params={"exportType": "JSON"}, headers={"Authorization": f"Token {LS_KEY}"}, timeout=120)
    r.raise_for_status(); pathlib.Path("labelstudio_export.json").write_bytes(r.content)   # same as UI "Export > JSON"
    print("exported labelstudio_export.json")
print(f"open {LS_URL}/projects/{project.id}")
