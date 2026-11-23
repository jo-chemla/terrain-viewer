"""The project's side: one QGIS layer per mode, in a "Terrain Viewer" group
whose subgroups are the app's panel groups, stacked as the map stacks them.
A layer is found again by its custom property, so a saved project picks up
where it was."""
from qgis.PyQt.QtGui import QColor, QPainter
from qgis.core import (
    QgsDataSourceUri, QgsProject, QgsRasterLayer, QgsVectorTileLayer, QgsLayerTreeGroup,
    QgsVectorTileBasicRenderer, QgsVectorTileBasicRendererStyle,
    QgsLineSymbol, QgsFillSymbol, QgsMarkerSymbol, QgsDataProvider,
    QgsSingleBandGrayRenderer, QgsContrastEnhancement,
)

try:  # QGIS 3.30+
    from qgis.core import Qgis
    POINT, LINE, POLYGON = Qgis.GeometryType.Point, Qgis.GeometryType.Line, Qgis.GeometryType.Polygon
except (ImportError, AttributeError):  # QGIS 3.28
    from qgis.core import QgsWkbTypes
    POINT, LINE, POLYGON = QgsWkbTypes.PointGeometry, QgsWkbTypes.LineGeometry, QgsWkbTypes.PolygonGeometry

ROOT_NAME = "Terrain Viewer"
PROP = "terrain_viewer/layer"  # "<mode>", "<mode>:vector" or "<mode>:values"
MULTIPLY = QPainter.CompositionMode.CompositionMode_Multiply
NORMAL = QPainter.CompositionMode.CompositionMode_SourceOver


def xyz_uri(url, zmax):
    uri = QgsDataSourceUri()
    uri.setParam("type", "xyz")
    uri.setParam("url", url)
    uri.setParam("zmin", "0")
    uri.setParam("zmax", str(zmax))
    return bytes(uri.encodedUri()).decode("utf-8")


def _colour(value, fallback):
    c = QColor(str(value)) if value else QColor()
    return c if c.isValid() else QColor(fallback)


def vector_renderer(mode_id, values):
    """A plain style for an overlay's vector tiles, coloured with the mode's
    own colour setting when it has one."""
    colour_key = {"contours": "contourColor", "isoline": "isolineColor", "planeSlicer": "planeSlicerColor",
                  "graticules": "graticuleColor", "moundDetector": "tellsOutlineColor"}.get(mode_id)
    colour = _colour(values.get(colour_key), "#7a3b00" if mode_id == "contours" else "#d01c8b")
    width = str(values.get({"contours": "contourWeight", "isoline": "isolineWeight", "graticules": "graticuleWidth"}.get(mode_id, ""), 1) or 1)
    try:
        width_mm = max(0.1, float(width) * 0.26)
    except ValueError:
        width_mm = 0.26
    styles = []
    line = QgsVectorTileBasicRendererStyle("lines", "", LINE)
    line.setSymbol(QgsLineSymbol.createSimple({"line_color": colour.name(), "line_width": str(width_mm), "line_width_unit": "MM"}))
    styles.append(line)
    fill = QgsVectorTileBasicRendererStyle("areas", "", POLYGON)
    fc = QColor(colour)
    fc.setAlpha(90)
    fill.setSymbol(QgsFillSymbol.createSimple({"color": f"{fc.red()},{fc.green()},{fc.blue()},{fc.alpha()}", "outline_color": colour.name(), "outline_width": "0.3"}))
    styles.append(fill)
    point = QgsVectorTileBasicRendererStyle("points", "", POINT)
    point.setSymbol(QgsMarkerSymbol.createSimple({"color": colour.name(), "size": "2.5", "outline_color": "white"}))
    styles.append(point)
    renderer = QgsVectorTileBasicRenderer()
    renderer.setStyles(styles)
    return renderer


def tree_ranks(tree):
    """A rank for every group and layer of /modes' tree, top of the map
    first: ("g", path) for a group, ("l", key) for a layer; an overlay's
    vector tiles right under its raster."""
    ranks = {}

    def walk(g, path):
        here = path + ((g["group"],) if g.get("group") else ())
        if g.get("group"):
            ranks[("g", here)] = len(ranks)
        for sub in g.get("groups", []):
            walk(sub, here)
        for item in g.get("items", []):
            ranks[("l", item["id"])] = len(ranks)
            ranks[("l", item["id"] + ":vector")] = len(ranks)
            ranks[("l", item["id"] + ":values")] = len(ranks)
    for g in tree:
        walk(g, ())
    return ranks


class LayerStack:
    def __init__(self, project=None):
        self.project = project or QgsProject.instance()
        self.ranks = {}

    # -- the tree ---------------------------------------------------------
    def root(self, create=True):
        tree = self.project.layerTreeRoot()
        g = tree.findGroup(ROOT_NAME)
        if g is None and create:
            g = tree.insertGroup(0, ROOT_NAME)
        return g

    def _rank_of(self, node, path):
        if isinstance(node, QgsLayerTreeGroup):
            return self.ranks.get(("g", path + (node.name(),)), 10 ** 6)
        layer = node.layer() if hasattr(node, "layer") else None
        return self.ranks.get(("l", layer.customProperty(PROP) if layer else None), 10 ** 6)

    def _index(self, parent, path, rank):
        """Where a node of `rank` goes among `parent`'s children: under the
        ones the map draws above it."""
        return sum(1 for c in parent.children() if self._rank_of(c, path) < rank)

    def group(self, path):
        g = self.root()
        for i, name in enumerate(path):
            sub = next((c for c in g.children() if isinstance(c, QgsLayerTreeGroup) and c.name() == name), None)
            if sub is None:
                sub = g.insertGroup(self._index(g, path[:i], self.ranks.get(("g", path[:i + 1]), 10 ** 6)), name)
            g = sub
        return g

    def find(self, key):
        for layer in self.project.mapLayers().values():
            if layer.customProperty(PROP) == key:
                return layer
        return None

    def node(self, layer):
        return self.project.layerTreeRoot().findLayer(layer.id()) if layer else None

    def _insert(self, layer, path, key):
        self.project.addMapLayer(layer, False)
        g = self.group(path)
        return g.insertLayer(self._index(g, tuple(path), self.ranks.get(("l", key), 10 ** 6)), layer)

    # -- one mode ---------------------------------------------------------
    def ensure(self, key, name, path, url, vector, mode_id=None, values=None):
        """The layer of `key`, created or with its address replaced."""
        layer = self.find(key)
        if vector:
            uri = xyz_uri(url, 15)
            if layer is None:
                layer = QgsVectorTileLayer(uri, name)
                layer.setCustomProperty(PROP, key)
                layer.setRenderer(vector_renderer(mode_id, values or {}))
                self._insert(layer, path, key)
            elif layer.source() != uri:
                layer.setDataSource(uri, layer.name(), "xyzvectortiles", QgsDataProvider.ProviderOptions())
                layer.setRenderer(vector_renderer(mode_id, values or {}))
                layer.triggerRepaint()
            return layer
        uri = xyz_uri(url, 22)
        if layer is None:
            layer = QgsRasterLayer(uri, name, "wms")
            layer.setCustomProperty(PROP, key)
            self._insert(layer, path, key)
        elif layer.source() != uri:
            layer.setDataSource(uri, layer.name(), "wms", QgsDataProvider.ProviderOptions())
            layer.triggerRepaint()
        return layer

    def ensure_values(self, key, name, path, url, value_range=None):
        """A mode's values: a Float32 raster read by GDAL from the service's
        /gdal.xml (GeoTIFF tiles), created or with its address replaced,
        drawn as a grey stretch over the mode's typical range (QGIS's own
        estimate reads the coarsest overview, far too narrow)."""
        layer = self.find(key)
        if layer is None:
            layer = QgsRasterLayer(url, name, "gdal")
            layer.setCustomProperty(PROP, key)
            if value_range and layer.isValid():
                gray = QgsSingleBandGrayRenderer(layer.dataProvider(), 1)
                ce = QgsContrastEnhancement(layer.dataProvider().dataType(1))
                ce.setContrastEnhancementAlgorithm(QgsContrastEnhancement.ContrastEnhancementAlgorithm.StretchToMinimumMaximum)
                ce.setMinimumValue(float(value_range[0]))
                ce.setMaximumValue(float(value_range[1]))
                gray.setContrastEnhancement(ce)
                layer.setRenderer(gray)
            self._insert(layer, path, key)
        elif layer.source() != url:
            layer.setDataSource(url, layer.name(), "gdal", QgsDataProvider.ProviderOptions())
            layer.triggerRepaint()
        return layer

    def style(self, layer, opacity, shading):
        if layer is None:
            return
        if isinstance(layer, QgsRasterLayer):
            if layer.renderer():
                layer.renderer().setOpacity(opacity)
            layer.setBlendMode(MULTIPLY if shading else NORMAL)
        else:
            layer.setOpacity(opacity)
        layer.triggerRepaint()

    def set_visible(self, layer, visible):
        n = self.node(layer)
        if n is not None:
            n.setItemVisibilityChecked(visible)
            if visible:  # and the groups above it
                p = n.parent()
                while p is not None and hasattr(p, "setItemVisibilityChecked"):
                    p.setItemVisibilityChecked(True)
                    p = p.parent()
