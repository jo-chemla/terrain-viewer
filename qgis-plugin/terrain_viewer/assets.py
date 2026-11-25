"""What the plugin carries in assets/ (made by qgis-plugin/make_assets.py from
a tile service): the ramp and matcap previews as sprite sheets, and a
snapshot of the service's catalog (the modes tree, the ramps, the sources),
so the panel has its tree, its previews and its sources with no request:
for the Python backend, which has no service, and before a service answers."""
import json
import os

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
_cache = {}


def _json(name):
    if name not in _cache:
        try:
            with open(os.path.join(HERE, name), encoding="utf-8") as f:
                _cache[name] = json.load(f)
        except (OSError, ValueError):
            _cache[name] = {}
    return _cache[name]


def catalog():
    """{"tree", "inputs", "colorramps": [{id, name}], "sources"}: the
    service's catalog when the assets were made."""
    return _json("catalog.json")


def ramp_names():
    return {r["id"]: r.get("name", r["id"]) for r in catalog().get("colorramps", [])}


def _sprite(png):
    key = ("sprite", png)
    if key not in _cache:
        from qgis.PyQt.QtGui import QImage
        img = QImage(os.path.join(HERE, png))
        _cache[key] = None if img.isNull() else img
    return _cache[key]


def _slice_icon(png, index, w, h):
    from qgis.PyQt.QtGui import QIcon, QPixmap
    img = _sprite(png)
    if img is None or index < 0 or (index + 1) * h > img.height():
        return None
    return QIcon(QPixmap.fromImage(img.copy(0, index * h, w, h)))


def ramp_icon(ramp_id):
    """The ramp's 96x12 preview as an icon, or None when not packaged."""
    key = ("ramp", ramp_id)
    if key not in _cache:
        meta = _json("colorramps.json")
        ids = meta.get("ids", [])
        _cache[key] = _slice_icon("colorramps.png", ids.index(ramp_id), meta["width"], meta["height"]) if ramp_id in ids else None
    return _cache[key]


def matcaps():
    """[(id, name)] of the app's matcap pictures, and the default id."""
    meta = _json("matcaps.json")
    return [(m["id"], m["name"]) for m in meta.get("items", [])], meta.get("default", "clay_studio")


def matcap_icon(texture_id):
    key = ("matcap", texture_id)
    if key not in _cache:
        meta = _json("matcaps.json")
        ids = [m["id"] for m in meta.get("items", [])]
        size = meta.get("size", 48)
        _cache[key] = _slice_icon("matcaps.png", ids.index(texture_id), size, size) if texture_id in ids else None
    return _cache[key]
