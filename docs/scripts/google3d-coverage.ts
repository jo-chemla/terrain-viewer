#!/usr/bin/env -S npx tsx
/**
 * The fetch + decode half of the Google 3D coverage pipeline; the dissolve
 * half is dissolve-google-3d-coverage.mjs. `pnpm google-3d-fetch` runs this
 * for z8, z9 and z10. The write-up of the whole pipeline, with timings and
 * where every intermediate lands, is in the docs: /features/coverage-overlays.
 *
 * From a parallel investigation of Jonathan's; kept verbatim apart from this
 * header. The companion Python version is build-google-3d-coverage.py.
 *
 * ## Verified here
 *
 * Fetch and decode both work from Node with no browser: mapConfigs:batchGet
 * mints the layer id from an ordinary API key, the world at z8 is 4 120
 * requests / 32 MB / 1 930 non-empty tiles in about a minute, and decoding
 * those 1 156 z8 tiles takes 4.4 s and yields 17 937 polygons.
 *
 * Two details in here fixed bugs an earlier hand-rolled decoder had, and both
 * are worth not re-introducing: collinear ZERO-AREA triangles are part of the
 * meshes and must be counted (skipping them leaves phantom boundary edges that
 * silently delete whole features), and clamping vertices to the tile box
 * produces invalid rings - the ~0.7% buffer should be kept instead.
 *
 * ## What the data actually looks like (measured 2026-09-23)
 *
 * The layer is GENERALISED PER ZOOM, and no single zoom is complete. By
 * point-in-triangle against the raw mesh, which no ring or hole logic can
 * affect: London, New York and Berlin are present at z10 and absent at z8;
 * Tokyo is present at z8 and absent at z10; Tours only at z9. So the world
 * has to be crawled at several zooms and the polygons UNIONED. Scored against
 * 39 places Google Earth answers for:
 *
 *      z8 alone            25/39     17 937 polygons     53 MB
 *      z9 alone            26/39     24 137 polygons     84 MB
 *      z10 alone           29/39     31 243 polygons     88 MB
 *      z8 + z10            33/39     49 180 polygons    141 MB
 *      z8 + z9 + z10       34/39     73 317 polygons    225 MB
 *
 * The five still "missed" by the 3-way union - Le Havre, Deauville, Blois,
 * Le Mans, Dijon - are inside zero triangles at EVERY zoom, and yet each has
 * coverage geometry 0.3-3.3 km from the test point. They are in the dataset;
 * the polygons are simply tighter than a city-centre coordinate. Paris's own
 * nearest vertex is 0.5 km away and it hits. Treat the union as complete.
 *
 * Cost of the union: z10 is 19 768 requests and 95 MB of tiles (z5-z10, all
 * cached), a minute of fetch and 15 s of decode.
 *
 * ## Shipping it
 *
 * dissolve-google-3d-coverage.mjs takes the per-zoom outputs and unions them
 * per 5x5 degree bucket with @turf/turf (polygon-clipping underneath, already
 * a dependency), simplifies, truncates coordinates to 3 decimals and drops
 * rings under a square kilometre. 225 MB of overlapping polygons becomes a
 * few MB, ~0.6 MB over the wire, with the same score against ground truth.
 * The first, gentle pass (200 m, 4 decimals, 0.5 km2) left 69 MB: the
 * tile-clipped triangle outlines are dense enough that only a brutal
 * tolerance bites, and at coverage scale nothing under a kilometre is
 * information.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MAP_ID = 'ccfdf8d031b6b83cc90ddc70';
const EXT = 8192, EMPTY_MAX = 64, XOR = 0x9b;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

// ------------------------------------------------------------------ fetch
async function get(url: string, retries = 5): Promise<{ status: number; data: Uint8Array }> {
  for (let a = 0; a < retries; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (a + 1)); continue; }
      return { status: r.status, data: new Uint8Array(await r.arrayBuffer()) };
    } catch { await sleep(1000 * (a + 1)); }
  }
  return { status: 0, data: new Uint8Array() };
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function layerTemplate(key: string): Promise<string> {
  const { status, data } = await get(`https://maps.googleapis.com/maps/api/mapsjs/mapConfigs:batchGet?alt=protojson&map_ids=${MAP_ID}&map_type=1&language=en-US&region=US&key=${key}`);
  const txt = new TextDecoder().decode(data);
  const m = txt.match(/ml:xs:c:[A-Za-z0-9_-]+/);
  if (status !== 200 || !m) throw new Error(`mapConfigs failed (${status}): ${txt.slice(0, 300)}`);
  const ep = txt.match(/\[(\d{8}),(\d{8})\]/); const [a, b] = ep ? [ep[1], ep[2]] : ['47083502', '56565656'];
  return `https://maps.googleapis.com/maps/vt/pb=!1m4!1m3!1i{z}!2i{x}!3i{y}!2m2!1e2!2s${encodeURIComponent(m[0])}` +
    `!3m9!2sen-US!3sUS!5e18!12m5!1e68!2m2!1sset!2sRoadmap!4e2!4e1!5m4!1e4!8m2!1e0!1e1` +
    `!6m9!1e12!2i2!19m1!1e0!20m1!1e0!39b1!44e1!50e0!23i${a}!23i${b}!23i47054750!23i46991212!26m2!1e2!1e3!28i796`;
}
const tileUrl = (t: string, z: number, x: number, y: number) => t.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z, r = lat * Math.PI / 180;
  const x = Math.floor((lon + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

async function cmdFetch(o: Record<string, string>) {
  const out = o.out ?? 'tiles', zoom = +(o.zoom ?? 8), z0 = Math.min(+(o['start-zoom'] ?? 5), zoom), conc = +(o.conc ?? 8);
  mkdirSync(out, { recursive: true });
  const tmpl = await layerTemplate(o.key);
  let x0 = 0, y0 = 0, x1 = 2 ** z0 - 1, y1 = x1;
  if (o.bbox) { const [w, s, e, n] = o.bbox.split(',').map(Number); [x0, y0] = lonLatToTile(w, n, z0); [x1, y1] = lonLatToTile(e, s, z0); }
  let queue: [number, number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) queue.push([z0, x, y]);
  const stat = { req: 0, cached: 0, nonEmpty: 0, bytes: 0, err: 0 };
  const t0 = Date.now();
  while (queue.length) {
    const next: [number, number, number][] = []; let i = 0;
    await Promise.all(Array.from({ length: conc }, async () => {
      while (i < queue.length) {
        const [z, x, y] = queue[i++]; const fn = join(out, `${z}_${x}_${y}.bin`);
        let data: Uint8Array;
        if (existsSync(fn)) { data = readFileSync(fn); stat.cached++; }
        else {
          const r = await get(tileUrl(tmpl, z, x, y)); stat.req++;
          if (r.status !== 200 || (r.data[3] ^ XOR) !== z) { stat.err++; continue; }
          data = r.data; writeFileSync(fn, data);
        }
        if (data.length <= EMPTY_MAX) continue;
        stat.nonEmpty++; stat.bytes += data.length;
        if (z < zoom) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) next.push([z + 1, 2 * x + dx, 2 * y + dy]);
      }
    }));
    console.log(`z${queue[0][0]} done ${JSON.stringify(stat)} next ${next.length} tiles, ${((Date.now() - t0) / 1000) | 0}s`);
    queue = next;
  }
}

// ------------------------------------------------------------------ protobuf
type Field = { f: number; v: number | Uint8Array };
function parse(b: Uint8Array): Field[] {
  const out: Field[] = []; let i = 0;
  const rv = () => { let r = 0, s = 0; for (;;) { const c = b[i++]; r += (c & 0x7f) * 2 ** s; s += 7; if (!(c & 0x80)) return r; } };
  while (i < b.length) {
    const k = rv(), f = Math.floor(k / 8), w = k & 7;
    if (w === 0) out.push({ f, v: rv() });
    else if (w === 2) { const l = rv(); out.push({ f, v: b.subarray(i, i + l) }); i += l; }
    else if (w === 5) { out.push({ f, v: b.subarray(i, i + 4) }); i += 4; }
    else if (w === 1) { out.push({ f, v: b.subarray(i, i + 8) }); i += 8; }
    else throw new Error('bad wire type');
  }
  return out;
}
function varints(b: Uint8Array): number[] {
  const out: number[] = []; let i = 0;
  while (i < b.length) { let r = 0, s = 0; for (;;) { const c = b[i++]; r += (c & 0x7f) * 2 ** s; s += 7; if (!(c & 0x80)) break; } out.push(r); }
  return out;
}
const zz = (v: number) => (v % 2 ? -(v + 1) / 2 : v / 2);

export interface Mesh { pts: number[]; tris: number[] } // pts: flat [x0,y0,x1,y1,...] tile units; tris: flat index triples
export function decodeTile(raw: Uint8Array): { z: number; x: number; y: number; meshes: Mesh[] } {
  const b = raw.map(c => c ^ XOR);
  const top = parse(b);
  const hdr = Object.fromEntries(parse(top.find(f => f.f === 1)!.v as Uint8Array).map(f => [f.f, f.v]));
  const meshes: Mesh[] = [];
  for (const { f, v } of top) {
    if (f !== 8) continue;
    for (const feat of parse(v as Uint8Array)) {
      if (feat.f !== 1) continue;
      const geom = parse(feat.v as Uint8Array).find(g => g.f === 1); if (!geom) continue;
      const g = Object.fromEntries(parse(geom.v as Uint8Array).map(x => [x.f, x.v]));
      if (!(g[1] instanceof Uint8Array)) continue;
      const vs = varints(g[1]); const idx = g[2] instanceof Uint8Array ? varints(g[2]) : [];
      const pts = [vs[0], vs[1]];
      for (let i = 2; i + 1 < vs.length; i += 2) pts.push(pts[pts.length - 2] + zz(vs[i]), pts[pts.length - 1] + zz(vs[i + 1]));
      const n = pts.length / 2, tris: number[] = [];
      for (let i = 0; i + 2 < idx.length; i += 3) if (idx[i] < n && idx[i + 1] < n && idx[i + 2] < n) tris.push(idx[i], idx[i + 1], idx[i + 2]);
      meshes.push({ pts, tris });
    }
  }
  return { z: hdr[1] as number, x: hdr[2] as number, y: hdr[3] as number, meshes };
}

// ------------------------------------------------------------------ mesh -> rings
type Ring = number[][]; // [[x,y],...] closed
/** Boundary of a triangulated polygon = edges used by exactly one triangle (undirected; degenerate triangles count too). */
export function meshToRings(m: Mesh): Ring[] {
  const { pts } = m, n = pts.length / 2;
  // merge vertices that share a coordinate, so shared edges cancel regardless of index
  const canon = new Map<number, number>(), remap = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = pts[2 * i] * 65536 + pts[2 * i + 1] + 2 ** 30; remap[i] = canon.get(k) ?? (canon.set(k, i), i); }
  const tris = m.tris.map(i => remap[i]);
  const cnt = new Map<number, number>();
  const key = (u: number, v: number) => (u < v ? u * n + v : v * n + u);
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    if (a === b || b === c || a === c) continue;
    for (const k of [key(a, b), key(b, c), key(c, a)]) cnt.set(k, (cnt.get(k) ?? 0) + 1);
  }
  const adj = new Map<number, number[]>();
  for (const [k, c] of cnt) if (c === 1) {
    const u = Math.floor(k / n), v = k % n;
    (adj.get(u) ?? adj.set(u, []).get(u)!).push(v); (adj.get(v) ?? adj.set(v, []).get(v)!).push(u);
  }
  const rings: Ring[] = [];
  const emit = (ids: number[]) => { if (ids.length >= 3) rings.push([...ids, ids[0]].map(v => [pts[2 * v], pts[2 * v + 1]])); };
  for (const [start] of adj) {
    while (adj.get(start)?.length) {
      const ids: number[] = []; const pos = new Map<number, number>(); let prev = -1, cur = start;
      for (let guard = 0; guard < n * 3; guard++) {
        const outs = adj.get(cur); if (!outs?.length) break;
        let j = outs.findIndex(v => v !== prev); if (j < 0) j = 0;
        const nx = outs.splice(j, 1)[0];
        const back = adj.get(nx)!, bi = back.indexOf(cur); if (bi >= 0) back.splice(bi, 1);
        pos.set(cur, ids.length); ids.push(cur); prev = cur; cur = nx;
        if (cur === start) break;
        if (pos.has(cur)) {                       // pinch point: split off the inner loop as its own ring
          const loop = ids.splice(pos.get(cur)!); emit(loop);
          for (const v of loop) pos.delete(v);
        }
      }
      emit(ids);
    }
  }
  return rings;
}
const signedArea = (r: Ring) => { let a = 0; for (let i = 0; i + 1 < r.length; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; };
function pointInRing(p: number[], r: Ring) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length - 1; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Nesting: a ring inside an odd number of larger rings is a hole of the smallest ring containing it. Outers CCW, holes CW. */
export function ringsToPolygons(rings: Ring[]): Ring[][] {
  const rs = rings.map(r => ({ r, a: Math.abs(signedArea(r)) })).sort((x, y) => y.a - x.a);
  const inside = (r: Ring, o: Ring) => { let k = 0, t = 0; for (let q = 0; q < r.length - 1; q += Math.max(1, (r.length - 1) >> 4)) { t++; if (pointInRing(r[q], o)) k++; } return k * 2 > t; };
  const depth = rs.map((x, i) => { let d = 0; for (let j = 0; j < i; j++) if (rs[j].a > x.a && inside(x.r, rs[j].r)) d++; return d; });
  const orient = (r: Ring, ccw: boolean) => (signedArea(r) > 0) === ccw ? r : r.slice().reverse();
  const polys: Ring[][] = [], owner: number[] = [];
  rs.forEach((x, i) => {
    if (depth[i] % 2 === 0) { owner[i] = polys.length; polys.push([orient(x.r, true)]); return; }
    let best = -1, bestN = 0;
    for (let j = i - 1; j >= 0; j--) if (depth[j] % 2 === 0) {
      let k = 0; for (let q = 0; q < x.r.length - 1; q += Math.max(1, (x.r.length - 1) >> 4)) if (pointInRing(x.r[q], rs[j].r)) k++;
      if (k > bestN) { bestN = k; best = j; if (k === x.r.length - 1) break; }
    }
    if (best >= 0) polys[owner[best]].push(orient(x.r, false));
  });
  return polys;
}

// ------------------------------------------------------------------ decode command
function tileToLonLat(z: number, x: number, y: number) {
  const n = 2 ** z;
  return (px: number, py: number): [number, number] => {
    const gx = (x + px / EXT) / n, gy = (y + py / EXT) / n;
    return [+(gx * 360 - 180).toFixed(6), +(Math.atan(Math.sinh(Math.PI * (1 - 2 * gy))) * 180 / Math.PI).toFixed(6)];
  };
}
export function tileToPolygons(raw: Uint8Array): [number, number][][][] {
  const { z, x, y, meshes } = decodeTile(raw); const ll = tileToLonLat(z, x, y);
  const out: [number, number][][][] = [];
  for (const m of meshes) for (const poly of ringsToPolygons(meshToRings(m))) {
    const rings = poly.map(r => r.map(p => ll(p[0], p[1])).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])).filter(r => r.length >= 4);
    if (rings.length) out.push(rings);
  }
  return out;
}
const areaKm2 = (poly: [number, number][][]) => { // outer ring only, equirect approx
  const r = poly[0], lat = r[0][1] * Math.PI / 180; let a = 0;
  for (let i = 0; i + 1 < r.length; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return +(Math.abs(a / 2) * 111.32 * 111.32 * Math.cos(lat)).toFixed(3);
};

async function cmdDecode(o: Record<string, string>) {
  const dir = o.tiles ?? 'tiles', out = o.out ?? 'coverage.geojson';
  const files = readdirSync(dir).filter(f => f.endsWith('.bin'));
  // --zoom N decodes that level out of a crawl directory instead of only the
  // deepest one. A crawl to z10 leaves z5..z10 on disk, and every level
  // carries a DIFFERENT subset of the coverage (measured on central Paris:
  // z8..z13 each ~25% of the tile, all six together 72%), so the shallower
  // levels are worth decoding too.
  const zmax = o.zoom ? +o.zoom : Math.max(...files.map(f => +f.split('_')[0]));
  let polys: [number, number][][][] = []; const t0 = Date.now(); let nt = 0;
  for (const f of files) {
    if (+f.split('_')[0] !== zmax) continue;
    const raw = readFileSync(join(dir, f)); if (raw.length <= EMPTY_MAX) continue;
    polys.push(...tileToPolygons(raw)); nt++;
  }
  console.log(`${nt} tiles -> ${polys.length} polygons in ${Date.now() - t0} ms`);
  // No --dissolve here any more. It used to `import('polygon-clipping')`,
  // which is not a dependency - the docs' `next build` typechecks this file
  // and failed on it. Dissolving is dissolve-google-3d-coverage.mjs's job,
  // via @turf/turf, which IS a dependency and carries the same clipper.
  polys.sort((a, b) => areaKm2(b) - areaKm2(a));
  const fc = { type: 'FeatureCollection', features: polys.map((p, id) => ({ type: 'Feature', properties: { id, area_km2: areaKm2(p) }, geometry: { type: 'Polygon', coordinates: p } })) };
  writeFileSync(out, JSON.stringify(fc));
  console.log(`${polys.length} polygons -> ${out}`);
}

// ------------------------------------------------------------------ cli
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { const k = rest[i].slice(2); opts[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : ''; }
  if (cmd === 'fetch') { if (!opts.key) throw new Error('--key required'); await cmdFetch(opts); }
  else if (cmd === 'decode') await cmdDecode(opts);
  else console.log('usage: fetch --key K [--out tiles --zoom 8 --bbox W,S,E,N --conc 8] | decode [--tiles tiles --out x.geojson --zoom N]');
}
main().catch(e => { console.error(e); process.exit(1); });
