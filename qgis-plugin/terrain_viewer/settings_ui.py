"""How the panel shows a setting: the slider range of a number (the app's
sidebar ranges, by parameter name; /processes gives types and defaults but
rarely a range), the symmetric min/max pairs, the light shared by the shaded
modes. No widget here, so it can be tested on its own."""
import re

# The light every shaded mode reads, as in the app (one state for the
# hillshade, Phong and the shadows); the pad and its two sliders set it.
LIGHT_KEYS = ("illuminationDir", "illuminationAlt")
LIGHT_DEFAULT = (315.0, 45.0)
LIGHT_MODES = ("hillshade", "shadows", "buildingShadows", "phong")

# key -> (slider min, slider max, step, hard min, hard max); hard: what the
# number box accepts (None: anything).
EXACT = {
    "illuminationDir": (0, 360, 1, 0, 360),
    "illuminationAlt": (0, 90, 1, 0, 90),
    "hillshadeExag": (0, 1, 0.01, 0, 10),
    "phongDiffuseStrength": (0, 1, 0.05, 0, 2),
    "phongSpecularStrength": (0, 1, 0.05, 0, 2),
    "phongFresnelStrength": (0, 1, 0.05, 0, 2),
    "phongFresnelPower": (1, 16, 0.5, 0.1, 64),
    "phongLightCount": (1, 3, 1, 1, 3),
    "shadowRadiusPx": (2, 512, 1, 2, 512),
    "svfRadius": (1, 64, 1, 1, 256),
    "opennessRadius": (1, 64, 1, 1, 256),
    "lrmRadius": (1, 128, 1, 1, 256),
    "localDominanceMinRadius": (1, 128, 1, 1, 256),
    "localDominanceMaxRadius": (1, 128, 1, 1, 256),
    "lightDayOfYear": (1, 365, 1, 1, 366),
    "lightTimeOfDay": (0, 24, 0.25, 0, 24),
    "matcapRotationDeg": (0, 360, 1, -360, 360),
    "aspectShiftDegrees": (0, 360, 1, -360, 360),
    "aspectMinDegrees": (0, 360, 1, 0, 360),
    "aspectMaxDegrees": (0, 360, 1, 0, 360),
    "slopeMinDegrees": (0, 90, 1, 0, 90),
    "slopeMaxDegrees": (0, 90, 1, 0, 90),
    "minElevation": (-500, 9000, 10, None, None),
    "maxElevation": (-500, 9000, 10, None, None),
    "contourMinor": (1, 500, 1, 0.01, None),
    "contourMajor": (5, 2000, 5, 0.01, None),
    "contourMinorLrm": (0.5, 50, 0.5, 0.01, None),
    "contourMajorLrm": (1, 200, 1, 0.01, None),
    "contourWeight": (0.5, 6, 0.5, 0.1, 20),
    "graticuleWidth": (0.5, 6, 0.5, 0.1, 20),
    "graticuleDensity": (0, 5, 1, 0, 10),
    "isolineWeight": (0.5, 8, 0.5, 0.1, 20),
    "isolineSmooth": (0, 16, 1, 0, 16),
    "isolineFillOpacity": (0, 1, 0.05, 0, 1),
    "isolineInterval": (1, 1000, 1, 0.01, None),
    "isolineValue": (-500, 9000, 1, None, None),
    "planeSlicerValue": (-500, 9000, 1, None, None),
    "planeSlicerValueLrm": (-50, 50, 0.5, None, None),
    "tellSize": (10, 1000, 10, 1, None),
    "tellRadius": (1, 32, 1, 1, 256),
    "tellMinRelief": (0, 20, 0.5, 0, None),
    "tellsScaleMultiplier": (0.1, 5, 0.1, 0.01, None),
    "curvatureMin": (-5, 0, 0.01, None, None),
    "curvatureMax": (0, 5, 0.01, None, None),
    "shapeIndexMin": (-1, 1, 0.01, -1, 1),
    "shapeIndexMax": (-1, 1, 0.01, -1, 1),
    "opennessMin": (-90, 90, 1, -90, 90),
    "opennessMax": (-90, 90, 1, -90, 90),
    "svfMin": (0, 100, 1, 0, 100),
    "svfMax": (0, 100, 1, 0, 100),
    "orientationMin": (0, 180, 1, 0, 180),
    "orientationMax": (0, 180, 1, 0, 180),
    "eigenRatioMin": (0, 100, 1, 0, None),
    "eigenRatioMax": (0, 100, 1, 0, None),
    "blobnessMin": (0, 100, 1, None, None),
    "blobnessMax": (0, 100, 1, None, None),
}
# By the end of the name, when no exact entry: (slider min, max, step, hard min, hard max).
SUFFIX = [
    (re.compile(r"Opacity$"), (0, 1, 0.05, 0, 1)),
    (re.compile(r"(Dir|Azimuth|Deg|Degrees)$"), (0, 360, 1, -360, 360)),
    (re.compile(r"Alt$"), (0, 90, 1, 0, 90)),
    (re.compile(r"Radius(Px)?$"), (1, 128, 1, 1, 512)),
    (re.compile(r"(Strength|Blend)$"), (0, 1, 0.05, 0, 2)),
    (re.compile(r"(Min|Max)$"), (-50, 50, 0.5, None, None)),
]


def slider_range(key, default=None, minimum=None, maximum=None):
    """(lo, hi, step, hard_lo, hard_hi) for a number setting, or None (a plain
    number box). The schema's own minimum and maximum win."""
    r = EXACT.get(key)
    if r is None:
        r = next((v for rx, v in SUFFIX if rx.search(key)), None)
    if r is None and minimum is not None and maximum is not None:
        span = float(maximum) - float(minimum)
        r = (minimum, maximum, span / 100 if span <= 10 else 1, minimum, maximum)
    if r is None:
        return None
    lo, hi, step, hard_lo, hard_hi = r
    if minimum is not None:
        lo = hard_lo = float(minimum)
    if maximum is not None:
        hi = hard_hi = float(maximum)
    # A default outside the usual range widens it (a range of 0 to 8100 m).
    if isinstance(default, (int, float)) and not isinstance(default, bool):
        if default < lo:
            lo = default
        if default > hi:
            hi = default
    return (float(lo), float(hi), float(step), -1e7 if hard_lo is None else float(hard_lo), 1e7 if hard_hi is None else float(hard_hi))


def symmetric_pairs(keys):
    """{symmetric key: (min key, max key)} among a mode's setting keys: the
    app's <prefix>Symmetric beside <prefix>Min/<prefix>Max (hypsoSymmetric:
    minElevation/maxElevation)."""
    keys = set(keys)
    out = {}
    for k in keys:
        if not k.endswith("Symmetric"):
            continue
        prefix = k[: -len("Symmetric")]
        if prefix == "hypso" and {"minElevation", "maxElevation"} <= keys:
            out[k] = ("minElevation", "maxElevation")
        elif {prefix + "Min", prefix + "Max"} <= keys:
            out[k] = (prefix + "Min", prefix + "Max")
    return out


def is_ramp_key(key):
    return key == "colorRamp" or key.endswith("ColorRamp")


def is_matcap_key(key):
    return key == "matcapTextureId"


def is_colour_key(key, spec_type=None):
    return spec_type == "color" or (key.endswith("Color") and not key.endswith("ColorRamp"))


def clean_enum(values):
    """An enum as the app takes it: the URL reference once listed an inline
    literal's last value as `live" as const`."""
    out = []
    for v in values or []:
        v = str(v).split('"')[0].strip()
        if v and v not in out:
            out.append(v)
    return out
