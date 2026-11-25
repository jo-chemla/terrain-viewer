"""The locally computed modes in the project: a "Terrain Viewer (local
compute)" group, served by live/server.py. Per mode, the forms checked in
the panel (Colour, Values, and Vector for contours), each a layer:

- colour: a plain XYZ layer of the server's PNG tiles, coloured by the
  server with the mode's colour ramp (QGIS's, sampled: ramp_luts), grey and
  multiplied for the shades, RGB for matcap. Shown tile by tile.
- values: a layer of QGIS's gdal provider over the server's Float32 tiles
  (server.gdal_xml), drawn by QGIS's own renderers (the same ramp as the
  coloured default; any other from the layer's properties). Identify, the
  raster calculator and Processing read the numbers.
- vector: contour lines in a memory layer, recomputed for the view
  (live/contours.py).

A changed setting re-points the layer (setDataSource): its style,
opacity, blending and resampling, as set in its properties, stay.

Behind the panel's "Experimental: compute locally" box; nothing here runs
unless it is checked."""
import math

from qgis.core import (
    QgsApplication, QgsColorRampShader, QgsContrastEnhancement, QgsDataProvider, QgsDataSourceUri, QgsGradientColorRamp,
    QgsGradientStop, QgsPalettedRasterRenderer, QgsProject, QgsRasterLayer, QgsRasterShader, QgsRectangle,
    QgsSingleBandGrayRenderer, QgsSingleBandPseudoColorRenderer, QgsStyle, QgsTask, QgsVectorLayer,
)
from qgis.PyQt.QtGui import QColor, QPainter

from ..layers import values_resampling
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
ORDER = ["contours", "shadows", "phong", "hillshade", "multihillshade", "svf", "openness", "matcap", "lrm", "curvature", "tpi",
         "tri", "roughness", "aspect", "slope", "elevation"]
# The deepest zoom of the colour tiles: Mapterhorn's 512 px tiles go to z17,
# so 256 px tiles to z18, the level the values (GDAL) read too.
XYZ_ZMAX = 18
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


def ramp_luts():
    """Each ramp mode's colour ramp sampled at 256 steps, (256, 3) uint8: the
    colours of the colour tiles, the same as the values layers' default
    renderer. Read from QGIS's style, so on the main thread."""
    import numpy as np
    out = {}
    for mode, spec in modes.MODES.items():
        if spec["kind"] != "ramp":
            continue
        ramp = color_ramp(spec["ramp"], spec.get("invert", False))
        if ramp is None:
            continue
        cols = [ramp.color(i / 255.0) for i in range(256)]
        out[mode] = np.array([[c.red(), c.green(), c.blue()] for c in cols], np.uint8)
    return out


def _key(mode, form):
    return f"{mode}:{form}"


def _mode_form(layer):
    """(mode, form) of one of the group's layers; a layer of 0.5.0 (the
    mode alone) is a values layer (gdal) or a grey tile layer (colour)."""
    v = layer.customProperty(LAYER_PROP)
    if not v:
        return None, None
    if ":" in v:
        mode, form = v.split(":", 1)
        return mode, form
    return v, "values" if layer.providerType() == "gdal" else "colour"


FORM_ORDER = ("vector", "colour", "values")  # within a mode, top first


class LocalLayers:
    """The group and its layers: per mode, a colour layer (XYZ of the
    server's PNG tiles), a values layer (GDAL over its Float32 tiles), and
    for contours a vector layer (live/contours.py)."""

    def __init__(self, project=None):
        self.project = project or QgsProject.instance()
        srv = self.server
        if not srv.luts:
            srv.luts = ramp_luts()

    @property
    def server(self):
        return LiveServer.instance()

    def group(self, create=False):
        return _group(self.project, create)

    def find(self, mode, form):
        g = self.group()
        if g is None:
            return None
        for n in g.findLayers():
            layer = n.layer()
            if layer is not None and _mode_form(layer) == (mode, form):
                return layer
        return None

    def source_of(self, mode, form, opts):
        s = self.server
        if form == "values":
            # The values ignore the settings of the colours alone.
            opts = {k: v for k, v in opts.items() if k not in modes.MODES[mode].get("colour_only", ())}
            return s.gdal_xml(mode, opts), "gdal"
        return xyz_source(s.xyz_url(mode, opts), zmax=XYZ_ZMAX), "wms"

    def _place(self, layer, mode, form):
        """Into the group, kept in ORDER (then vector, colour, values),
        whatever order they are checked in."""
        g = self.group(create=True)
        self.project.addMapLayer(layer, False)
        # A mode live/ added after this list goes under the listed ones.
        rank = (ORDER.index(mode) if mode in ORDER else len(ORDER), FORM_ORDER.index(form))
        at = 0
        for i, n in enumerate(g.children()):
            other = getattr(n, "layer", lambda: None)()
            if other is None:
                continue
            m, f = _mode_form(other)
            if m in ORDER and f in FORM_ORDER and (ORDER.index(m), FORM_ORDER.index(f)) < rank:
                at = i + 1
        g.insertLayer(at, layer)

    def set_form(self, mode, form, on, opts=None, extent=None, width_px=0):
        """Adds, re-points or removes one form of one mode; returns the
        layer (None when removed or invalid). A new address keeps the
        layer, its style and resampling (setDataSource), so what was changed
        in its properties stays."""
        layer = self.find(mode, form)
        if not on:
            if layer is not None:
                self.project.removeMapLayer(layer.id())
            return None
        opts = dict(opts or {})
        if form == "vector":
            return self._vector(mode, layer, opts, extent, width_px)
        source, provider = self.source_of(mode, form, opts)
        if layer is not None:
            if layer.source() != source:
                layer.setDataSource(source, layer.name(), provider, QgsDataProvider.ProviderOptions())
                layer.triggerRepaint()
            return layer
        spec = modes.MODES[mode]
        unit = spec["unit"]
        name = f"{spec['label']} (local{', values, ' + unit if form == 'values' and unit else ''})"
        layer = QgsRasterLayer(source, name, provider)
        if not layer.isValid():
            return None
        layer.setCustomProperty(LAYER_PROP, _key(mode, form))
        if form == "values":
            rng = (opts.get("min", 0.0), opts.get("max", 4000.0)) if mode == "elevation" else None
            apply_renderer(layer, mode, rng)
            values_resampling(layer, spec["kind"] != "mask")
        else:
            if layer.renderer():
                layer.renderer().setOpacity(DEFAULT_OPACITY.get(mode, 1.0))
            layer.setBlendMode(MULTIPLY if spec["kind"] == "shade" else NORMAL)
        self._place(layer, mode, form)
        return layer

    # -- contour lines --------------------------------------------------------
    def _vector(self, mode, layer, opts, extent, width_px):
        from . import contours
        if layer is None:
            layer = QgsVectorLayer("LineString?crs=EPSG:3857&field=elev:double&field=major:integer",
                                   f"{modes.MODES[mode]['label']} (local, lines)", "memory")
            layer.setCustomProperty(LAYER_PROP, _key(mode, "vector"))
            contours.style(layer)
            self._place(layer, mode, "vector")
        self.refresh_vector(layer, opts, extent, width_px)
        return layer

    def refresh_vector(self, layer, opts, extent, width_px, wait=False, source="mapterhorn"):
        """The contour lines of the view computed in a QgsTask and put into
        the layer when done (a later view's result wins); wait: here, now
        (tests)."""
        from . import contours
        if extent is None or width_px <= 0:
            return
        o = modes.parse_opts("contours", opts)
        key = (extent.toString(), width_px, o["minor"], o["major"], source)
        if layer.customProperty("terrain_viewer/local_view") == str(key) and not wait:
            return
        layer.setCustomProperty("terrain_viewer/local_view", str(key))
        dem = self.server.dem(source)
        ext = QgsRectangle(extent)
        if wait:
            lines, _z = contours.view_contours(dem, ext, width_px, o["minor"], o["major"])
            contours.replace_features(layer, lines)
            return
        global _contour_generation
        _contour_generation += 1
        gen = _contour_generation
        layer_id = layer.id()
        project = self.project

        def run(task):
            return contours.view_contours(dem, ext, width_px, o["minor"], o["major"])

        def finished(exception, result=None):
            lyr = project.mapLayer(layer_id)
            if exception is not None or result is None or lyr is None or gen != _contour_generation:
                return
            contours.replace_features(lyr, result[0])
        task = QgsTask.fromFunction("Terrain Viewer: contour lines", run, on_finished=finished,
                                    flags=QgsTask.Flag.Silent if hasattr(QgsTask, "Flag") else QgsTask.Silent)
        _tasks.append(task)
        del _tasks[:-8]
        QgsApplication.taskManager().addTask(task)

    def refresh_vectors(self, opts_of, extent, width_px):
        """Every contour line layer of the group, for a new view."""
        g = self.group()
        if g is None:
            return
        for n in g.findLayers():
            layer = n.layer()
            if layer is not None and _mode_form(layer)[1] == "vector":
                self.refresh_vector(layer, opts_of(_mode_form(layer)[0]), extent, width_px)

    # -- the rest ---------------------------------------------------------------
    def prefetch(self, extent3857, width_px, source="mapterhorn"):
        """The canvas's elevation tiles (and a ring around) fetched now, in
        parallel, before QGIS asks for them."""
        z = tile_zoom(extent3857, width_px)
        self.server.dem(source).prefetch(tiles_of(extent3857, z))

    def remove_all(self):
        """Removes the group and its layers, stops the server."""
        g = self.group()
        if g is not None:
            self.project.removeMapLayers([n.layerId() for n in g.findLayers()])
            g.parent().removeChildNode(g)
        LiveServer.shutdown()


_contour_generation = 0
_tasks = []  # QgsTask.fromFunction tasks kept referenced while they run


def add_local_layers(project=None):
    """The default set (DEFAULT_ON, colour), added once; returns the group's layers."""
    ll = LocalLayers(project)
    for mode in DEFAULT_ON:
        if ll.find(mode, "colour") is None:
            ll.set_form(mode, "colour", True, {})
    return [n.layer() for n in ll.group(True).findLayers()]


def remove_local_layers(project=None):
    LocalLayers(project).remove_all()
