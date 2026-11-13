// A button from a docs page into the app itself, for MDX:
//
//   <OpenInApp href="/?appMode=historical&lat=25.2&lng=55.27&zoom=10">Open the Timelapse map</OpenInApp>
//
// `href` is root-relative, so it lands on whichever host serves these docs
// (terrain-viewer.iconem.com or historical-satellite.iconem.com): the app is
// at "/", the docs under "/docs". A plain anchor, not next/link, which would
// prepend the docs basePath. A link that carries a query string is marked
// nofollow: every such address is the same single-page app, and search
// engines otherwise list "/?sidebarCollapsed=true" and its cousins as pages
// of their own (Bing did, 2026-11).
import { ArrowUpRight, History, Mountain, Sun } from 'lucide-react';
import type { ReactNode } from 'react';

const ICONS = { terrain: Mountain, historical: History, sun: Sun } as const;

export function OpenInApp({ href = '/', mode, children }: { href?: string; mode?: keyof typeof ICONS; children?: ReactNode }) {
  const Icon = ICONS[mode ?? (href.includes('appMode=historical') ? 'historical' : 'terrain')];
  return (
    <p className="not-prose my-5">
      <a
        href={href}
        target="_blank"
        rel={href.includes('?') ? 'noopener nofollow' : 'noopener'}
        className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-4 py-2.5 text-sm font-semibold text-fd-primary-foreground no-underline shadow-sm transition-opacity hover:opacity-90"
      >
        <Icon className="size-4" />
        <span>{children ?? 'Open Terrain Viewer'}</span>
        <ArrowUpRight className="size-4 opacity-70" />
      </a>
    </p>
  );
}
