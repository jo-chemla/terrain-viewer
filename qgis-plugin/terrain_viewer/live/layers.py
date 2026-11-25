"""The locally computed modes in the project: a "Terrain Viewer (local
compute)" group, one layer per checked mode, served by live/server.py.

Two forms, picked in the panel:
- values (the default): a layer of QGIS's gdal provider over the server's
  Float32 tiles (server.gdal_xml), drawn by QGIS's own renderers: a colour
  ramp of QGIS's style over the mode's range (the coloured default, any
  other ramp or classification from the layer's properties), grey and
  multiplied for the shades, two colours for the contour mask. Identify,
  the raster calculator and Processing read the numbers.
- grey tiles: a plain XYZ layer of the server's PNG pictures (faster to
  appear, tile by tile, but 8-bit pictures, no values).

Behind the panel's "Experimental: compute locally" box; nothing here runs
unless it is checked."""
import math

from qgis.core import (
    QgsColorRampShader, QgsContrastEnhancement, QgsDataSourceUri, QgsGradientColorRamp, QgsGradientStop, QgsPalettedRasterRenderer,
    QgsProject, QgsRasterLayer, QgsRasterShader, QgsSingleBandGrayRenderer, QgsSingleBandPseudoColorRenderer, QgsStyle,
)
from qgis.PyQt.QtGui import QColor, QPainter

from . import modes
from .server import WORLD, LiveServer

GROUP_PROP = "terrain_viewer/local_root"
LAYER_PROP = "terrain_viewer/local_mode"
MULTIPLY = QPainter.CompositionMode.CompositionMode_Multiply
NORMAL = QPainter.CompositionMode.CompositionMode_SourceOver
# Checked when the box is first checked: the cheap shade, the sky view
# factor and the shadows, as the first experiment had them.
DEFAULT_ON = ("shadows", "hillshade", "svf")
# Top of the map first: masks and shades over the colours.
ORDER = ["contours", "shadows", "hillshade", "multihillshade", "svf", "openness", "lrm", "curvature", "tpi", "tri", "roughness",
         "aspect", "slope", "elevation"]
DEFAULT_OPACITY = {"shadows": 0.6, "svf": 0.8, "openness": 0.8}


def xyz_source(url, zmax=17):
    """A QGIS XYZ data source for a tile address, encoded by QGIS itself
    (QgsDataSourceUri): written by hand, the "&" between the address's
    settings ended QGIS's url parameter (radius=16&altitude=30 lost all but
    the first), and a percent-encoded address is decoded by QGIS 4.2 but not
    by 3.44."""
    uri = QgsDataSourceUri()
    uri.setParam("type", "xyz")
    uri.setParam("url", url)
    uri.setParam("zmin", "0")
    uri.setParam("zmax", str(zmax))
    return bytes(uri.encodedUri()).decode("utf-8")


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


def _linear():
    t = getattr(QgsColorRampShader, "Type", None)
    return t.Interpolated if t is not None and hasattr(t, "Interpolated") else QgsColorRampShader.Interpolated


def hypsometric_ramp():
    """Green lowlands, yellow, brown, white summits: the coloured default
    for elevation (QGIS's style has no hypsometric ramp)."""
    stops = [QgsGradientStop(0.25, QColor("#c8d68f")), QgsGradientStop(0.5, QColor("#e8c77d")),
             QgsGradientStop(0.75, QColor("#a8805a"))]
    return QgsGradientColorRamp(QColor("#3f7f4f"), QColor("#f7f7f7"), False, stops)


def color_ramp(name, invert=False):
    """A ramp of QGIS's default style by name (Viridis when missing), or the
    plugin's hypsometric one."""
    if name == "hypso":
        ramp = hypsometric_ramp()
    else:
        ramp = QgsStyle.defaultStyle().colorRamp(name) or QgsStyle.defaultStyle().colorRamp("Viridis")
    if ramp is not None and invert:
        ramp.invert()
    return ramp


def apply_renderer(layer, mode, value_range=None):
    """QGIS's own renderer for a values layer, as the mode's coloured
    default: a colour ramp over its range, a grey stretch for the shades,
    two colours for the contour mask."""
    spec = modes.MODES[mode]
    provider = layer.dataProvider()
    lo, hi = value_range or spec["range"] or (0.0, 1.0)
    if spec["kind"] == "shade":
        r = QgsSingleBandGrayRenderer(provider, 1)
        ce = QgsContrastEnhancement(provider.dataType(1))
        ce.setContrastEnhancementAlgorithm(QgsContrastEnhancement.ContrastEnhancementAlgorithm.StretchToMinimumMaximum)
        ce.setMinimumValue(float(lo))
        ce.setMaximumValue(float(hi))
        r.setContrastEnhancement(ce)
    elif spec["kind"] == "mask":
        classes = [QgsPalettedRasterRenderer.Class(1, QColor(120, 72, 40), "minor"),
                   QgsPalettedRasterRenderer.Class(2, QColor(70, 40, 20), "major")]
        r = QgsPalettedRasterRenderer(provider, 1, classes)
    else:
        shader_fn = QgsColorRampShader(float(lo), float(hi), color_ramp(spec["ramp"], spec.get("invert", False)), _linear())
        shader_fn.classifyColorRamp(9, -1)
        shader = QgsRasterShader()
        shader.setRasterShaderFunction(shader_fn)
        r = QgsSingleBandPseudoColorRenderer(provider, 1, shader)
        r.setClassificationMin(float(lo))
        r.setClassificationMax(float(hi))
    layer.setRenderer(r)
    layer.setBlendMode(MULTIPLY if spec["kind"] == "shade" else NORMAL)
    r.setOpacity(DEFAULT_OPACITY.get(mode, 1.0))


def tile_zoom(extent3857, width_px, maxzoom=17):
    """The zoom of 256 px tiles whose pixel is the canvas pixel."""
    if extent3857.width() <= 0 or width_px <= 0:
        return 0
    return int(min(max(round(math.log2(2 * WORLD * width_px / (256 * extent3857.width()))), 0), maxzoom))


def tiles_of(extent3857, z, ring=1):
    """The (z, x, y) tiles over an EPSG:3857 extent, plus a ring around."""
    n = 1 << z
    size = 2 * WORLD / n
    x0 = int((extent3857.xMinimum() + WORLD) // size) - ring
    x1 = int((extent3857.xMaximum() + WORLD) // size) + ring
    y0 = int((WORLD - extent3857.yMaximum()) // size) - ring
    y1 = int((WORLD - extent3857.yMinimum()) // size) + ring
    return [(z, x % n, y) for y in range(max(y0, 0), min(y1, n - 1) + 1) for x in range(x0, x1 + 1)][:400]


def elevation_range(extent3857, width_px, source="mapterhorn"):
    """The 2nd and 98th percentiles of the elevation over an extent (a
    coarser zoom's tiles), for the hypsometric ramp's range."""
    import numpy as np
    dem = LiveServer.instance().dem(source)
    z = max(tile_zoom(extent3857, width_px) - 2, 0)
    try:
        vals = [dem.tile(*t) for t in tiles_of(extent3857, z, ring=0)[:16]]
    except Exception:  # noqa: BLE001 - no network: a generic range
        return (0.0, 3000.0)
    if not vals:
        return (0.0, 3000.0)
    lo, hi = np.percentile(np.concatenate([v.ravel() for v in vals]), [2, 98])
    return (float(lo), float(max(hi, lo + 1)))


class LocalLayers:
    """The group and its layers: one per mode, values or grey tiles."""

    def __init__(self, project=None):
        self.project = project or QgsProject.instance()

    @property
    def server(self):
        return LiveServer.instance()

    def group(self, create=False):
        return _group(self.project, create)

    def find(self, mode):
        g = self.group()
        if g is None:
            return None
        for n in g.findLayers():
            if n.layer() is not None and n.layer().customProperty(LAYER_PROP) == mode:
                return n.layer()
        return None

    def source_of(self, mode, opts, as_values):
        s = self.server
        if as_values:
            return s.gdal_xml(mode, opts), "gdal"
        return xyz_source(s.xyz_url(mode, opts)), "wms"

    def set_mode(self, mode, on, opts=None, as_values=True, extent=None, width_px=0):
        """Adds, re-points or removes one mode's layer; returns it (None
        when removed or invalid)."""
        layer = self.find(mode)
        if not on:
            if layer is not None:
                self.project.removeMapLayer(layer.id())
            return None
        source, provider = self.source_of(mode, opts or {}, as_values)
        if layer is not None and layer.source() == source:
            return layer
        if layer is not None:  # another form or other settings: a new layer in its place
            self.project.removeMapLayer(layer.id())
        spec = modes.MODES[mode]
        unit = spec["unit"]
        name = f"{spec['label']} (local{', ' + unit if as_values and unit else ''})"
        layer = QgsRasterLayer(source, name, provider)
        if not layer.isValid():
            return None
        layer.setCustomProperty(LAYER_PROP, mode)
        if as_values:
            rng = None
            if mode == "elevation" and extent is not None:
                rng = elevation_range(extent, width_px)
            apply_renderer(layer, mode, rng)
        else:
            if layer.renderer():
                layer.renderer().setOpacity(DEFAULT_OPACITY.get(mode, 1.0))
            layer.setBlendMode(MULTIPLY if spec["kind"] == "shade" else NORMAL)
        g = self.group(create=True)
        self.project.addMapLayer(layer, False)
        # Kept in ORDER, whatever order they are checked in.
        rank = ORDER.index(mode)
        at = 0
        for i, n in enumerate(g.children()):
            other = getattr(n, "layer", lambda: None)()
            if other is not None and other.customProperty(LAYER_PROP) in ORDER and ORDER.index(other.customProperty(LAYER_PROP)) < rank:
                at = i + 1
        g.insertLayer(at, layer)
        return layer

    def prefetch(self, extent3857, width_px):
        """The canvas's elevation tiles (and a ring around) fetched now, in
        parallel, before QGIS asks for them."""
        z = tile_zoom(extent3857, width_px)
        self.server.dem("mapterhorn").prefetch(tiles_of(extent3857, z))

    def remove_all(self):
        """Removes the group and its layers, stops the server."""
        g = self.group()
        if g is not None:
            self.project.removeMapLayers([n.layerId() for n in g.findLayers()])
            g.parent().removeChildNode(g)
        LiveServer.shutdown()


def add_local_layers(project=None, as_values=True):
    """The default set (DEFAULT_ON), added once; returns the group's layers."""
    ll = LocalLayers(project)
    for mode in DEFAULT_ON:
        if ll.find(mode) is None:
            ll.set_mode(mode, True, {}, as_values)
    return [n.layer() for n in ll.group(True).findLayers()]


def remove_local_layers(project=None):
    LocalLayers(project).remove_all()
