#!/usr/bin/env python3
"""Google Photorealistic 3D coverage -> GeoJSON, pure HTTP (no browser, no rasterization).

  python google3d_coverage.py fetch  --key AIza... --out tiles/ [--zoom 8] [--bbox W,S,E,N] [--conc 8]
  python google3d_coverage.py decode --tiles tiles/ --out coverage.geojson [--no-dissolve]

fetch : reads the layer id from mapConfigs:batchGet, then walks the tile quadtree from z5 (whole world, or a bbox)
        descending only into non-empty tiles, caching raw tiles as tiles/z_x_y.bin (re-run to resume).
decode: XOR 0x9b + protobuf + triangle-mesh -> polygons, per-tile union, tile-seam dissolve, GeoJSON.
Needs: python3 (fetch: stdlib only; decode: shapely).
"""
import argparse, json, math, os, re, struct, sys, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

MAP_ID = 'ccfdf8d031b6b83cc90ddc70'   # Google docs-team map id carrying the coverage dataset
EXT = 8192
EMPTY_MAX = 64                        # empty tiles are 36 bytes
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

# ---------------------------------------------------------------- fetch
def get(url, headers=None, retries=5):
    for a in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504): time.sleep(2 * (a + 1)); continue
            return e.code, b''
        except Exception:
            time.sleep(1 + a)
    return 0, b''

def layer_template(key):
    st, body = get('https://maps.googleapis.com/maps/api/mapsjs/mapConfigs:batchGet?alt=protojson'
                   f'&map_ids={MAP_ID}&map_type=1&language=en-US&region=US&key={key}')
    txt = body.decode('utf-8', 'replace')
    m = re.search(r'ml:xs:c:[A-Za-z0-9_-]+', txt)
    if st != 200 or not m: sys.exit(f'mapConfigs failed ({st}): {txt[:300]}')
    epochs = re.search(r'\[(\d{8}),(\d{8})\]', txt)
    a, b = (epochs.group(1), epochs.group(2)) if epochs else ('47083502', '56565656')
    lid = urllib.parse.quote(m.group(0), safe='')
    return ('https://maps.googleapis.com/maps/vt/pb=!1m4!1m3!1i{z}!2i{x}!3i{y}!2m2!1e2!2s' + lid +
            '!3m9!2sen-US!3sUS!5e18!12m5!1e68!2m2!1sset!2sRoadmap!4e2!4e1!5m4!1e4!8m2!1e0!1e1'
            f'!6m9!1e12!2i2!19m1!1e0!20m1!1e0!39b1!44e1!50e0!23i{a}!23i{b}!23i47054750!23i46991212!26m2!1e2!1e3!28i796')

def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))

def cmd_fetch(a):
    os.makedirs(a.out, exist_ok=True)
    tmpl = layer_template(a.key)
    z0 = min(a.start_zoom, a.zoom)
    if a.bbox:
        w, s, e, n = map(float, a.bbox.split(','))
        x0, y0 = lonlat_to_tile(w, n, z0); x1, y1 = lonlat_to_tile(e, s, z0)
    else:
        x0 = y0 = 0; x1 = y1 = 2 ** z0 - 1
    queue = [(z0, x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    stat = {'req': 0, 'nonempty': 0, 'bytes': 0, 'err': 0, 'cached': 0}

    def one(t):
        z, x, y = t
        fn = os.path.join(a.out, f'{z}_{x}_{y}.bin')
        if os.path.exists(fn):
            stat['cached'] += 1; data = open(fn, 'rb').read()
        else:
            st, data = get(tmpl.format(z=z, x=x, y=y)); stat['req'] += 1
            if st != 200: stat['err'] += 1; return t, None
            if data[3] ^ 0x9b != z: stat['err'] += 1; return t, None      # sanity: header zoom byte
            open(fn, 'wb').write(data)
        return t, data

    while queue:
        nxt = []
        with ThreadPoolExecutor(a.conc) as ex:
            for (z, x, y), data in ex.map(one, queue):
                if not data or len(data) <= EMPTY_MAX: continue
                stat['nonempty'] += 1; stat['bytes'] += len(data)
                if z < a.zoom:
                    nxt += [(z + 1, 2 * x + dx, 2 * y + dy) for dx in (0, 1) for dy in (0, 1)]
        print(f'z{queue[0][0]} done: {stat}  next level: {len(nxt)} tiles', flush=True)
        queue = nxt
    print('done', stat)

# ---------------------------------------------------------------- decode
def rv(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7f) << s; s += 7
        if not c & 0x80: return r, i

def parse(b):
    i, out = 0, []
    while i < len(b):
        k, i = rv(b, i); f, w = k >> 3, k & 7
        if w == 0: v, i = rv(b, i); out.append((f, v))
        elif w == 2: l, i = rv(b, i); out.append((f, b[i:i + l])); i += l
        elif w == 5: out.append((f, b[i:i + 4])); i += 4
        elif w == 1: out.append((f, b[i:i + 8])); i += 8
        else: raise ValueError('bad wire type')
    return out

def varints(b):
    i, out = 0, []
    while i < len(b): v, i = rv(b, i); out.append(v)
    return out

zz = lambda v: (v >> 1) ^ -(v & 1)

def decode_tile(raw):
    b = bytes(c ^ 0x9b for c in raw)
    top = parse(b)
    hdr = dict(parse([v for f, v in top if f == 1][0]))
    feats = []
    for f, v in top:
        if f != 8: continue
        for bf, bv in parse(v):
            if bf != 1: continue
            d = parse(bv)
            geom = [gv for gf, gv in d if gf == 1]
            if not geom: continue
            g = dict(parse(geom[0]))
            if not isinstance(g.get(1), bytes): continue
            vs = varints(g[1]); idx = varints(g[2]) if isinstance(g.get(2), bytes) else []
            pts = [(vs[0], vs[1])]
            for i in range(2, len(vs) - 1, 2):
                pts.append((pts[-1][0] + zz(vs[i]), pts[-1][1] + zz(vs[i + 1])))
            tris = [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, len(idx) - 2, 3) if max(idx[i:i + 3]) < len(pts)]
            feats.append((pts, tris))
    return hdr[1], hdr[2], hdr[3], feats

def tile_polys(raw):
    from shapely.geometry import Polygon, box
    from shapely.ops import unary_union
    z, x, y, feats = decode_tile(raw); n = 2 ** z
    def ll(px, py):
        gx = (x + px / EXT) / n; gy = (y + py / EXT) / n
        return round(gx * 360 - 180, 6), round(math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy)))), 6)
    tris = []
    for pts, tri in feats:
        tris += [t for t in (Polygon([pts[a], pts[b], pts[c]]) for a, b, c in tri) if t.is_valid and t.area > 0]
    if not tris: return []
    u = unary_union(tris).intersection(box(0, 0, EXT, EXT))
    return [Polygon([ll(*p) for p in g.exterior.coords], [[ll(*p) for p in r.coords] for r in g.interiors])
            for g in (u.geoms if hasattr(u, 'geoms') else [u]) if not g.is_empty and g.geom_type == 'Polygon']

def cmd_decode(a):
    from shapely.geometry import mapping
    from shapely.ops import unary_union
    from shapely.validation import make_valid
    files = sorted(f for f in os.listdir(a.tiles) if f.endswith('.bin'))
    zmax = max(int(f.split('_')[0]) for f in files)
    polys = []
    for i, f in enumerate(files):
        if int(f.split('_')[0]) != zmax: continue                      # only the deepest level
        raw = open(os.path.join(a.tiles, f), 'rb').read()
        if len(raw) <= EMPTY_MAX: continue
        polys += tile_polys(raw)
        if i % 500 == 0: print(f'{i}/{len(files)} tiles, {len(polys)} polys', flush=True)
    if a.no_dissolve:
        geoms = polys
    else:   # dissolve tile seams; grouped by z5 cell so world-size inputs stay tractable
        groups = {}
        for p in polys:
            c = p.representative_point(); groups.setdefault(lonlat_to_tile(c.x, c.y, 5), []).append(p)
        geoms = []
        for k, ps in groups.items():
            u = unary_union([make_valid(p).buffer(0.0002) for p in ps]).buffer(-0.0002).simplify(a.simplify, preserve_topology=True)
            geoms += [g for g in (u.geoms if hasattr(u, 'geoms') else [u]) if not g.is_empty]
    geoms.sort(key=lambda g: -g.area)
    fc = {'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'properties': {'id': i, 'area_km2': round(g.area * 111 * 111 * math.cos(math.radians(g.centroid.y)), 2)},
         'geometry': mapping(g)} for i, g in enumerate(geoms)]}
    json.dump(fc, open(a.out, 'w'))
    print(f'{len(geoms)} polygons -> {a.out}')

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest='cmd', required=True)
    f = sp.add_parser('fetch'); f.add_argument('--key', required=True); f.add_argument('--out', default='tiles')
    f.add_argument('--zoom', type=int, default=8); f.add_argument('--start-zoom', type=int, default=5)
    f.add_argument('--bbox', help='W,S,E,N (default: world)'); f.add_argument('--conc', type=int, default=8)
    d = sp.add_parser('decode'); d.add_argument('--tiles', default='tiles'); d.add_argument('--out', default='coverage.geojson')
    d.add_argument('--simplify', type=float, default=0.0005); d.add_argument('--no-dissolve', action='store_true')
    a = ap.parse_args(); cmd_fetch(a) if a.cmd == 'fetch' else cmd_decode(a)
