import { Fragment, useState } from 'react';
import { ChevronRight, Maximize2, PanelRightClose } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader } from '@/components/ui/sidebar';
import type { Data, Flow, PathStep, Shot } from './model';
import { ancestors } from './model';

const TONE: Record<string, string> = {
  Observed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  Specified: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'Not captured': 'border-destructive/40 bg-destructive/10 text-destructive',
  'Partly observed': 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
};
export function EvidenceBadge({ text }: { text: string }) {
  return <Badge variant="outline" className={cn('font-medium', TONE[text])}>{text}</Badge>;
}

/** A foldable inspector section: a small uppercase label that toggles its content, open by default. */
function Section({ title, count, children, defaultOpen = true }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <SidebarGroup className="py-1">
        <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-sidebar-accent [&[data-panel-open]>svg]:rotate-90">
          <ChevronRight className="size-3.5 transition-transform" />{title}
          {count !== undefined && <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] normal-case">{count}</span>}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent className="px-2 pt-1 text-sm">{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function Stage({ data, nodeId, step, flow, onSelect }: {
  data: Data; nodeId: string | null; step: PathStep | null; flow: Flow | null; onSelect: (id: string) => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  // A flow step without a screen (a decision, or an action that is not URL state) takes the stage instead of a screen.
  if (step && !step.node) {
    const decision = step.kind === 'decision';
    return (
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mb-3 flex items-center gap-2"><h1 className="text-xl font-semibold">{step.label}</h1><Badge variant="secondary">{decision ? 'Decision' : 'No screenshot'}</Badge></div>
        <div className="grid place-items-center gap-3 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <div className="text-5xl text-amber-500">{decision ? '◇' : '✎'}</div>
          <p>{decision
            ? <>Step {step.n} of {flow?.id}: a branch point, not a screen. Choose a way on in the player below.</>
            : <>Step {step.n} of {flow?.id}: an action in the app that is not URL state, so it has no capture. The next step shows its result.</>}</p>
          <ul className="space-y-1">{step.options.map((o) => {
            const t = flow?.steps.find((s) => s.mid === o.to);
            return <li key={o.to}><Button variant="link" size="sm" className="h-auto p-0" onClick={() => { if (t?.node) onSelect(t.node); }}>{o.label || o.to}</Button> <span>→ {t?.label}</span></li>;
          })}</ul>
        </div>
      </div>
    );
  }
  const n = nodeId ? data.nodes[nodeId] : null;
  if (!n) return <div className="flex-1" />;
  const shot = n.screens?.[0];
  const crumbs = ancestors(data.nodes, n.id);
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <Breadcrumb className="mb-1">
        <BreadcrumbList className="text-xs">
          {crumbs.map((c) => <Fragment key={c}>
            <BreadcrumbItem><BreadcrumbLink render={<button onClick={() => onSelect(c)} />}>{data.nodes[c].label}</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
          </Fragment>)}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{n.label}</h1>
        {n.kind !== 'group' && n.kind !== 'product' && <Badge variant="secondary">{n.kind === 'state' ? 'State' : 'Screen'}</Badge>}
        {n.evidence && <EvidenceBadge text={n.evidence} />}
        {shot && <Button variant="outline" size="sm" onClick={() => setZoomed(true)}><Maximize2 /> Enlarge</Button>}
      </div>
      {shot ? (
        <figure className="overflow-hidden rounded-lg border bg-black" style={{ maxWidth: 'min(100%, calc((100svh - 260px) * 16 / 10))' }}>
          <img src={shot.src} alt={`Screenshot of ${n.label}`} className="block w-full" loading="lazy" />
          <figcaption className="bg-card px-2 py-1 text-xs text-muted-foreground">Desktop {shot.width}×{shot.height} · captured {new Date(shot.capturedAt).toLocaleString()} · sha {shot.sha}</figcaption>
        </figure>
      ) : n.children.length ? (
        <div>
          {n.summary && <p className="mb-3 max-w-prose text-sm text-muted-foreground">{n.summary}</p>}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {n.children.map((c) => {
              const ch = data.nodes[c]; const s = ch.screens?.[0] ?? firstShot(data, c);
              return <button key={c} className="grid gap-1.5 rounded-lg border bg-card p-1.5 text-left text-sm hover:border-primary" onClick={() => onSelect(c)}>
                {s ? <img src={s.src} alt="" className="aspect-[16/10] w-full rounded object-cover" /> : <div className="grid aspect-[16/10] place-items-center rounded bg-muted text-xs text-muted-foreground">No screenshot</div>}
                <span>{ch.label}{ch.children.length > 0 && <span className="text-muted-foreground"> · {ch.children.length}</span>}</span>
              </button>;
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <p>No screenshot{n.captureError ? `: ${n.captureError}` : ' yet. Run pnpm ux-flows:capture to observe it.'}</p>
          {n.url && <a className="underline underline-offset-2" href={n.url} target="_blank" rel="noreferrer">Open this state in Terrain Viewer ↗</a>}
        </div>
      )}
      {shot && (
        <Dialog open={zoomed} onOpenChange={setZoomed}>
          <DialogContent className="max-w-[96vw] p-2 sm:max-w-[96vw]">
            <DialogTitle className="sr-only">{n.label}, enlarged</DialogTitle>
            <img src={shot.src} alt={`Screenshot of ${n.label}`} className="max-h-[90svh] w-auto max-w-full rounded" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function firstShot(data: Data, id: string): Shot | null {
  const n = data.nodes[id];
  if (n.screens?.length) return n.screens[0];
  for (const c of n.children) { const s: Shot | null = firstShot(data, c); if (s) return s; }
  return null;
}

function Meta({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs [overflow-wrap:anywhere]">
      {rows.map(([k, v], i) => <Fragment key={i}><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0">{v}</dd></Fragment>)}
    </dl>
  );
}
const Code = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] [overflow-wrap:anywhere]">{children}</code>;

export function Inspector({ data, nodeId, flow, currentStep, onSetFlow, onSelect, onClose }: {
  data: Data; nodeId: string | null; flow: Flow | null; currentStep: PathStep | null; onSetFlow: (id: string) => void; onSelect: (id: string) => void; onClose: () => void;
}) {
  const n = nodeId ? data.nodes[nodeId] : null;
  const params = n?.params ? Object.entries(n.params).filter(([k]) => !['viewMode', 'lat', 'lng', 'place'].includes(k)) : [];
  const linkLine = (l: Data['links'][number], other: string) => (
    <li key={other}>
      <Button variant="link" size="sm" className="h-auto p-0 text-sm" onClick={() => onSelect(other)}>{data.nodes[other].label}</Button>
      <span className="text-xs text-muted-foreground"> {l.label ? `· "${l.label}"` : ''}{l.weight === 'optional' ? ' · way back' : ''} · {l.flows.join(', ')}</span>
    </li>
  );
  return (
    <Sidebar side="right" collapsible="none" className="hidden h-full min-h-0 shrink-0 border-l lg:flex" style={{ '--sidebar-width': '21rem' } as React.CSSProperties}>
      <SidebarHeader className="flex-row items-center justify-between py-1.5 pl-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inspector</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Hide the inspector" title="Hide the inspector"><PanelRightClose /></Button>
      </SidebarHeader>
      <SidebarContent>
        {n && (
          <>
            <Section title="About">
              {n.how && <p className="mb-2">{n.how}</p>}
              {n.summary && <p className="mb-2">{n.summary}</p>}
              <Meta rows={[
                ['Map ID', <Code>{n.id}</Code>],
                ...(n.screens?.[0] ? [['Screenshot', <a className="underline underline-offset-2" href={n.screens[0].src} target="_blank" rel="noreferrer"><Code>{n.screens[0].src.replace(/^.*\//, '')}</Code></a>] as [React.ReactNode, React.ReactNode]] : []),
                ...(n.url ? [['Viewer URL', <a className="underline underline-offset-2" href={n.url} target="_blank" rel="noreferrer">open this state ↗</a>] as [React.ReactNode, React.ReactNode]] : []),
              ]} />
            </Section>
            {params.length > 0 && (
              <Section title="URL state" count={params.length}>
                <Meta rows={params.map(([k, v]) => [<Code>{k}</Code>, <Code>{v}</Code>])} />
              </Section>
            )}
            {n.flows.length > 0 && (
              <Section title="In flows" count={n.flows.length}>
                <div className="space-y-1.5">{n.flows.map((id) => {
                  const f = data.flows.find((x) => x.id === id)!;
                  return <button key={id} className={cn('block w-full rounded-md border px-2.5 py-1.5 text-left text-sm hover:bg-accent', flow?.id === id && 'border-primary bg-accent')} onClick={() => onSetFlow(id)}>
                    <span className="mr-1.5 font-semibold text-primary">{id}</span>{f.title}
                    <div className="text-xs text-muted-foreground">{f.evidence}{flow?.id === id && currentStep ? ` · playing, step ${currentStep.n}` : ''}</div>
                  </button>;
                })}</div>
              </Section>
            )}
            {(n.linksTo?.length || n.linkedFrom?.length) ? (
              <Section title="Connections" count={(n.linkedFrom?.length ?? 0) + (n.linksTo?.length ?? 0)}>
                {n.linkedFrom?.length ? <p className="text-xs text-muted-foreground">Reached from</p> : null}
                <ul className="mb-2 space-y-0.5">{data.links.filter((l) => l.to === n.id).map((l) => linkLine(l, l.from))}</ul>
                {n.linksTo?.length ? <p className="text-xs text-muted-foreground">Leads to</p> : null}
                <ul className="space-y-0.5">{data.links.filter((l) => l.from === n.id).map((l) => linkLine(l, l.to))}</ul>
              </Section>
            ) : null}
          </>
        )}
        {flow && (
          <Section title={`About flow ${flow.id}`} defaultOpen={false}>
            <p className="mb-2">{flow.intro}</p>
            {flow.notes && <p className="mb-2 text-muted-foreground">{flow.notes}</p>}
            <p className="text-xs text-muted-foreground">Source: <Code>{flow.source}</Code></p>
          </Section>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
