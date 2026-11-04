// Fails the build when a Planet API key is in the output. A key in a build is a
// public key: the bundle is readable by anyone. vite.config.ts blanks
// VITE_PLANET_API_KEY for builds; this scan runs after every build, local or
// CI, and catches anything that stops doing so (a new env read, a plugin
// change, a key pasted into source). Planet keys start with PLAK. The deploy
// and desktop workflows run the same check on dist/ after the docs merge.
//   node scripts/check-no-planet-key.mjs [dir ...]   (default: dist)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const KEY = /PLAK[0-9a-zA-Z]{10,}/;
const dirs = process.argv.slice(2);
if (dirs.length === 0) dirs.push("dist");

const hits = [];
function walk(path) {
  let st;
  try { st = statSync(path); } catch { return; }
  if (st.isDirectory()) { for (const n of readdirSync(path)) walk(join(path, n)); return; }
  if (st.size > 64 * 1024 * 1024) return;
  if (KEY.test(readFileSync(path, "latin1"))) hits.push(path);
}
for (const d of dirs) walk(d);

if (hits.length) {
  console.error("A Planet API key is in the build, and it must never ship:");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log(`No Planet key in ${dirs.join(", ")}.`);
