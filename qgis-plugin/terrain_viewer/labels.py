"""Labels for the contour lines, with QGIS's own labelling: on by default in
the layer's style, small black text in a thin white buffer, placed by QGIS
along the major lines (curved). The app labels its contours with symbols of
its own; in QGIS there are no label points, the lines carry their values.
Only the contours are labelled (0.9.0): the iso-line, plane slicer and
graticule labels of 0.8.0 are gone.

Two kinds of layers: the tile service's vector tiles (a QgsVectorTileLayer,
one labelling style per tile layer, as tile-server/direct.mjs names them) and
the Python backend's memory layers (their fields as live/modes.py declares
them)."""
from qgis.PyQt.QtGui import QColor, QFont
from qgis.core import Qgis, QgsPalLayerSettings, QgsTextFormat, QgsTextBufferSettings

try:  # QGIS 3.30+
    MM, POINTS = Qgis.RenderUnit.Millimeters, Qgis.RenderUnit.Points
    LINE, POLYGON = Qgis.GeometryType.Line, Qgis.GeometryType.Polygon
except AttributeError:  # QGIS 3.28
    from qgis.core import QgsUnitTypes, QgsWkbTypes
    MM, POINTS = QgsUnitTypes.RenderMillimeters, QgsUnitTypes.RenderPoints
    LINE, POLYGON = QgsWkbTypes.LineGeometry, QgsWkbTypes.PolygonGeometry
try:  # QGIS 3.26+
    CURVED, PERIMETER = Qgis.LabelPlacement.Curved, Qgis.LabelPlacement.PerimeterCurved
except AttributeError:  # pragma: no cover
    CURVED, PERIMETER = QgsPalLayerSettings.Curved, QgsPalLayerSettings.PerimeterCurved

# Per mode: (tile layer, geometry, label expression, filter) for the tile
# service's vector tiles, and (label expression, geometry) for the Python
# backend's memory layers. Contours: the major lines only (as the app).
TILE_LABELS = {
    "contours": [("contours", LINE, 'round("ele", 2)', '"level" = 1')],
}
MEMORY_LABELS = {
    "contours": ('if("major" = 1, round("elev", 2), NULL)', LINE),
}
# Half of 0.8.0's 8.5 pt text and 1 mm buffer, which the user found at
# least twice too large.
LABEL_SIZE_PT = 4.25
BUFFER_MM = 0.5


def text_format(size=LABEL_SIZE_PT):
    """Black text in a white buffer, readable over any relief."""
    fmt = QgsTextFormat()
    font = QFont()
    font.setBold(False)
    fmt.setFont(font)
    fmt.setSize(size)
    fmt.setSizeUnit(POINTS)
    fmt.setColor(QColor("#000000"))
    buf = QgsTextBufferSettings()
    buf.setEnabled(True)
    buf.setSize(BUFFER_MM)
    buf.setSizeUnit(MM)
    buf.setColor(QColor("#ffffff"))
    fmt.setBuffer(buf)
    return fmt


def settings(expression, geometry):
    """QgsPalLayerSettings for one expression, placed by QGIS along a line or
    around an area."""
    s = QgsPalLayerSettings()
    s.fieldName = expression
    s.isExpression = True
    s.placement = PERIMETER if geometry == POLYGON else CURVED
    s.setFormat(text_format())
    # One label every 6 cm of line at most: QGIS picks where.
    s.repeatDistance = 60
    s.repeatDistanceUnit = MM
    return s


def label_memory_layer(layer, mode):
    """Labels on a Python backend memory layer of `mode` (none for a mode
    without). Returns True when labelled."""
    spec = MEMORY_LABELS.get(mode)
    if spec is None:
        return False
    from qgis.core import QgsVectorLayerSimpleLabeling
    layer.setLabeling(QgsVectorLayerSimpleLabeling(settings(*spec)))
    layer.setLabelsEnabled(True)
    return True


def tile_labeling(mode):
    """A QgsVectorTileBasicLabeling for the vector tiles of `mode`, or None."""
    specs = TILE_LABELS.get(mode)
    if not specs:
        return None
    from qgis.core import QgsVectorTileBasicLabeling, QgsVectorTileBasicLabelingStyle
    styles = []
    for tile_layer, geometry, expression, flt in specs:
        st = QgsVectorTileBasicLabelingStyle()
        st.setStyleName(f"{tile_layer} labels")
        st.setLayerName(tile_layer)
        st.setGeometryType(geometry)
        if flt:
            st.setFilterExpression(flt)
        st.setLabelSettings(settings(expression, geometry))
        st.setEnabled(True)
        styles.append(st)
    labeling = QgsVectorTileBasicLabeling()
    labeling.setStyles(styles)
    return labeling


def label_tile_layer(layer, mode):
    """Labels on a tile service vector tile layer of `mode`. Returns True when
    labelled."""
    labeling = tile_labeling(mode)
    if labeling is None:
        return False
    layer.setLabeling(labeling)
    if hasattr(layer, "setLabelsEnabled"):
        layer.setLabelsEnabled(True)
    return True
