"""A Mapbox Vector Tile's point features, decoded with no dependency (the
tests compare the plugin's mound candidates with the tile service's
moundDetector tiles): {layer: [(x, y, {key: value})]} in tile units."""


def _varint(b, i):
    v = s = 0
    while True:
        c = b[i]
        i += 1
        v |= (c & 0x7F) << s
        s += 7
        if c < 0x80:
            return v, i


def _fields(b):
    """(field number, wire type, value) of a protobuf message; a
    length-delimited value as bytes."""
    import struct
    i = 0
    while i < len(b):
        key, i = _varint(b, i)
        f, w = key >> 3, key & 7
        if w == 0:
            v, i = _varint(b, i)
        elif w == 1:
            v = struct.unpack_from("<d", b, i)[0]
            i += 8
        elif w == 2:
            n, i = _varint(b, i)
            v = bytes(b[i:i + n])
            i += n
        elif w == 5:
            v = struct.unpack_from("<f", b, i)[0]
            i += 4
        else:
            raise ValueError(f"wire type {w}")
        yield f, w, v


def _packed(b):
    i, out = 0, []
    while i < len(b):
        v, i = _varint(b, i)
        out.append(v)
    return out


def _zigzag(n):
    return (n >> 1) ^ -(n & 1)


def _value(b):
    for f, _w, v in _fields(b):
        if f == 1:
            return v.decode("utf-8")
        if f in (2, 3):
            return v
        if f in (4, 5):
            return v
        if f == 6:
            return _zigzag(v)
        if f == 7:
            return bool(v)
    return None


def read_points(data):
    """Every point of every layer: {layer name: [(x, y, tags)]}."""
    out = {}
    for f, _w, layer in _fields(data):
        if f != 3:
            continue
        name, keys, values, feats = None, [], [], []
        for lf, _lw, v in _fields(layer):
            if lf == 1:
                name = v.decode("utf-8")
            elif lf == 2:
                feats.append(v)
            elif lf == 3:
                keys.append(v.decode("utf-8"))
            elif lf == 4:
                values.append(_value(v))
        pts = []
        for feat in feats:
            tags, geom, gtype = [], [], None
            for ff, _fw, v in _fields(feat):
                if ff == 2:
                    tags = _packed(v)
                elif ff == 3:
                    gtype = v
                elif ff == 4:
                    geom = _packed(v)
            if gtype != 1:
                continue
            props = {keys[tags[k]]: values[tags[k + 1]] for k in range(0, len(tags), 2)}
            x = y = 0
            i = 0
            while i < len(geom):
                cmd, count = geom[i] & 7, geom[i] >> 3
                i += 1
                for _ in range(count):
                    if cmd in (1, 2):
                        x += _zigzag(geom[i])
                        y += _zigzag(geom[i + 1])
                        i += 2
                        pts.append((x, y, props))
        out.setdefault(name, []).extend(pts)
    return out
