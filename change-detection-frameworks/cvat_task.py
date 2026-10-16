"""Create a CVAT task from the pair: two remote image URLs (before, after) in one job, so the annotator
flickers with F/D (next/previous frame). Labels = the four classes, attribute drawn_on = before/after."""
import json, os, pathlib, sys, time
from cvat_sdk import make_client
from cvat_sdk.core.proxies.tasks import ResourceType

CVAT_URL = os.environ.get("CVAT_URL", "http://localhost:8085")
pair = json.loads(pathlib.Path("pair.json").read_text())
drawn_on = {"name": "drawn_on", "mutable": False, "input_type": "select", "default_value": "after", "values": ["before", "after"]}
labels = [{"name": c, "type": "polygon", "attributes": [drawn_on]} for c in pair["classes"]]
spec = {"name": f"Change detection {pair['pair_id']}", "labels": labels, "segment_size": 2}
# CVAT uses the file name as frame name: encode which image is which, pair id, and the georeference recipe
from urllib.parse import quote
SHIM = os.environ.get("CHIP_SHIM", "http://host.docker.internal:8020")   # see chip_proxy.py
remote = [f"{SHIM}/{pair['pair_id']}_1_before_{pair['before']['id']}.png?u={quote(pair['before']['url_local'], safe='')}",
          f"{SHIM}/{pair['pair_id']}_2_after_{pair['after']['id']}.png?u={quote(pair['after']['url_local'], safe='')}"]
pathlib.Path("cvat_task_spec.json").write_text(json.dumps({"spec": spec, "remote_files": remote, "pair": pair}, indent=2))

with make_client(CVAT_URL, credentials=(os.environ["CVAT_USER"], os.environ["CVAT_PASS"])) as client:
    task = client.tasks.create_from_data(spec=spec, resource_type=ResourceType.REMOTE, resources=remote,
                                         data_params={"image_quality": 100, "sorting_method": "predefined"})
    print("task", task.id, "size", task.size, "frames:", [f.name[:60] for f in task.get_frames_info()])
    if "--test-annotation" in sys.argv:
        from cvat_sdk.api_client import models
        lab = {l.name: l for l in task.get_labels()}
        attr_id = lab["construction"].attributes[0].id
        shape = models.LabeledShapeRequest(type="polygon", frame=1, label_id=lab["construction"].id,
                                           points=[400, 420, 470, 420, 470, 480, 400, 480],
                                           attributes=[models.AttributeValRequest(spec_id=attr_id, value="after")])
        task.set_annotations(models.LabeledDataRequest(shapes=[shape]))
        task.export_dataset("CVAT for images 1.1", pathlib.Path("cvat_export.zip"), include_images=False)
        import zipfile; zipfile.ZipFile("cvat_export.zip").extract("annotations.xml", "."); pathlib.Path("annotations.xml").rename("cvat_export.xml")
        print("exported cvat_export.xml")
    print(f"open {CVAT_URL}/tasks/{task.id}")
