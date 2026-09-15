// Regenerates docs/src/components/world-110m.json from Natural Earth 110m
// admin-0 countries: one entry per country with its ISO-3 code (ADM0_A3, since
// ISO_A3 is "-99" for France, Norway and a few others in Natural Earth), its
// English name, and Douglas-Peucker-simplified rings stored as flat integer
// arrays in tenths of a degree, which is what keeps the file ~30 KB.
//
//   curl -sL -o /tmp/ne110.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
//   node docs/scripts/build-world-110m.mjs /tmp/ne110.geojson
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = process.argv[2];
if (!src) throw new Error("usage: node build-world-110m.mjs <ne_110m_admin_0_countries.geojson>");
const geo = JSON.parse(fs.readFileSync(src, "utf8"));

const TOL = 0.15; // degrees; 110m is already coarse, this just drops redundant vertices
function dp(points) {
  if (points.length <= 3) return points;
  const [ax, ay] = points[0], [bx, by] = points[points.length - 1];
  let maxD = 0, idx = 0;
  const len = Math.hypot(bx - ax, by - ay) || 1e-9;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= TOL) return [points[0], points[points.length - 1]];
  return [...dp(points.slice(0, idx + 1)).slice(0, -1), ...dp(points.slice(idx))];
}

// A closed ring starts and ends on the same vertex, which gives plain DP a
// zero-length baseline and collapses everything: split it at the vertex
// farthest from the start and simplify the two halves.
function dpRing(ring) {
  const [sx, sy] = ring[0];
  let far = 1, farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - sx, ring[i][1] - sy);
    if (d > farD) { farD = d; far = i; }
  }
  return [...dp(ring.slice(0, far + 1)).slice(0, -1), ...dp(ring.slice(far))];
}

const out = [];
for (const f of geo.features) {
  const iso = f.properties.ADM0_A3 ?? f.properties.ISO_A3;
  const name = f.properties.NAME_EN ?? f.properties.NAME;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  for (const poly of polys) {
    const outer = dpRing(poly[0]); // outer ring only; holes are invisible at this scale
    if (outer.length < 4) continue;
    rings.push(outer.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]));
  }
  if (rings.length) out.push({ iso, name, rings });
}
out.sort((a, b) => a.iso.localeCompare(b.iso));
const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "world-110m.json");
fs.writeFileSync(dest, JSON.stringify(out));
console.log(out.length, "countries,", out.reduce((n, c) => n + c.rings.length, 0), "rings,", fs.statSync(dest).size, "bytes");
