import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInput, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem,
} from '@/components/ui/sidebar';
import type { Data, PathStep } from './model';
import { ancestors } from './model';

export function Sitemap({ data, selected, path, onSelect }: {
  data: Data; selected: string | null; path: PathStep[]; onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const stepOf = Object.fromEntries(path.filter((s) => s.node).map((s) => [s.node!, s.n]));
  const open = new Set(selected ? ancestors(data.nodes, selected) : []);
  const q = query.trim().toLowerCase();
  const matches = (id: string): boolean => {
    const n = data.nodes[id];
    return !q || n.label.toLowerCase().includes(q) || n.id.includes(q) || n.children.some(matches);
  };

  const Item = ({ id, depth }: { id: string; depth: number }) => {
    const n = data.nodes[id];
    if (!matches(id)) return null;
    const isGroup = n.children.length > 0;
    const isOpen = q ? true : !closed.has(id) && (open.has(id) || depth === 0 || n.kind === 'group');
    const holdsSelection = !isOpen && selected && ancestors(data.nodes, selected).includes(id);
    const step = stepOf[id];
    return (
      <>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={selected === id} onClick={() => onSelect(id)} title={n.how || n.summary || n.label}
            className={cn('h-auto min-h-8 py-1', isGroup && 'font-medium', n.kind === 'state' && 'text-foreground/80')} style={{ paddingLeft: 8 + depth * 14 }}>
            {isGroup ? (
              <span role="button" aria-label={isOpen ? 'Collapse' : 'Expand'} className="-ml-1 flex size-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent"
                onClick={(e) => { e.stopPropagation(); setClosed((c) => { const s = new Set(c); s.has(id) ? s.delete(id) : s.add(id); return s; }); }}>
                <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
              </span>
            ) : <span className="size-5 shrink-0" />}
            <span className="truncate">{n.label}{holdsSelection ? <span className="text-muted-foreground"> · holds selection</span> : null}</span>
          </SidebarMenuButton>
          {step ? (
            <SidebarMenuBadge className="rounded-full bg-primary px-1.5 text-primary-foreground" title={`Step ${step} of the playing flow`}>{step}</SidebarMenuBadge>
          ) : n.evidence && n.evidence !== 'Observed' ? (
            <SidebarMenuBadge title={n.evidence}><span className={cn('block size-2 rounded-full', n.evidence === 'Not captured' ? 'bg-destructive' : 'bg-muted-foreground')} /></SidebarMenuBadge>
          ) : isGroup ? (
            <SidebarMenuBadge className="text-muted-foreground">{n.children.length}</SidebarMenuBadge>
          ) : null}
        </SidebarMenuItem>
        {isGroup && isOpen && n.children.map((c) => <Item key={c} id={c} depth={depth + 1} />)}
      </>
    );
  };

  return (
    <Sidebar collapsible="none" className="hidden h-full min-h-0 shrink-0 border-r md:flex">
      <SidebarHeader>
        <SidebarInput placeholder="Search screens" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search screens" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{data.products.map((p) => <Item key={p.id} id={p.root} depth={0} />)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <div className="mt-auto space-y-1 border-t px-3 py-3 text-xs text-muted-foreground">
          <div><span className="mr-1 inline-block rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">1</span> step on the playing flow</div>
          <div><span className="mr-2 inline-block size-2 rounded-full bg-muted-foreground" />specified, not captured</div>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
