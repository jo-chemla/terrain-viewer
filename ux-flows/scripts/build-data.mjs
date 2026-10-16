// Builds out/data.json from maps/screens.json, maps/*.md (one flow each, Mermaid inside) and out/captures.json.
// The viewer only reads data.json (and the WebP files beside it), so adding a screen or a flow never touches it.
// out/ is the release-asset layout: flat, data.json plus one <id>.desktop.webp per captured screen.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(await readFile(join(root, 'maps/screens.json'), 'utf8'));
let captures = { profile: null, screens: {} };
try { captures = JSON.parse(await readFile(join(root, 'out/captures.json'), 'utf8')); } catch {}

// --- Mermaid subset parser: `id[Label]`, `id{Label}`, `id([Label])`, edges ==> (main), --> (alternative), -.-> (optional) with |label|.
const NODE = /([A-Za-z_][\w]*)\s*(?:\[([^\]]*)\]|\{([^}]*)\}|\(\[([^\]]*)\]\))?/y;
function parseMermaid(src) {
  const nodes = new Map(); // id -> { id, label, shape }
  const edges = [];
  const declare = (id, label, shape) => {
    if (!nodes.has(id)) nodes.set(id, { id, label: label ?? id, shape });
    else if (label && nodes.get(id).label === id) Object.assign(nodes.get(id), { label, shape });
  };
  for (let line of src.split('\n')) {
    line = line.trim();
    if (!line || /^(flowchart|graph)\b/.test(line) || line.startsWith('%%')) continue;
    const arrow = line.match(/\s*(==>|-->|-\.->)\s*(?:\|([^|]*)\|)?\s*/);
    if (!arrow) { readNode(line, 0); continue; }
    const from = readNode(line, 0);
    const to = readNode(line, arrow.index + arrow[0].length);
    if (!from || !to) continue;
    const weight = arrow[1] === '==>' ? 'main' : arrow[1] === '-->' ? 'alt' : 'optional';
    edges.push({ from: from.id, to: to.id, label: (arrow[2] || '').trim(), weight });
  }
  function readNode(text, at) {
    NODE.lastIndex = at;
    const m = NODE.exec(text);
    if (!m) return null;
    const shape = m[3] !== undefined ? 'decision' : m[4] !== undefined ? 'stadium' : 'box';
    declare(m[1], m[2] ?? m[3] ?? m[4], shape);
    return nodes.get(m[1]);
  }
  return { nodes: [...nodes.values()], edges };
}

const screensById = Object.fromEntries(registry.screens.map((s) => [s.id, s]));
const flows = [];
for (const name of (await readdir(join(root, 'maps'))).filter((f) => f.endsWith('.md')).sort()) {
  const md = await readFile(join(root, 'maps', name), 'utf8');
  const title = (md.match(/^#\s+(.+)$/m) || [, name])[1].trim();
  const [, id = name.replace(/\.md$/, ''), rest = title] = title.match(/^(\w+)\s*·\s*(.+)$/) || [];
  const intro = (md.match(/^Intro:\s*(.+)$/m) || [, ''])[1].trim();
  const notes = (md.match(/^Notes:\s*(.+)$/m) || [, ''])[1].trim();
  const mermaid = (md.match(/```mermaid\n([\s\S]*?)```/) || [, ''])[1];
  const graph = parseMermaid(mermaid);
  const steps = graph.nodes.map((n) => ({
    mid: n.id, label: n.label,
    node: screensById[n.id] ? n.id : null,
    kind: n.shape === 'decision' ? 'decision' : screensById[n.id] ? 'screen' : 'note',
  }));
  const evidence = steps.filter((s) => s.node).every((s) => captures.screens[s.node]?.file) ? 'Observed'
    : steps.some((s) => s.node && captures.screens[s.node]?.file) ? 'Partly observed' : 'Specified';
  flows.push({ id, title: rest, intro, notes, mermaid, steps, edges: graph.edges, evidence, source: `maps/${name}` });
}

// --- Nodes: product root, groups, screens (sitemap order = registry order).
const nodes = {};
const P = registry.product.id;
nodes[P] = { id: P, kind: 'product', label: registry.product.label, parent: null, children: [], flows: [] };
for (const g of registry.groups) {
  const id = `${P}.${g.id}`;
  const parent = g.parent ? `${P}.${g.parent}` : P;
  nodes[id] = { id, kind: 'group', label: g.label, summary: g.summary || '', parent, children: [], flows: [] };
  nodes[parent].children.push(id);
}
for (const s of registry.screens) {
  const parent = `${P}.${s.group}`;
  const cap = captures.screens[s.id];
  const params = new URLSearchParams(registry.defaults);
  for (const [k, v] of new URLSearchParams(s.params)) params.set(k, v);
  nodes[s.id] = {
    id: s.id, kind: s.kind || 'screen', label: s.label, how: s.how || '', parent, children: [],
    url: `${registry.product.base}?${params}`, params: Object.fromEntries(params),
    evidence: cap?.file ? 'Observed' : cap?.error ? 'Not captured' : 'Specified',
    captureError: cap?.error || null,
    screens: cap?.file ? [{ src: cap.file, viewport: 'desktop', sha: cap.sha, width: cap.width, height: cap.height, capturedAt: cap.capturedAt }] : [],
    flows: flows.filter((f) => f.steps.some((st) => st.node === s.id)).map((f) => f.id),
  };
  nodes[parent].children.push(s.id);
}
// Sitemap order: a group's own screens first, in registry order, then its sub-groups.
for (const n of Object.values(nodes)) {
  n.children.sort((a, b) => Number(nodes[a].kind === 'group') - Number(nodes[b].kind === 'group'));
}
// Links derived from flow edges: screen to screen, passing through decisions and notes. A decision's own
// arrow label names the choice, so a link through one carries that label ("Overlay"), not the arrow into it.
const links = [];
for (const f of flows) {
  const through = (id, label, weight, seen = new Set()) => {
    if (nodes[id]) return [{ to: id, label, weight }];
    if (seen.has(id)) return [];
    seen.add(id);
    return f.edges.filter((e) => e.from === id).flatMap((e) => through(e.to, e.label || label, e.weight, seen));
  };
  for (const e of f.edges) {
    if (!nodes[e.from]) continue;
    for (const { to, label, weight } of through(e.to, e.label, e.weight)) {
      const dup = links.find((l) => l.from === e.from && l.to === to);
      if (dup) { if (!dup.flows.includes(f.id)) dup.flows.push(f.id); continue; }
      links.push({ from: e.from, to, label, weight, flows: [f.id] });
      nodes[e.from].linksTo ??= []; nodes[to].linkedFrom ??= [];
      nodes[e.from].linksTo.push(to); nodes[to].linkedFrom.push(e.from);
    }
  }
}

flows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
const data = {
  meta: {
    builtAt: new Date().toISOString(),
    capture: captures.profile,
    captured: registry.screens.filter((s) => captures.screens[s.id]?.file).length,
    failed: registry.screens.filter((s) => captures.screens[s.id]?.error).length,
    total: registry.screens.length,
    base: captures.base || registry.product.base,
    source: process.env.UX_FLOWS_SOURCE || null, // "<repo>@<sha>" from the workflow, so the chip can say what was shot
  },
  products: [{ id: P, label: registry.product.label, root: P }],
  nodes, flows, links,
};
await mkdir(join(root, 'out'), { recursive: true });
await writeFile(join(root, 'out/data.json'), JSON.stringify(data, null, 1));
console.log(`data.json: ${Object.keys(nodes).length} nodes, ${flows.length} flows, ${data.meta.captured}/${data.meta.total} captured`);
