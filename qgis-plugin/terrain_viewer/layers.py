"""The project's side: one QGIS layer per mode, in a "Terrain Viewer (live)" group
whose subgroups are the app's panel groups, stacked as the map stacks them.
A layer is found again by its custom property, so a saved project picks up
where it was."""
from qgis.PyQt.QtGui import QColor, QPainter
from qgis.core import (
    QgsDataSourceUri, QgsProject, QgsRasterLayer, QgsVectorTileLayer, QgsLayerTreeGroup,
    QgsVectorTileBasicRenderer, QgsVectorTileBasicRendererStyle,
    QgsLineSymbol, QgsFillSymbol, QgsMarkerSymbol, QgsDataProvider,
    QgsSingleBandGrayRenderer, QgsContrastEnhancement, QgsRasterPipe, Qgis,
)
from .labels import label_tile_layer

try:  # QGIS 3.30+
    from qgis.core import Qgis
    POINT, LINE, POLYGON = Qgis.GeometryType.Point, Qgis.GeometryType.Line, Qgis.GeometryType.Polygon
except (ImportError, AttributeError):  # QGIS 3.28
    from qgis.core import QgsWkbTypes
    POINT, LINE, POLYGON = QgsWkbTypes.PointGeometry, QgsWkbTypes.LineGeometry, QgsWkbTypes.PolygonGeometry

# The group the panel follows. Named "(live)" so it reads apart from the
# frozen copies under it; found by its property, so renaming it is harmless,
# and a project saved before the rename (a group named "Terrain Viewer") is
# adopted and renamed.
ROOT_NAME = "Terrain Viewer (live)"
LEGACY_ROOT_NAME = "Terrain Viewer"
ROOT_PROP = "terrain_viewer/root"
PROP = "terrain_viewer/layer"  # "<mode>", "<mode>:vector" or "<mode>:values"
# A frozen copy carries this one instead of PROP, so the panel never finds,
# rewrites or reads it back.
FROZEN_PROP = "terrain_viewer/frozen"
# Which backend drew the layer: "service" (a tile service, local or remote)
# or "python" (live/, on this machine).
BACKEND_PROP = "terrain_viewer/backend"
MULTIPLY = QPainter.CompositionMode.CompositionMode_Multiply
NORMAL = QPainter.CompositionMode.CompositionMode_SourceOver


def xyz_uri(url, zmax):
    uri = QgsDataSourceUri()
    uri.setParam("type", "xyz")
    uri.setParam("url", url)
    uri.setParam("zmin", "0")
    uri.setParam("zmax", str(zmax))
    return bytes(uri.encodedUri()).decode("utf-8")


def values_resampling(layer, continuous=True):
    """How a values layer (GDAL over Float32 tiles) is resampled when the
    canvas is between two tile zooms, set once when the layer is made (a
    change in the layer's properties is kept: an address rewrite,
    setDataSource, keeps the resampling and the renderer).

    GDAL reads the level just finer than the canvas (a canvas at zoom 12.3
    reads z13 tiles), so the picture is mostly scaled down. QGIS's default
    is nearest neighbour after the renderer: pixels dropped or doubled. Early
    resampling (GDAL resampling the values, before the color ramp) bilinear
    both ways is one resampling, of the numbers; a palette (the contour mask)
    stays nearest. Identify reads the provider, never the resampled picture.

    The XYZ (color) layers get nothing: QGIS's XYZ provider already scales
    its tiles smoothly into the canvas (it rounds the canvas zoom to the
    nearest tile zoom), so a resampler there only resamples a second time,
    and early resampling, which that provider cannot do, draws nothing."""
    if not continuous or not layer.isValid():
        return
    from qgis.core import QgsRasterDataProvider
    try:
        stage = Qgis.RasterResamplingStage.Provider
    except AttributeError:  # QGIS < 3.30
        stage = QgsRasterPipe.ResamplingStage.Provider
    method = QgsRasterDataProvider.ResamplingMethod.Bilinear
    provider = layer.dataProvider()
    layer.setResamplingStage(stage)
    provider.enableProviderResampling(True)
    provider.setZoomedInResamplingMethod(method)
    provider.setZoomedOutResamplingMethod(method)


def _color(value, fallback):
    c = QColor(str(value)) if value else QColor()
    return c if c.isValid() else QColor(fallback)


def vector_renderer(mode_id, values):
    """A plain style for an overlay's vector tiles, colored with the mode's
    own color setting when it has one. Points only for the mound detector,
    whose points are its features (the tells); the others' values are QGIS
    labels on their lines (labels.py)."""
    color_key = {"contours": "contourColor", "isoline": "isolineColor", "planeSlicer": "planeSlicerColor",
                 "graticules": "graticuleColor", "moundDetector": "tellsOutlineColor"}.get(mode_id)
    color = _color(values.get(color_key), "#7a3b00" if mode_id == "contours" else "#d01c8b")
    width = str(values.get({"contours": "contourWeight", "isoline": "isolineWeight", "graticules": "graticuleWidth"}.get(mode_id, ""), 1) or 1)
    try:
        width_mm = max(0.1, float(width) * 0.26)
    except ValueError:
        width_mm = 0.26
    styles = []
    line = QgsVectorTileBasicRendererStyle("lines", "", LINE)
    line.setSymbol(QgsLineSymbol.createSimple({"line_color": color.name(), "line_width": str(width_mm), "line_width_unit": "MM"}))
    styles.append(line)
    fill = QgsVectorTileBasicRendererStyle("areas", "", POLYGON)
    fc = QColor(color)
    fc.setAlpha(90)
    fill.setSymbol(QgsFillSymbol.createSimple({"color": f"{fc.red()},{fc.green()},{fc.blue()},{fc.alpha()}", "outline_color": color.name(), "outline_width": "0.3"}))
    styles.append(fill)
    if mode_id == "moundDetector":
        point = QgsVectorTileBasicRendererStyle("points", "", POINT)
        point.setSymbol(QgsMarkerSymbol.createSimple({"color": color.name(), "size": "2.5", "outline_color": "white"}))
        styles.append(point)
    renderer = QgsVectorTileBasicRenderer()
    renderer.setStyles(styles)
    return renderer


def tree_ranks(tree):
    """A rank for every group and layer of the panel tree (/processes), top of the map
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
        # Called before a layer joins the project (the panel keeps the
        # canvas where it is, keep_extent).
        self.before_insert = None

    # -- the tree ---------------------------------------------------------
    def root(self, create=True):
        tree = self.project.layerTreeRoot()
        groups = [c for c in tree.children() if isinstance(c, QgsLayerTreeGroup)]
        g = next((c for c in groups if c.customProperty(ROOT_PROP)), None)
        if g is None:
            g = tree.findGroup(ROOT_NAME)
        if g is None:
            old = tree.findGroup(LEGACY_ROOT_NAME)
            if old is not None and any(n.layer() is not None and n.layer().customProperty(PROP) for n in old.findLayers()):
                old.setName(ROOT_NAME)
                g = old
        if g is None and create:
            g = tree.insertGroup(0, ROOT_NAME)
        if g is not None and not g.customProperty(ROOT_PROP):
            g.setCustomProperty(ROOT_PROP, True)
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
        if self.before_insert is not None:
            self.before_insert()
        self.project.addMapLayer(layer, False)
        g = self.group(path)
        return g.insertLayer(self._index(g, tuple(path), self.ranks.get(("l", key), 10 ** 6)), layer)

    def find_all(self, key):
        return [layer for layer in self.project.mapLayers().values() if layer.customProperty(PROP) == key]

    # -- one mode ---------------------------------------------------------
    def _own(self, key, backend, kind):
        """The layer of `key` if it is of the kind wanted (a vector tile
        layer, a memory layer, a raster); one of another kind (the contour
        lines of the other backend) is removed first."""
        layer = self.find(key)
        if layer is not None and kind is not None and not kind(layer):
            self.remove(key, prune=False)
            layer = None
        if layer is not None and backend:
            layer.setCustomProperty(BACKEND_PROP, backend)
        return layer

    def ensure(self, key, name, path, url, vector, mode_id=None, values=None, zmax=None, backend=None):
        """The layer of `key`, created or with its address replaced."""
        layer = self._own(key, backend, (lambda lyr: isinstance(lyr, QgsVectorTileLayer)) if vector
                          else (lambda lyr: isinstance(lyr, QgsRasterLayer)))
        if vector:
            uri = xyz_uri(url, 15)
            if layer is None:
                layer = QgsVectorTileLayer(uri, name)
                layer.setCustomProperty(PROP, key)
                layer.setCustomProperty(BACKEND_PROP, backend or "service")
                layer.setRenderer(vector_renderer(mode_id, values or {}))
                label_tile_layer(layer, mode_id)  # kept across address rewrites, as a change made in QGIS
                self._insert(layer, path, key)
            elif layer.source() != uri:
                layer.setDataSource(uri, layer.name(), "xyzvectortiles", QgsDataProvider.ProviderOptions())
                layer.setRenderer(vector_renderer(mode_id, values or {}))
                layer.triggerRepaint()
            return layer
        uri = xyz_uri(url, zmax or 22)
        if layer is None:
            layer = QgsRasterLayer(uri, name, "wms")
            layer.setCustomProperty(PROP, key)
            layer.setCustomProperty(BACKEND_PROP, backend or "service")
            self._insert(layer, path, key)
        elif layer.source() != uri:
            layer.setDataSource(uri, layer.name(), "wms", QgsDataProvider.ProviderOptions())
            layer.triggerRepaint()
        return layer

    def ensure_values(self, key, name, path, url, value_range=None, backend=None):
        """A mode's values: a Float32 raster read by GDAL from the service's
        /gdal.xml (GeoTIFF tiles), created or with its address replaced,
        drawn as a grey stretch over the mode's typical range (QGIS's own
        estimate reads the coarsest overview, far too narrow), resampled
        early (values_resampling)."""
        layer = self._own(key, backend, lambda lyr: isinstance(lyr, QgsRasterLayer))
        if layer is None:
            layer = QgsRasterLayer(url, name, "gdal")
            layer.setCustomProperty(PROP, key)
            layer.setCustomProperty(BACKEND_PROP, backend or "service")
            values_resampling(layer)
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

    def add_layer(self, layer, key, path, backend):
        """A layer made elsewhere (the Python backend's contour lines, a memory
        layer) put in its place in the tree, marked as the panel's."""
        layer.setCustomProperty(PROP, key)
        layer.setCustomProperty(BACKEND_PROP, backend)
        self._insert(layer, path, key)
        return layer

    def remove(self, key, prune=True):
        """Removes every layer of `key` from the project (a copy made with
        QGIS's Duplicate Layer carries the key too: left behind, it kept the
        mode drawn after its box was unchecked), then the groups left empty.
        Returns the ids removed."""
        ids = [layer.id() for layer in self.find_all(key)]
        if ids:
            self.project.removeMapLayers(ids)
        if prune:
            self.prune()
        return ids

    def prune(self):
        """The live group's empty subgroups removed, deepest first, and the
        live group itself when nothing is left in it (a project with every
        mode unchecked has no empty "Terrain Viewer (live)" group)."""
        root = self.root(create=False)
        if root is None:
            return

        def walk(g):
            for c in list(g.children()):
                if isinstance(c, QgsLayerTreeGroup):
                    walk(c)
                    if not c.children():
                        g.removeChildNode(c)
        walk(root)
        if not root.children() and root.parent() is not None:
            root.parent().removeChildNode(root)

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

    # -- freeze -------------------------------------------------------------
    def live_checked(self):
        """The panel's layers drawn now (checked, and every group above them
        checked), top of the map first."""
        root = self.root(create=False)
        if root is None or not root.isVisible():
            return []
        out = []

        def walk(g):
            for c in g.children():
                if isinstance(c, QgsLayerTreeGroup):
                    if c.itemVisibilityChecked():
                        walk(c)
                elif c.itemVisibilityChecked() and c.layer() is not None and c.layer().customProperty(PROP):
                    out.append(c.layer())
        walk(root)
        return out

    def freeze(self, name):
        """A plain copy of every live layer drawn now, in a new group right
        under the live one (the newest freeze on top): the same address, with
        every setting in it, the same renderer, opacity and blending, the
        same order. Nothing of the panel points at them afterwards."""
        layers = self.live_checked()
        if not layers:
            return None
        tree = self.project.layerTreeRoot()
        live = self.root(create=False)
        at = tree.children().index(live) + 1 if live in tree.children() else 0
        taken = {c.name() for c in tree.children() if isinstance(c, QgsLayerTreeGroup)}
        unique, n = name, 2
        while unique in taken:  # two freezes in the same minute
            unique, n = f"{name} ({n})", n + 1
        group = tree.insertGroup(at, unique)
        for layer in layers:
            copy = layer.clone()
            key = layer.customProperty(PROP)
            copy.removeCustomProperty(PROP)
            copy.setCustomProperty(FROZEN_PROP, key)
            copy.setName(layer.name())
            self.project.addMapLayer(copy, False)
            group.addLayer(copy)
        return group
