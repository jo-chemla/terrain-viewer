'use client';

import { type MouseEvent, type ReactNode, useCallback, useEffect, useState } from 'react';

interface LightboxItem {
  src: string;
  alt: string;
  type: 'image' | 'video';
  /** Plain text shown before the link (or the whole title, if there's no
   *  link) — for prose images this is the caption's own text with the link
   *  portion stripped off the end, so the lightbox title reads identically
   *  to the caption underneath the thumbnail. For the viz-mode grid (whose
   *  own link precedes the image, not a following caption) this is empty
   *  and the mode label becomes the whole linkText instead. */
  titleText?: string;
  /** The clickable portion's own text (e.g. "open in app ↗", or "Slope ↗"
   *  for a grid cell) — rendered as an `<a>` only when linkHref is set. */
  linkText?: string;
  linkHref?: string;
}

interface LightboxState {
  items: LightboxItem[];
  index: number;
}

/** Prose images render as `<p><img/></p>` (remark's standalone-image
 *  wrapping); the caption `<p className="...italic">...<a href>...</a></p>`
 *  is its next sibling. Only an anchor whose own text says "open in app" is
 *  treated as the reproduction link — a caption can contain OTHER links too
 *  (e.g. "see Split & Compare Modes"), and those must never be picked up
 *  here (they'd point at an unresolved-in-lightbox internal doc path, not
 *  a live-app URL). The viz-mode grid doesn't use this shape at all (its
 *  own link precedes the image) — it sets data-lightbox-title/-href
 *  directly instead, so this is only ever consulted as a fallback. */
function readCaption(img: HTMLImageElement): { text: string; linkText?: string; href?: string } {
  const sibling = img.parentElement?.nextElementSibling;
  if (sibling?.tagName !== 'P') return { text: img.alt };
  const fullText = sibling.textContent?.trim() ?? '';
  const linkEl = Array.from(sibling.querySelectorAll('a[href]')).find((a) =>
    /open in app/i.test(a.textContent ?? ''),
  );
  if (!linkEl) return { text: fullText || img.alt };
  const linkText = linkEl.textContent ?? '';
  const href = linkEl.getAttribute('href') ?? undefined;
  const text = fullText.endsWith(linkText) ? fullText.slice(0, fullText.length - linkText.length) : fullText;
  return { text, linkText, href };
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
        titleText: '',
        linkText: dataHref ? `${dataTitle} ↗` : dataTitle,
        linkHref: dataHref,
      };
    }
    const caption = readCaption(el);
    return {
      src: el.currentSrc || el.src,
      alt: el.alt,
      type: 'image',
      titleText: caption.text,
      linkText: caption.linkText,
      linkHref: caption.href,
    };
  }
  if (el instanceof HTMLVideoElement) {
    const dataTitle = el.getAttribute('data-lightbox-title') || undefined;
    return { src: el.currentSrc || el.src, alt: '', type: 'video', titleText: dataTitle };
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
  const stop = (e: MouseEvent) => e.stopPropagation();

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

          <div className="flex h-14 shrink-0 items-center justify-center px-16 pt-2" onClick={stop}>
            {(current.titleText || current.linkText) && (
              <div className="max-w-full truncate text-center text-sm text-white/90">
                {current.titleText}
                {current.linkHref && (
                  <a
                    href={current.linkHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white hover:underline"
                  >
                    {current.linkText}
                  </a>
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
