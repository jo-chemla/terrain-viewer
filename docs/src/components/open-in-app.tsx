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
import { ArrowRight, ArrowUpRight, Download, History, Mountain, Package, Sun, Table2, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';

// A row of buttons at the top of a page, the first one filled as OpenInApp,
// the others outlined, for MDX:
//
//   <LinkButtons links={[
//     { href: "/docs/api/tile-service/", label: "Tile service API (Scalar)", icon: "api" },
//     { href: "https://github.com/Iconem/terrain-viewer/releases/tag/desktop-latest", label: "Download", icon: "download" },
//   ]} />
//
// Plain anchors, like OpenInApp: a link inside these docs is written with
// its /docs prefix and opens in the same tab; an absolute (https) link opens
// in a new one. `quiet` outlines every button, the first included: for a row
// of references under a page's own OpenInApp button (the origin of a
// technique, a paper), which must not read as a second call to action.
const LINK_ICONS = { api: Table2, download: Download, release: Package, terminal: Terminal, app: Mountain } as const;
const BUTTON = 'inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold no-underline shadow-sm transition-opacity hover:opacity-90';

export function LinkButtons({ links, quiet = false }: { links: { href: string; label: string; icon?: keyof typeof LINK_ICONS }[]; quiet?: boolean }) {
  return (
    <p className="not-prose my-5 flex flex-wrap gap-3">
      {links.map(({ href, label, icon }, i) => {
        const Icon = icon ? LINK_ICONS[icon] : null;
        const external = /^https?:/.test(href);
        const Arrow = external ? ArrowUpRight : ArrowRight;
        return (
          <a
            key={href}
            href={href}
            {...(external ? { target: '_blank', rel: 'noopener' } : {})}
            className={`${BUTTON} ${i === 0 && !quiet ? 'bg-fd-primary text-fd-primary-foreground' : 'border bg-fd-card text-fd-foreground'}`}
          >
            {Icon ? <Icon className="size-4" /> : null}
            <span>{label}</span>
            <Arrow className="size-4 opacity-70" />
          </a>
        );
      })}
    </p>
  );
}

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
