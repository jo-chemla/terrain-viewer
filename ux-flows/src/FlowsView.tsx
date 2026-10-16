import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Data, Flow, PathStep } from './model';
import { EvidenceBadge } from './Stage';

// The diagrams render on their own light "paper" whatever the page's colour scheme, like a printed chart.
mermaid.initialize({
  startOnLoad: false, securityLevel: 'loose', theme: 'base', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  flowchart: { htmlLabels: false, curve: 'basis', nodeSpacing: 36, rankSpacing: 48, useMaxWidth: false },
  themeVariables: { primaryColor: '#ffffff', primaryBorderColor: '#5b6b7f', primaryTextColor: '#1a2230', lineColor: '#5b6b7f', fontSize: '14px' },
});

/** Renders the flow's Mermaid source, then wires it: boxes open their screen, the current path gets a halo, step numbers and blue arrows. */
export function FlowsView({ data, flow, path, selectedNode, onPick, onPlay, onOpenNode }: {
  data: Data; flow: Flow; path: PathStep[]; selectedNode: string | null;
  onPick: (id: string) => void; onPlay: (id: string) => void; onOpenNode: (id: string, step?: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState('');
  const [hover, setHover] = useState<{ node: string; x: number; y: number } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const id = `m-${flow.id}-${++seq.current}`;
    mermaid.render(id, flow.mermaid).then(({ svg }) => { setSvg(svg); setErr(''); }).catch((e) => setErr(String(e)));
  }, [flow]);

  useEffect(() => {
    const root = host.current?.querySelector('svg');
    if (!root) return;
    root.style.maxWidth = '100%'; root.style.height = 'auto';
    const onPath = new Map(path.map((s) => [s.mid, s]));
    // Nodes: Mermaid ids them `<renderId>-flowchart-<mid>-<n>`.
    root.querySelectorAll<SVGGElement>('g.node').forEach((g) => {
      const mid = (g.id.match(/flowchart-(.+)-\d+$/) || [])[1];
      if (!mid) return;
      const step = flow.steps.find((s) => s.mid === mid);
      const ps = onPath.get(mid);
      g.classList.toggle('on-path', !!ps);
      g.classList.toggle('selected', !!step?.node && step.node === selectedNode);
      g.classList.toggle('decision', step?.kind === 'decision');
      g.classList.toggle('no-shot', !!step?.node && !data.nodes[step.node]?.screens?.length);
      g.style.cursor = step?.node ? 'pointer' : 'default';
      g.setAttribute('role', 'button'); g.setAttribute('tabindex', '0');
      const open = () => { if (step?.node) onOpenNode(step.node, ps?.n); else if (ps) onOpenNode(selectedNode ?? '', ps.n); };
      g.onclick = open;
      g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
      // Hover preview: the screen's thumbnail beside the box, inside the diagram's own box.
      g.onmouseenter = g.onfocus = () => {
        if (!step?.node || !host.current) return;
        const hr = host.current.getBoundingClientRect(), br = g.getBoundingClientRect();
        const flip = br.right + 290 > hr.right;
        setHover({ node: step.node, x: (flip ? br.left - 290 : br.right + 12) - hr.left + host.current.scrollLeft, y: br.top - hr.top + host.current.scrollTop - 8 });
      };
      g.onmouseleave = g.onblur = () => setHover(null);
      g.querySelector('.step-tag')?.remove();
      if (ps) {
        const shape = g.querySelector<SVGGraphicsElement>('rect, polygon, path');
        const b = shape?.getBBox();
        if (b) {
          const tag = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          tag.setAttribute('class', 'step-tag');
          const isDiamond = step?.kind === 'decision';
          const cx = isDiamond ? b.x + b.width * 0.25 : b.x, cy = isDiamond ? b.y + b.height * 0.25 : b.y;
          // Inline styles: Mermaid's own stylesheet is scoped to the svg id and would outrank a class rule.
          tag.innerHTML = `<circle cx="${cx}" cy="${cy}" r="10" style="fill:#3b82f6 !important;stroke:#fff !important;stroke-width:2px"/>`
            + `<text x="${cx}" y="${cy + 4}" text-anchor="middle" style="fill:#fff !important;font-size:11px;font-weight:700">${ps.n}</text>`;
          g.appendChild(tag);
        }
      }
    });
    // Edges: `<renderId>-L_<from>_<to>_<n>`. The chosen arrow out of each path step is lit.
    const chosen = path.filter((s) => s.chosen).map((s) => [s.mid, s.chosen!.to]);
    root.querySelectorAll<SVGPathElement>('path.flowchart-link, .edgePath path').forEach((p) => {
      const lit = chosen.some(([f, t]) => p.id.includes(`L_${f}_${t}_`) || p.id.includes(`L-${f}-${t}-`));
      p.classList.toggle('on-path', lit);
    });
  }, [svg, path, selectedNode, flow, data, onOpenNode]);

  const Key = ({ cls, label }: { cls: string; label: string }) => <span className="inline-flex items-center gap-1.5"><i className={cn('inline-block', cls)} />{label}</span>;

  return (
    <main className="grid min-h-0 flex-1 overflow-auto md:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
      <aside className="border-b p-5 md:border-b-0 md:border-r">
        <h1 className="mb-1 text-lg font-semibold">User flows</h1>
        <p className="mb-3 text-sm text-muted-foreground">Each flow follows one reviewer task. Select a box in the diagram to open its screen in the map.</p>
        <div className="space-y-1.5">{data.flows.map((f) => (
          <button key={f.id} className={cn('block w-full rounded-md border bg-card px-2.5 py-1.5 text-left text-sm hover:bg-accent', f.id === flow.id && 'border-primary bg-accent')} onClick={() => onPick(f.id)}>
            <span className="mr-1.5 font-semibold text-primary">{f.id}</span>{f.title}
            <div className="text-xs text-muted-foreground">{f.evidence} · {f.steps.filter((s) => s.node).length} screens</div>
          </button>
        ))}</div>
      </aside>
      <section className="max-w-[1100px] p-5 md:px-8">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{flow.id} · {flow.title}</h1>
          <EvidenceBadge text={flow.evidence} />
          <span className="flex-1" />
          <Button size="sm" onClick={() => onPlay(flow.id)}><Play /> Play in the map</Button>
        </div>
        <p className="mb-3 max-w-prose text-sm text-muted-foreground">{flow.intro}</p>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
          <Key cls="h-3 w-5 border-2 border-neutral-500 bg-white" label="Screen" />
          <Key cls="h-3 w-3 rotate-45 border-2 border-amber-400 bg-amber-50" label="Decision" />
          <Key cls="w-5 border-t-[3px] border-neutral-500" label="Main route" />
          <Key cls="w-5 border-t-[1.5px] border-neutral-500" label="Alternative" />
          <Key cls="w-5 border-t-[1.5px] border-dashed border-neutral-500" label="Optional or way back" />
          <Key cls="w-5 border-t-[3px] border-blue-500" label="Selected path" />
          <span className="inline-flex items-center gap-1.5"><span className="inline-grid size-4 place-items-center rounded-full bg-blue-500 text-[10px] font-bold text-white">1</span>Step number</span>
        </div>
        {err && <pre className="whitespace-pre-wrap text-xs text-destructive">{err}</pre>}
        <div className="relative">
          <div className="diagram overflow-auto rounded-lg border bg-white p-4 text-neutral-900" ref={host} dangerouslySetInnerHTML={{ __html: svg }} />
          {hover && (() => {
            const n = data.nodes[hover.node]; const shot = n.screens?.[0];
            return (
              <div className="pointer-events-none absolute z-10 grid w-[276px] gap-1 rounded-lg border bg-popover p-1.5 text-xs text-popover-foreground shadow-lg" style={{ left: hover.x, top: hover.y }}>
                {shot ? <img src={shot.src} alt="" className="aspect-[16/10] w-full rounded object-cover" /> : <div className="grid aspect-[16/10] place-items-center rounded bg-muted text-muted-foreground">No screenshot yet</div>}
                <b>{n.label}</b>
                {n.how && <span className="text-muted-foreground">{n.how}</span>}
              </div>
            );
          })()}
        </div>
        <h2 className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Path</h2>
        <ol className="list-decimal space-y-0.5 pl-6 text-sm">
          {path.map((s) => (
            <li key={s.mid}>
              <Button variant="link" size="sm" className="h-auto p-0 text-sm" onClick={() => s.node ? onOpenNode(s.node, s.n) : onOpenNode(selectedNode ?? '', s.n)}>{s.label}</Button>
              {s.options.length > 1 && <span className="text-muted-foreground"> · branch: {s.options.map((o) => o.label || o.to).join(' / ')} → <b>{s.chosen?.label || s.chosen?.to || 'stop'}</b></span>}
              {s.chosen?.weight === 'optional' && <span className="text-muted-foreground"> (way back)</span>}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">Source: <code className="rounded bg-muted px-1">{flow.source}</code>. Edit the Mermaid there and run <code className="rounded bg-muted px-1">pnpm ux-flows:data</code>.</p>
      </section>
    </main>
  );
}
