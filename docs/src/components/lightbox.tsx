'use client';

import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useState } from 'react';

/** One run of the title bar — plain text, or a clickable link (its own
 *  visible text plus an href). A caption can contain more than one link
 *  (e.g. "see the Walkthrough (docs) or take it yourself in-app ↗") — the
 *  title bar renders every segment in order rather than picking just one. */
interface TitleNode {
  text: string;
  href?: string;
}

interface LightboxItem {
  src: string;
  alt: string;
  type: 'image' | 'video';
  titleNodes: TitleNode[];
}

interface LightboxState {
  items: LightboxItem[];
  index: number;
}

// Internal doc links are written relative to the docs root ("/features/...")
// but this app is mounted under the "/docs" basePath — a plain <a> (not
// Next's <Link>) opened directly at that path 404s. External "open in app"
// links (full https://terrain-viewer.iconem.com/... URLs) are untouched.
function resolveHref(raw: string): string {
  return raw.startsWith('/') && !raw.startsWith('/docs') ? `/docs${raw}` : raw;
}

/** Prose images render as `<p><img/></p>` (remark's standalone-image
 *  wrapping); the caption `<p className="...italic">...</p>` is its next
 *  sibling. Walks the caption's own child nodes in order, turning each
 *  anchor into a linked TitleNode and everything else into plain text — so
 *  the lightbox title reads identically to the caption underneath the
 *  thumbnail, links and all, regardless of how many links it contains. The
 *  viz-mode grid doesn't use this shape at all (its own link precedes the
 *  image) — it sets data-lightbox-title/-href directly instead, so this is
 *  only ever consulted as a fallback. */
function readCaptionNodes(img: HTMLImageElement): TitleNode[] {
  const sibling = img.parentElement?.nextElementSibling;
  if (sibling?.tagName !== 'P') return img.alt ? [{ text: img.alt }] : [];
  const nodes: TitleNode[] = [];
  for (const node of Array.from(sibling.childNodes)) {
    if (node instanceof HTMLAnchorElement) {
      const rawHref = node.getAttribute('href');
      nodes.push({ text: node.textContent ?? '', href: rawHref ? resolveHref(rawHref) : undefined });
    } else {
      const text = node.textContent ?? '';
      if (text) nodes.push({ text });
    }
  }
  if (nodes.length) return nodes;
  const fallback = sibling.textContent?.trim() || img.alt;
  return fallback ? [{ text: fallback }] : [];
}

function readItem(el: Element): LightboxItem | null {
  if (el instanceof HTMLImageElement) {
    const dataTitle = el.getAttribute('data-lightbox-title');
    const dataHref = el.getAttribute('data-lightbox-href') || undefined;
    if (dataTitle) {
      return {
        src: el.currentSrc || el.src,
        alt: el.alt,
        type: 'image',
        titleNodes: [{ text: dataHref ? `${dataTitle} ↗` : dataTitle, href: dataHref }],
      };
    }
    return { src: el.currentSrc || el.src, alt: el.alt, type: 'image', titleNodes: readCaptionNodes(el) };
  }
  if (el instanceof HTMLVideoElement) {
    const dataTitle = el.getAttribute('data-lightbox-title') || undefined;
    return { src: el.currentSrc || el.src, alt: '', type: 'video', titleNodes: dataTitle ? [{ text: dataTitle }] : [] };
  }
  return null;
}

/** Wrap any section of the page containing `data-lightbox`-marked <img>/<video>
 *  elements to make them open in a shared lightbox on click, with looping
 *  left/right arrow-key navigation across every such element on the page.
 *
 *  Listens on `document` rather than scoping a click handler to a wrapped
 *  container element: DocsBody's `prose` styling trims margins via
 *  `.prose > :first-child`/`:last-child` (a direct-child selector), so
 *  inserting our own wrapper <div> around the MDX body would demote its real
 *  first/last elements to grandchildren and reintroduce that trimmed
 *  margin — rendering `{children}` through a Fragment (no extra DOM node)
 *  avoids that entirely. Only one lightbox-enabled section is ever mounted
 *  per route (home page vs docs page), so page-wide scope is equivalent to
 *  scoping to that section anyway. */
export function LightboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LightboxState | null>(null);

  const close = useCallback(() => setState(null), []);
  const step = useCallback((delta: number) => {
    setState((s) =>
      s ? { ...s, index: (s.index + delta + s.items.length) % s.items.length } : s,
    );
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest?.('[data-lightbox]');
      if (!target) return;
      const els = Array.from(document.querySelectorAll('[data-lightbox]'));
      const items = els.map(readItem).filter((x): x is LightboxItem => x !== null);
      const index = els.indexOf(target);
      if (index === -1 || !items[index]) return;
      setState({ items, index });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, close, step]);

  const current = state?.items[state.index];
  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  return (
    <>
      {children}

      {current && (
        // Column layout — title row / image row / counter row each get their
        // own reserved height, so none of them ever render on top of each
        // other (the previous all-absolutely-positioned layout let a wide
        // image extend behind the arrows, title, and page counter).
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex flex-col bg-black/80"
          onClick={close}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            ✕
          </button>

          <div className="flex min-h-14 shrink-0 items-center justify-center px-16 py-2" onClick={stop}>
            {current.titleNodes.length > 0 && (
              <div className="max-w-full text-center text-sm text-white/90">
                {current.titleNodes.map((node, i) =>
                  node.href ? (
                    <a
                      key={i}
                      href={node.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/90 hover:text-white hover:underline"
                    >
                      {node.text}
                    </a>
                  ) : (
                    <span key={i}>{node.text}</span>
                  ),
                )}
              </div>
            )}
          </div>

          <div className="relative min-h-0 flex-1 px-16">
            {state.items.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous"
                  onClick={(e) => {
                    e.stopPropagation();
                    step(-1);
                  }}
                  className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-xl text-white hover:bg-white/20"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next"
                  onClick={(e) => {
                    e.stopPropagation();
                    step(1);
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-xl text-white hover:bg-white/20"
                >
                  ›
                </button>
              </>
            )}

            <div className="flex h-full w-full items-center justify-center">
              {current.type === 'video' ? (
                <video
                  key={current.src}
                  src={current.src}
                  autoPlay
                  loop
                  muted
                  playsInline
                  controls
                  onClick={stop}
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={current.src}
                  src={current.src}
                  alt={current.alt}
                  onClick={stop}
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              )}
            </div>
          </div>

          <div className="flex h-10 shrink-0 items-center justify-center text-sm text-white/70">
            {state.items.length > 1 && `${state.index + 1} / ${state.items.length}`}
          </div>
        </div>
      )}
    </>
  );
}
