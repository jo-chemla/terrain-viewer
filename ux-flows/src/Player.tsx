import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Data, Flow, PathStep } from './model';

export function Player({ data, flow, flows, path, step, onStep, nodeId, onGoTo, onChoose, onSetFlow, onClose }: {
  data: Data; flow: Flow; flows: Flow[]; path: PathStep[]; step: number; onStep: boolean; nodeId: string | null;
  onGoTo: (n: number) => void; onChoose: (atMid: string, toMid: string) => void; onSetFlow: (id: string) => void; onClose: () => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const current = path[step - 1];
  // Keep the current thumbnail in view by scrolling the strip only, never the page.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[data-current]');
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [step, flow.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea, [role=combobox], [role=listbox]')) return;
      if (e.key === 'ArrowRight' || e.key === ']') { if (step < path.length) onGoTo(step + 1); }
      if (e.key === 'ArrowLeft' || e.key === '[') { if (step > 1) onGoTo(step - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, path.length, onGoTo]);

  const branchAt = current && current.options.length > 1 ? current : null;
  const selectedLabel = nodeId ? data.nodes[nodeId]?.label : '';

  return (
    <div className="shrink-0 border-t bg-sidebar px-3 pb-2.5 pt-2">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous step" disabled={step <= 1} onClick={() => onGoTo(step - 1)}><ChevronLeft /></Button>
          <Button variant="outline" size="icon-sm" aria-label="Next step" disabled={step >= path.length} onClick={() => onGoTo(step + 1)}><ChevronRight /></Button>
        </div>
        <Select value={flow.id} onValueChange={(v) => v && onSetFlow(String(v))}>
          <SelectTrigger size="sm" className="max-w-[60vw] font-medium" aria-label="Flow"><SelectValue>{flow.id} · {flow.title}</SelectValue></SelectTrigger>
          <SelectContent>{flows.map((f) => <SelectItem key={f.id} value={f.id}>{f.id} · {f.title}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          Step {step} of {path.length}
          {!onStep && selectedLabel && <> · <b className="text-foreground">{selectedLabel}</b> is not on this path · <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onGoTo(step)}>Back to the step</Button></>}
        </span>
        {branchAt && (
          <ToggleGroup variant="outline" size="sm" value={branchAt.chosen ? [branchAt.chosen.to] : []} onValueChange={(v) => { const to = v[0]; if (to) onChoose(branchAt.mid, String(to)); }} aria-label="Way on from this step">
            {branchAt.options.map((o) => {
              const target = flow.steps.find((s) => s.mid === o.to);
              return <ToggleGroupItem key={o.to} value={o.to} className={cn('text-xs', o.weight === 'optional' && 'border-dashed')}
                title={`${o.weight === 'main' ? 'Main route' : o.weight === 'alt' ? 'Alternative' : 'Optional or way back'} → ${target?.label}`}>
                {o.label || target?.label}
              </ToggleGroupItem>;
            })}
          </ToggleGroup>
        )}
        <span className="flex-1" />
        <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex"><Kbd>←</Kbd><Kbd>→</Kbd> or <Kbd>[</Kbd><Kbd>]</Kbd> to step</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close player"><X /></Button>
      </div>
      <div className="flex snap-x items-start overflow-x-auto pb-1" ref={strip}>
        {path.map((s, i) => {
          const n = s.node ? data.nodes[s.node] : null;
          const shot = n?.screens?.[0];
          const branched = i > 0 && path[i - 1].options.length > 1;
          const isCurrent = s.n === step;
          return (
            <span key={s.mid} className="inline-flex shrink-0 items-center">
              {i > 0 && <span className={cn('-mt-7 px-1 text-base text-muted-foreground', branched && 'font-bold text-amber-500')} title={branched ? `Branch chosen: ${path[i - 1].chosen?.label}` : path[i - 1].chosen?.label}>{branched ? '⑂' : '›'}</span>}
              <button data-current={isCurrent || undefined} className={cn('grid w-[120px] snap-center gap-1 rounded-md border-2 border-transparent p-0.5 text-left', isCurrent && 'border-primary bg-accent')} onClick={() => onGoTo(s.n)} aria-current={isCurrent ? 'step' : undefined}>
                {shot ? <img src={shot.src} alt="" className="aspect-[16/10] w-full rounded-sm object-cover" />
                  : <span className={cn('grid aspect-[16/10] place-items-center rounded-sm bg-muted text-center text-[11px] text-muted-foreground', s.kind === 'decision' && 'border border-dashed border-amber-500 text-amber-600 dark:text-amber-300')}>{s.kind === 'decision' ? '◇ Decision' : n ? 'No screenshot' : s.label}</span>}
                <span className={cn('truncate text-[11px] text-muted-foreground', isCurrent && 'text-foreground')}><b className="text-primary">{s.n}</b> {s.label}</span>
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
