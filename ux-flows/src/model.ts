// Data types (mirror of scripts/build-data.mjs output) and the flow-path logic:
// a flow is a graph in Mermaid order; a path walks real arrows from the start, taking the reviewer's
// choice at each branch or the default way on (main route, then first alternative, then first optional).

export type Evidence = 'Observed' | 'Specified' | 'Not captured' | 'Partly observed';
export interface Shot { src: string; viewport: string; sha: string; width: number; height: number; capturedAt: string }
export interface Node {
  id: string; kind: 'product' | 'group' | 'screen' | 'state' | 'overlay'; label: string; parent: string | null;
  children: string[]; summary?: string; how?: string; url?: string; params?: Record<string, string>;
  evidence?: Evidence; captureError?: string | null; screens?: Shot[]; flows: string[]; linksTo?: string[]; linkedFrom?: string[];
}
export interface Step { mid: string; label: string; node: string | null; kind: 'screen' | 'decision' | 'note' }
export interface Edge { from: string; to: string; label: string; weight: 'main' | 'alt' | 'optional' }
export interface Flow { id: string; title: string; intro: string; notes: string; mermaid: string; steps: Step[]; edges: Edge[]; evidence: Evidence; source: string }
export interface Link { from: string; to: string; label: string; weight: Edge['weight']; flows: string[] }
export interface Data {
  meta: { builtAt: string; capture: { label: string; width: number; height: number } | null; captured: number; failed: number; total: number; base: string; source?: string | null };
  products: { id: string; label: string; root: string }[];
  nodes: Record<string, Node>;
  flows: Flow[];
  links: Link[];
}

export type Choices = Record<string, string>; // mid of the step where a branch was chosen -> mid chosen
export interface PathStep extends Step { n: number; options: Edge[]; chosen: Edge | null }

export function optionsAt(flow: Flow, mid: string): Edge[] {
  return flow.edges.filter((e) => e.from === mid);
}
export function defaultOption(options: Edge[]): Edge | null {
  return options.find((o) => o.weight === 'main') ?? options.find((o) => o.weight === 'alt') ?? options.find((o) => o.weight === 'optional') ?? null;
}
/** Walks the flow from its first declared node, following choices; stops where only optional arrows leave (unless chosen) or on a repeat. */
export function flowPath(flow: Flow, choices: Choices): PathStep[] {
  const byMid = Object.fromEntries(flow.steps.map((s) => [s.mid, s]));
  const path: PathStep[] = [];
  const seen = new Set<string>();
  let mid: string | null = flow.steps[0]?.mid ?? null;
  while (mid && !seen.has(mid) && byMid[mid]) {
    seen.add(mid);
    const options = optionsAt(flow, mid);
    const wanted: string | undefined = choices[mid];
    let chosen: Edge | null = wanted ? options.find((o) => o.to === wanted) ?? null : null;
    if (!chosen) {
      const real = options.filter((o) => o.weight !== 'optional');
      chosen = real.length ? defaultOption(real) : null; // only dotted arrows leave: the path ends here by default
    }
    path.push({ ...byMid[mid], n: path.length + 1, options, chosen });
    mid = chosen?.to ?? null;
  }
  return path;
}
export function stepForNode(path: PathStep[], node: string | null): PathStep | undefined {
  return node ? path.find((s) => s.node === node) : undefined;
}
export function ancestors(nodes: Record<string, Node>, id: string): string[] {
  const out: string[] = [];
  let cur = nodes[id]?.parent;
  while (cur) { out.unshift(cur); cur = nodes[cur]?.parent ?? null; }
  return out;
}
