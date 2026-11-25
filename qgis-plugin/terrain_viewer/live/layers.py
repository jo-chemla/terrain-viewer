"""The experiment in the project: a "Terrain Viewer (local compute)" group with
one XYZ layer per locally computed mode, served by live/server.py. Behind the
panel's "Experimental: compute locally" box; nothing here runs unless it is
checked."""
from qgis.core import QgsProject, QgsRasterLayer
from qgis.PyQt.QtGui import QPainter

from .server import LiveServer

GROUP_PROP = "terrain_viewer/local_root"
MULTIPLY = QPainter.CompositionMode.CompositionMode_Multiply
# Top to bottom, as the map stacks them: shadows over the shades.
MODES = [
    ("shadows", "Shadows (local)", {"altitude": 30}, 1.0),
    ("hillshade", "Hillshade (local)", {}, 1.0),
    ("svf", "Sky view factor (local)", {"radius": 16}, 0.8),
]


def _group(project, create):
    root = project.layerTreeRoot()
    for g in root.findGroups(True):
        if g.customProperty(GROUP_PROP):
            return g
    if not create:
        return None
    g = root.insertGroup(0, "Terrain Viewer (local compute)")
    g.setCustomProperty(GROUP_PROP, True)
    return g


def add_local_layers(project=None):
    """Adds the group (once) and returns its layers."""
    project = project or QgsProject.instance()
    srv = LiveServer.instance()
    g = _group(project, False)
    if g is not None:
        return [n.layer() for n in g.findLayers()]
    g = _group(project, True)
    out = []
    for mode, name, opts, opacity in MODES:
        uri = f"type=xyz&url={srv.xyz_url(mode, opts)}&zmin=0&zmax=17"
        layer = QgsRasterLayer(uri, name, "wms")
        if not layer.isValid():
            continue
        layer.setOpacity(opacity)
        layer.setBlendMode(MULTIPLY)
        project.addMapLayer(layer, False)
        g.addLayer(layer)
        out.append(layer)
    return out


def remove_local_layers(project=None):
    """Removes the group and its layers, stops the server."""
    project = project or QgsProject.instance()
    g = _group(project, False)
    if g is not None:
        project.removeMapLayers([n.layerId() for n in g.findLayers()])
        g.parent().removeChildNode(g)
    LiveServer.shutdown()
