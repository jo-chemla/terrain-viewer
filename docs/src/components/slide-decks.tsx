"use client";

// The slide decks published beside the docs (/docs/slides/, built by
// slides/scripts/publish.mjs in the deploy): a table of the decks with their
// live and PDF links, and every PDF on the page in a fold whose viewer is
// only mounted once opened (an iframe in a closed <details> still loads,
// and the five PDFs weigh about 90 MB).
//
// The links are plain anchors, not Next links: /docs/slides/ is a separate
// static site, so Next must not prefetch or route it. They are relative to
// this page (/docs/features/slide-decks/), which keeps the /docs base path out of
// them (a "/docs/..." href would get the base path a second time).
import { useState } from "react";

const SLIDES = "../../slides/";
// In development the decks are live in open-slide's editor (pnpm slides,
// port 3200, served under /docs/slides/ and proxied there by the app's dev
// server when it is up): comments, the inspector and inline edits live
// there. The "present" links already reach it through the proxy; "edit"
// opens the editor on its own port.
const EDITOR = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? "http://localhost:3200/docs/slides/" : null;

const DECKS = [
  { id: "terrain-viewer", title: "Terrain Viewer", pages: 12, about: "What it is, the sources, the visualization modes, split and compare, export" },
  { id: "historical", title: "Historical imagery", pages: 13, about: "The timeline, the providers, the catalogs (open data after a disaster, national archives, old maps), coverage" },
  { id: "tools", title: "Tools", pages: 14, about: "Elevation picker and profiles, plane slicer, drawing, georeferencer, sun shadows, iso-lines, bookmarks" },
  { id: "research", title: "Research themes", pages: 12, about: "Landscape archaeology and earth processes: what the modes show and the papers behind them" },
  { id: "under-the-hood", title: "Under the hood", pages: 13, about: "The equations, the client-side tile protocols, the registry, what runs where" },
];

const linkClass = "font-medium underline underline-offset-4 decoration-fd-primary/40 hover:decoration-fd-primary";

export function SlideDecksTable() {
  return (
    <div className="not-prose overflow-x-auto my-6">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b text-left text-fd-muted-foreground">
            <th className="py-2 pr-4 font-medium">Deck</th>
            <th className="py-2 pr-4 font-medium">What it covers</th>
            <th className="py-2 pr-4 font-medium">Live</th>
            <th className="py-2 font-medium">PDF</th>
          </tr>
        </thead>
        <tbody>
          {DECKS.map((d) => (
            <tr key={d.id} className="border-b align-top">
              <td className="py-2 pr-4 font-semibold whitespace-nowrap">{d.title}</td>
              <td className="py-2 pr-4">{d.about}</td>
              <td className="py-2 pr-4"><a className={linkClass} href={`${SLIDES}s/${d.id}/`}>present</a>{EDITOR && <> · <a className={linkClass} href={`${EDITOR}s/${d.id}/`} title="open-slide's editor on port 3200 (pnpm slides): comments, inspector, inline edits">edit</a></>}</td>
              <td className="py-2 whitespace-nowrap"><a className={linkClass} href={`${SLIDES}pdf/${d.id}.pdf`}>{d.id}.pdf</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PdfFold({ id, title, pages }: { id: string; title: string; pages: number }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className="my-3 rounded-lg border px-4 py-2" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true); }}>
      <summary className="cursor-pointer"><strong>{title}</strong> ({pages} pages) · <a className={linkClass} href={`${SLIDES}pdf/${id}.pdf`} onClick={(e) => e.stopPropagation()}>open the PDF</a></summary>
      {opened && (
        <iframe src={`${SLIDES}pdf/${id}.pdf`} title={`${title} deck`} style={{ width: "100%", aspectRatio: "16 / 9.6", border: 0, marginTop: 12 }} />
      )}
    </details>
  );
}

export function SlideDecksPdfs() {
  return <div>{DECKS.map((d) => <PdfFold key={d.id} {...d} />)}</div>;
}

export function SlidesLink({ path = "", children }: { path?: string; children: React.ReactNode }) {
  return <a className={linkClass} href={`${SLIDES}${path}`}>{children}</a>;
}
