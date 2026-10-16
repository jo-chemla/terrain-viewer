// Captures one WebP screenshot per screen in maps/screens.json with agent-browser, into out/ (flat, release-asset
// shaped), and writes out/captures.json. Each screen is a Terrain Viewer URL (base + defaults + params), so most
// captures are: open, wait for tiles, shoot. Screens whose state is not in the URL list `actions` replayed first.
//
// Usage: node ux-flows/scripts/capture.mjs [screenId ...]   (no ids = every screen; existing captures are redone)
// Env:   UX_FLOWS_BASE_URL  the app to shoot (default: the product base in screens.json, i.e. production)
//        SETTLE_MS (default 9000)   AB_SESSION (default ux-flows)   AB_BIN (default "npx --no-install agent-browser")
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(await readFile(join(root, 'maps/screens.json'), 'utf8'));
const outDir = join(root, 'out');
await mkdir(outDir, { recursive: true });

const manifestPath = join(outDir, 'captures.json');
let manifest = { profile: { label: 'Desktop', width: 1440, height: 900, scale: 1 }, screens: {} };
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch {}
manifest.tool = 'agent-browser';
const base = process.env.UX_FLOWS_BASE_URL || registry.product.base;
manifest.base = base;

const only = new Set(process.argv.slice(2));
const screens = registry.screens.filter((s) => !only.size || only.has(s.id));
const settle = Number(process.env.SETTLE_MS || 9000);
const session = process.env.AB_SESSION || 'ux-flows';
const bin = (process.env.AB_BIN || 'npx --no-install agent-browser').split(' ');

export function screenUrl(screen) {
  const params = new URLSearchParams(registry.defaults);
  for (const [k, v] of new URLSearchParams(screen.params)) params.set(k, v);
  return `${base}?${params}`;
}

/** Runs one agent-browser command in the capture session. Returns { ok, out }. */
function ab(...args) {
  // Windows needs a shell to find npx.cmd, and the shell needs every argument quoted (URLs carry `&`).
  const win = process.platform === 'win32';
  const argv = [...bin.slice(1), '--session', session, ...args].map((a) => (win ? `"${a.replace(/"/g, '\\"')}"` : a));
  const r = spawnSync(bin[0], argv, { encoding: 'utf8', shell: win, timeout: 90000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return { ok: r.status === 0, out };
}

/** The screen's action list, with `actionsFrom` chains resolved (an earlier screen's actions first, then its own). */
function actionsOf(screen, seen = new Set()) {
  if (!screen || seen.has(screen.id)) return [];
  seen.add(screen.id);
  const from = screen.actionsFrom ? actionsOf(registry.screens.find((s) => s.id === screen.actionsFrom), seen) : [];
  return [...from, ...(screen.actions || [])];
}

/** Runs in-app actions that are not URL state. Each action is one of:
 *  { find: <regex over a `snapshot -i` line>, do: "click" | "fill" | "scroll", value?: string, settle?: ms }  (first matching ref)
 *  { mouse: [x, y] }  a click on the map at viewport pixels      { press: "Escape" }      { wait: ms }
 *  Throws with the action when nothing matches, so a renamed or removed control fails the capture
 *  instead of shooting the wrong state. */
function runActions(actions) {
  for (const a of actions) {
    if (a.wait) { ab('wait', String(a.wait)); continue; }
    if (a.press) { ab('press', a.press); continue; }
    if (a.mouse) { ab('mouse', 'move', String(a.mouse[0]), String(a.mouse[1])); ab('mouse', 'down'); ab('mouse', 'up'); continue; }
    // The target may appear a few seconds after the page settles (sections open after the app initialises): poll for it.
    const re = new RegExp(a.find);
    let ref = null, snap = [];
    for (let tries = 0; tries < 6 && !ref; tries++) {
      if (tries) ab('wait', '3000');
      snap = ab('snapshot', '-i').out.split('\n');
      const line = snap.find((l) => re.test(l));
      ref = line ? (line.match(/\bref=(e\d+)/) || [])[1] : null;
    }
    if (!ref) {
      writeFileSync(join(outDir, 'capture-debug.txt'), snap.join('\n'));
      throw new Error(`action found nothing: ${JSON.stringify(a)} (snapshot saved to out/capture-debug.txt)`);
    }
    if (a.do === 'fill') { ab('fill', `@${ref}`, String(a.value)); ab('press', 'Enter'); }
    else if (a.do === 'scroll') ab('scrollintoview', `@${ref}`);
    else ab('click', `@${ref}`);
    ab('wait', String(a.settle ?? 1200));
  }
}

ab('close'); // a clean session, so a stale page from an earlier run is never shot
for (const screen of screens) {
  const url = screenUrl(screen);
  const file = `${screen.id}.desktop.webp`;
  const jpg = join(outDir, `${screen.id}.tmp.jpg`);
  const started = Date.now();
  // The viewer remembers sidebar and tool state in local storage, so every screen starts from a cleared store:
  // open once to be on the origin, clear, then reload so only the URL (and the listed actions) define the state.
  const steps = [
    ['open', url],
    ['storage', 'local', 'clear'],
    ['reload'],
    ['set', 'viewport', String(manifest.profile.width), String(manifest.profile.height)],
    ['wait', String(settle)], // tiles and WebGL passes; a tile server never goes network-idle, so a fixed settle
  ];
  let failure = null;
  for (const step of steps) {
    const r = ab(...step);
    if (!r.ok && step[0] !== 'wait') { failure = `${step.join(' ')}: ${r.out.slice(0, 300)}`; break; }
  }
  const actions = actionsOf(screen);
  if (!failure && actions.length) {
    try { runActions(actions); } catch (err) { failure = String(err.message || err); }
  }
  if (!failure) {
    const r = ab('screenshot', jpg, '--screenshot-format', 'jpeg', '--screenshot-quality', '95');
    if (!r.ok) failure = `screenshot: ${r.out.slice(0, 300)}`;
  }
  if (!failure) {
    // agent-browser writes PNG or JPEG; WebP at this quality is about half the JPEG at the same look.
    const buf = await sharp(jpg).webp({ quality: 82 }).toBuffer();
    await writeFile(join(outDir, file), buf);
    await rm(jpg, { force: true });
    manifest.screens[screen.id] = {
      file, url, sha: createHash('sha256').update(buf).digest('hex').slice(0, 16),
      width: manifest.profile.width, height: manifest.profile.height,
      capturedAt: new Date().toISOString(), ms: Date.now() - started, actions: actions.length || undefined,
    };
    console.log(`ok   ${screen.id}  ${Date.now() - started} ms`);
  } else {
    await rm(jpg, { force: true });
    manifest.screens[screen.id] = { url, error: failure, capturedAt: new Date().toISOString() };
    console.log(`FAIL ${screen.id}  ${failure}`);
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
ab('close');
