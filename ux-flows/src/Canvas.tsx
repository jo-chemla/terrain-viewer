import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Data, Link } from './model';

// Canvas view: the product as one board, read left to right. Each top-level group is a frame; its screens are boxes
// in sitemap order (sub-groups become headings), and arrows are the links the flows draw between screens.
// Hovering a box lights the routes that reach it (blue) and the ones that leave it (amber) and previews its screenshot.

const L = { boxW: 236, boxH: 56, rowGap: 12, indent: 18, padX: 20, padTop: 54, padBottom: 20, frameGap: 120, subHead: 30 };

interface Box { id: string; x: number; y: number; depth: number }
interface Head { id: string; x: number; y: number; depth: number }
interface Frame { id: string; x: number; y: number; w: number; h: number; boxes: Box[]; heads: Head[] }

function layout(data: Data): { frames: Frame[]; w: number; h: number; boxAt: Record<string, Box> } {
  const root = data.nodes[data.products[0].root];
  const frames: Frame[] = [];
  let x = 0;
  for (const fid of root.children) {
    const g = data.nodes[fid];
    const boxes: Box[] = []; const heads: Head[] = [];
    let y = L.padTop; let maxDepth = 0;
    const walk = (id: string, depth: number) => {
      const n = data.nodes[id];
      maxDepth = Math.max(maxDepth, depth);
      if (n.kind === 'group') {
        heads.push({ id, x: L.padX + depth * L.indent, y, depth }); y += L.subHead;
        for (const c of n.children) walk(c, depth + 1);
      } else {
        boxes.push({ id, x: L.padX + depth * L.indent, y, depth }); y += L.boxH + L.rowGap;
      }
    };
    if (g.kind === 'group') for (const c of g.children) walk(c, 0); else walk(fid, 0);
    const w = L.padX * 2 + L.boxW + maxDepth * L.indent;
    frames.push({ id: fid, x, y: 0, w, h: y - L.rowGap + L.padBottom, boxes, heads });
    x += w + L.frameGap;
  }
  const boxAt: Record<string, Box> = {};
  for (const f of frames) for (const b of f.boxes) boxAt[b.id] = { ...b, x: b.x + f.x, y: b.y + f.y };
  return { frames, w: x - L.frameGap, h: Math.max(...frames.map((f) => f.h)), boxAt };
}

/** A cubic path between two boxes: out of the right side and into the left; a loop out to the right when the target is not to the right. */
function edgePath(a: Box, b: Box): string {
  const sx = a.x + L.boxW, sy = a.y + L.boxH / 2;
  if (b.x > a.x + 40) {
    const tx = b.x, ty = b.y + L.boxH / 2, dx = Math.max(50, (tx - sx) / 2);
    return `M${sx},${sy} C${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`;
  }
  const tx = b.x + L.boxW, ty = b.y + L.boxH / 2, out = 46 + Math.abs(ty - sy) * 0.15;
  return `M${sx},${sy} C${sx + out},${sy} ${tx + out},${ty} ${tx},${ty}`;
}

export function Canvas({ data, selected, onOpen }: { data: Data; selected: string | null; onOpen: (id: string) => void }) {
  const { frames, w, h, boxAt } = useMemo(() => layout(data), [data]);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [view, setView] = useState({ x: 40, y: 30, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const focus = pinned ?? hover;
  const links = data.links.filter((l) => boxAt[l.from] && boxAt[l.to]);
  const incoming = new Set(links.filter((l) => l.to === focus).map((l) => l.from));
  const outgoing = new Set(links.filter((l) => l.from === focus).map((l) => l.to));
  const linkState = (l: Link) => (!focus ? '' : l.to === focus ? 'in' : l.from === focus ? 'out' : 'dim');
  const boxState = (id: string) => (!focus ? '' : id === focus ? 'focus' : incoming.has(id) ? 'in' : outgoing.has(id) ? 'out' : 'dim');

  const onWheel = (e: React.WheelEvent) => {
    const k = Math.min(2.5, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    setView({ k, x: px - (px - view.x) * (k / view.k), y: py - (py - view.y) * (k / view.k) });
  };
  const fit = (el: HTMLElement | null) => {
    if (!el) return;
    const k = Math.min(1, (el.clientWidth - 80) / w, (el.clientHeight - 80) / h);
    setView({ k, x: (el.clientWidth - w * k) / 2, y: (el.clientHeight - h * k) / 2 });
  };
  // Fit the whole board on first show, once the host has a size.
  useEffect(() => { fit(hostRef.current); }, [w, h]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = focus ? data.nodes[focus] : null;
  const cardBox = focus ? boxAt[focus] : null;
  // The card always sits to the left of its box, where the arrows are not; the board is pannable, so it may hang off its edge.
  const cardLeft = cardBox ? cardBox.x - 316 : 0;

  const KeyLine = ({ cls, label }: { cls: string; label: string }) => <span className="inline-flex items-center gap-1.5"><i className={cn('inline-block w-5', cls)} />{label}</span>;

  return (
    <main className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-sidebar px-3 py-1.5 text-xs text-muted-foreground">
        <b className="text-foreground">Board: {data.products[0].label}</b>
        <span>Drag to move, wheel to zoom. Hover a box to see the routes that reach it; click to pin, click again to open it in the map.</span>
        <span className="flex-1" />
        <KeyLine cls="border-t-[3px] border-blue-500" label="Reached from" />
        <KeyLine cls="border-t-[3px] border-amber-500" label="Leads to" />
        <KeyLine cls="border-t-[3px] border-muted-foreground" label="Main route" />
        <KeyLine cls="border-t-2 border-dashed border-muted-foreground" label="Optional or way back" />
        <span className="inline-flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => setView((v) => ({ ...v, k: v.k * 0.9 }))} aria-label="Zoom out"><Minus /></Button>
          <span className="w-10 text-center">{Math.round(view.k * 100)}%</span>
          <Button variant="outline" size="icon-sm" onClick={() => setView((v) => ({ ...v, k: v.k * 1.1 }))} aria-label="Zoom in"><Plus /></Button>
          <Button variant="outline" size="sm" onClick={() => fit(hostRef.current)}>Fit</Button>
        </span>
      </div>
      <div className="board-host relative min-h-0 cursor-grab overflow-hidden active:cursor-grabbing" ref={hostRef} onWheel={onWheel}
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.cbox, .ccard')) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setView((v) => ({ ...v, x: drag.current!.vx + e.clientX - drag.current!.x, y: drag.current!.vy + e.clientY - drag.current!.y })); }}
        onPointerUp={() => { drag.current = null; }}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('.cbox, .ccard')) setPinned(null); }}>
        <div className="absolute origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: w, height: h }}>
          {frames.map((f) => (
            <div key={f.id} className="absolute rounded-xl border bg-card" style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
              <div className="absolute left-5 top-3.5 text-[15px] font-semibold">{data.nodes[f.id].label} <span className="ml-1 rounded-full bg-muted px-1.5 text-[11px] font-normal text-muted-foreground">{f.boxes.length}</span></div>
              {f.heads.map((hd) => <div key={hd.id} className="absolute pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" style={{ left: hd.x, top: hd.y }}>{data.nodes[hd.id].label}</div>)}
            </div>
          ))}
          <svg className="arrows pointer-events-none absolute left-0 top-0" width={w} height={h} style={{ overflow: 'visible' }}>
            <defs>
              {['', 'in', 'out', 'dim'].map((s) => (
                <marker key={s || 'base'} id={`arr-${s || 'base'}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className={`arrhead ${s}`} />
                </marker>
              ))}
            </defs>
            {links.map((l) => {
              const st = linkState(l);
              return <path key={`${l.from}>${l.to}`} d={edgePath(boxAt[l.from], boxAt[l.to])} className={`arrow w-${l.weight} ${st}`} markerEnd={`url(#arr-${st || 'base'})`} />;
            })}
            {focus && links.filter((l) => l.from === focus || l.to === focus).map((l) => {
              const a = boxAt[l.from], b = boxAt[l.to];
              const mx = (a.x + L.boxW + b.x) / 2, my = (a.y + b.y) / 2 + L.boxH / 2 - 6;
              return l.label ? <text key={`t${l.from}>${l.to}`} x={mx} y={my} className={`arrow-label ${linkState(l)}`}>{l.label}</text> : null;
            })}
          </svg>
          {Object.values(boxAt).map((b) => {
            const n = data.nodes[b.id]; const shot = n.screens?.[0]; const st = boxState(b.id);
            return (
              <button key={b.id} className={cn('cbox absolute flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left transition-[opacity,box-shadow,border-color]',
                n.kind === 'state' ? 'border-l-[3px] border-l-violet-400' : 'border-l-[3px] border-l-blue-500',
                st === 'focus' && 'border-foreground', st === 'in' && 'border-blue-500 ring-2 ring-blue-500/35', st === 'out' && 'border-amber-500 ring-2 ring-amber-500/35', st === 'dim' && 'opacity-35',
                selected === b.id && 'outline outline-2 outline-offset-2 outline-primary')}
                style={{ left: b.x, top: b.y, width: L.boxW, height: L.boxH }}
                onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(b.id)} onBlur={() => setHover(null)}
                onClick={() => (pinned === b.id ? onOpen(b.id) : setPinned(b.id))} title={n.how}>
                {shot ? <img src={shot.src} alt="" className="h-10 w-16 shrink-0 rounded-sm object-cover" /> : <span className="h-10 w-16 shrink-0 rounded-sm bg-muted" />}
                <span className="grid min-w-0">
                  <span className="truncate text-[13px] font-semibold">{n.label}</span>
                  <span className="text-[11px] text-muted-foreground">{n.kind === 'state' ? 'State' : 'Screen'}{n.evidence !== 'Observed' ? ` · ${n.evidence}` : ''}</span>
                </span>
              </button>
            );
          })}
          {card && cardBox && (
            <div className="ccard absolute z-10 grid w-[300px] gap-1.5 rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-xl" style={{ left: cardLeft, top: Math.max(0, Math.min(h - 260, cardBox.y - 20)) }}>
              <div className="text-sm"><b>{card.label}</b><span className="ml-1 text-xs text-muted-foreground">{card.kind === 'state' ? 'STATE' : 'SCREEN'}</span></div>
              {card.screens?.[0] ? <img src={card.screens[0].src} alt="" className="aspect-[16/10] w-full rounded object-cover" /> : <div className="grid aspect-[16/10] place-items-center rounded bg-muted text-xs text-muted-foreground">No screenshot</div>}
              {card.how && <p className="text-xs text-muted-foreground">{card.how}</p>}
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-muted-foreground">Reached from</dt><dd>{[...incoming].map((id) => data.nodes[id].label).join(', ') || 'start of a flow'}</dd>
                <dt className="text-muted-foreground">Leads to</dt><dd>{[...outgoing].map((id) => data.nodes[id].label).join(', ') || 'end of a flow'}</dd>
                <dt className="text-muted-foreground">In flows</dt><dd>{card.flows.join(', ') || 'none'}</dd>
              </dl>
              <Button size="sm" onClick={() => onOpen(card.id)}>Open in the map</Button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
