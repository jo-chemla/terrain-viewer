import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Moon, PanelRightOpen, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Choices, Data, Flow } from './model';
import { flowPath, stepForNode } from './model';
import { Sitemap } from './Sitemap';
import { Stage, Inspector } from './Stage';
import { Player } from './Player';
import { FlowsView } from './FlowsView';
import { Canvas } from './Canvas';

export type View = 'map' | 'canvas' | 'flows';
const VIEWS: [View, string][] = [['map', 'Map'], ['canvas', 'Canvas'], ['flows', 'Flows']];
export interface UiState { view: View; node: string | null; flow: string | null; step: number | null; choices: Record<string, Choices> }

// --- Address: everything the page shows lives in the hash, so a link reproduces a view, a step and its branch choices.
function readHash(data: Data): UiState {
  const p = new URLSearchParams(location.hash.slice(1));
  const view = (VIEWS.some(([v]) => v === p.get('view')) ? p.get('view') : 'map') as View;
  const node = p.get('node') && data.nodes[p.get('node')!] ? p.get('node') : null;
  const flow = p.get('flow') && data.flows.some((f) => f.id === p.get('flow')) ? p.get('flow') : null;
  const step = p.get('step') ? Number(p.get('step')) : null;
  const choices: Record<string, Choices> = {};
  if (flow && p.get('branches')) {
    choices[flow] = Object.fromEntries(p.get('branches')!.split(',').filter(Boolean).map((pair) => pair.split(':') as [string, string]));
  }
  // A step without a node in the address shows that step's screen.
  if (flow && step && !node) {
    const f = data.flows.find((x) => x.id === flow)!;
    const st = flowPath(f, choices[flow] || {})[step - 1];
    if (st?.node) return { view, node: st.node, flow, step, choices };
  }
  return { view, node, flow, step, choices };
}
function writeHash(s: UiState) {
  const p = new URLSearchParams();
  p.set('view', s.view);
  if (s.node) p.set('node', s.node);
  if (s.flow) {
    p.set('flow', s.flow);
    if (s.step) p.set('step', String(s.step));
    const ch = s.choices[s.flow] || {};
    const branches = Object.entries(ch).map(([k, v]) => `${k}:${v}`).join(',');
    if (branches) p.set('branches', branches);
  }
  const next = `#${p}`;
  if (location.hash !== next) history.pushState(null, '', next);
}

// Where data.json and the screenshots live. They are build outputs, never committed: the capture workflow
// publishes them as the assets of the `ux-flows-latest` release and the Pages deploy copies them into
// ./captures/ beside this page (a browser cannot fetch data.json from the release itself: no CORS headers
// there). In dev they are ux-flows/out/ as written by `pnpm ux-flows:capture`. `?assets=<url>` points the
// viewer at any other folder.
const RELEASE_ASSETS = './captures/';
function assetBase(): string {
  const asked = new URLSearchParams(location.search).get('assets');
  const base = asked ?? (import.meta.env.DEV ? './out/' : RELEASE_ASSETS);
  return new URL(base.endsWith('/') ? base : `${base}/`, location.href).href;
}

function useDarkMode() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('ux-flows-theme', next ? 'dark' : 'light');
    setDark(next);
  };
  return { dark, toggle };
}

export function App() {
  const [data, setData] = useState<Data | null>(null);
  const [ui, setUi] = useState<UiState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { dark, toggle } = useDarkMode();
  // The inspector can be folded away; the choice is remembered in this browser.
  const [inspectorOpen, setInspectorOpen] = useState(() => localStorage.getItem('ux-flows-inspector') !== 'closed');
  const toggleInspector = () => setInspectorOpen((o) => { localStorage.setItem('ux-flows-inspector', o ? 'closed' : 'open'); return !o; });

  useEffect(() => {
    const base = assetBase();
    fetch(`${base}data.json`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    }).then((d: Data) => {
      // Screenshot paths are relative to data.json; resolve them once so every view just uses `src`.
      for (const n of Object.values(d.nodes)) for (const s of n.screens ?? []) s.src = new URL(s.src, base).href;
      const s = readHash(d);
      if (!s.node) s.node = firstScreen(d);
      setData(d); setUi(s);
    }).catch((e) => setError(import.meta.env.DEV
      ? `Could not load ${base}data.json: ${e.message}. Run "pnpm ux-flows:capture" and "pnpm ux-flows:data" for a local copy, or pass ?assets=<url>.`
      : `No captures on this site yet (${base}data.json: ${e.message}). Run the "UX flows capture" workflow in the repository's Actions tab; it publishes the screens and redeploys the site.`));
  }, []);
  useEffect(() => {
    if (!data) return;
    const onPop = () => setUi(readHash(data));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [data]);
  useEffect(() => { if (ui) writeHash(ui); }, [ui]);

  const flow: Flow | null = useMemo(() => data && ui?.flow ? data.flows.find((f) => f.id === ui.flow) ?? null : null, [data, ui?.flow]);
  const path = useMemo(() => flow && ui ? flowPath(flow, ui.choices[flow.id] || {}) : [], [flow, ui?.choices]);

  if (error) return <div className="m-8 max-w-prose text-sm text-destructive">{error}</div>;
  if (!data || !ui) return <div className="m-8 text-sm text-muted-foreground">Loading the UX flows…</div>;

  // --- Actions. Selecting a screen keeps the flow playing; if the screen is on the path, the step follows it.
  const selectNode = (id: string) => setUi((s) => {
    const onPath = stepForNode(path, id);
    return { ...s!, view: 'map', node: id, step: onPath ? onPath.n : s!.step };
  });
  const goToStep = (n: number) => setUi((s) => {
    const st = path[n - 1];
    return { ...s!, step: n, node: st?.node ?? s!.node, view: 'map' };
  });
  const setFlow = (id: string | null, play = false) => setUi((s) => {
    const f = data.flows.find((x) => x.id === id);
    if (!f) return { ...s!, flow: null, step: null };
    const p = flowPath(f, s!.choices[f.id] || {});
    const onPath = stepForNode(p, s!.node);
    const step = onPath ? onPath.n : 1;
    return { ...s!, flow: f.id, step, node: play ? p[step - 1]?.node ?? s!.node : s!.node, view: play ? 'map' : s!.view };
  });
  const chooseBranch = (atMid: string, toMid: string) => setUi((s) => {
    const f = flow!;
    const choices = { ...s!.choices, [f.id]: { ...(s!.choices[f.id] || {}), [atMid]: toMid } };
    const p = flowPath(f, choices[f.id]);
    const at = p.find((x) => x.mid === atMid);
    const next = at ? p[at.n] : null;
    return { ...s!, choices, step: next ? next.n : at?.n ?? s!.step, node: next?.node ?? s!.node };
  });
  const setView = (view: View) => setUi((s) => ({ ...s!, view }));

  const currentStep = ui.step && path[ui.step - 1] ? path[ui.step - 1] : null;
  const onStep = !!currentStep && (currentStep.node === ui.node || !currentStep.node);
  const product = data.products[0];
  const source = data.meta.source ? data.meta.source.replace(/^.*@/, '@').slice(0, 8) : '';
  // The header link is contextual: the selected screen's own URL state when there is one, else the app's front door.
  const openNode = ui.node && data.nodes[ui.node]?.url ? data.nodes[ui.node] : null;
  const openUrl = openNode?.url ?? data.meta.base;

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col bg-background text-foreground">
        <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1">
          <span className="text-sm font-semibold">{product.label} · UX flows</span>
          <Badge variant="outline" className="font-normal text-muted-foreground" title={`Built ${data.meta.builtAt}${data.meta.source ? ` from ${data.meta.source}` : ''} against ${data.meta.base}`}>
            {data.meta.captured}/{data.meta.total} captured · {data.meta.capture?.width}×{data.meta.capture?.height}{source ? ` · ${source}` : ''}
          </Badge>
          <Tabs value={ui.view} onValueChange={(v) => setView(v as View)}>
            <TabsList>{VIEWS.map(([v, label]) => <TabsTrigger key={v} value={v}>{label}</TabsTrigger>)}</TabsList>
          </Tabs>
          <span className="flex-1" />
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={dark ? 'Light mode' : 'Dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>{dark ? <Sun /> : <Moon />}</Button>
          <Button variant="ghost" size="sm" nativeButton={false} render={<a href={openUrl} target="_blank" rel="noreferrer" />} title={openNode ? `Open Terrain Viewer in this state: ${openNode.label}` : 'Open Terrain Viewer'}>
            {openNode ? <>Open this state in Terrain Viewer</> : <>Open Terrain Viewer</>} <ExternalLink />
          </Button>
        </header>

        {ui.view === 'map' ? (
          <SidebarProvider className="min-h-0 flex-1" style={{ '--sidebar-width': '18rem' } as React.CSSProperties}>
            <Sitemap data={data} selected={ui.node} path={path} onSelect={selectNode} />
            <SidebarInset className="min-h-0 min-w-0">
              {!inspectorOpen && (
                <Button variant="outline" size="icon-sm" className="absolute right-3 top-3 z-10 hidden shadow-sm lg:inline-flex" onClick={toggleInspector} aria-label="Show the inspector" title="Show the inspector">
                  <PanelRightOpen />
                </Button>
              )}
              <Stage data={data} nodeId={ui.node} step={!onStep || currentStep?.node ? null : currentStep} flow={flow} onSelect={selectNode} />
              {flow ? (
                <Player data={data} flow={flow} flows={data.flows} path={path} step={ui.step ?? 1} onStep={onStep} nodeId={ui.node}
                  onGoTo={goToStep} onChoose={chooseBranch} onSetFlow={(id) => setFlow(id, true)} onClose={() => setFlow(null)} />
              ) : (
                <div className="border-t px-4 py-2 text-sm text-muted-foreground">
                  No flow playing. <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setFlow(data.flows[0].id, true)}>Play {data.flows[0].id}</Button> or pick one in the Flows view.
                </div>
              )}
            </SidebarInset>
            {inspectorOpen && <Inspector data={data} nodeId={ui.node} flow={flow} currentStep={currentStep} onSetFlow={(id) => setFlow(id, true)} onSelect={selectNode} onClose={toggleInspector} />}
          </SidebarProvider>
        ) : ui.view === 'canvas' ? (
          <Canvas data={data} selected={ui.node} onOpen={selectNode} />
        ) : (
          <FlowsView data={data} flow={flow ?? data.flows[0]} path={flow ? path : flowPath(data.flows[0], {})} selectedNode={ui.node}
            onPick={(id) => setFlow(id)} onPlay={(id) => setFlow(id, true)} onOpenNode={(id, n) => { setUi((s) => ({ ...s!, view: 'map', node: id, step: n ?? s!.step })); }} />
        )}
      </div>
    </TooltipProvider>
  );
}

function firstScreen(d: Data): string {
  const root = d.nodes[d.products[0].root];
  const walk = (id: string): string | null => {
    const n = d.nodes[id];
    if (n.screens?.length) return id;
    for (const c of n.children) { const hit = walk(c); if (hit) return hit; }
    return null;
  };
  return walk(root.id) ?? root.id;
}
