'use client';

import { type ReactNode, useCallback, useEffect, useState } from 'react';

interface LightboxItem {
  src: string;
  alt: string;
  type: 'image' | 'video';
}

interface LightboxState {
  items: LightboxItem[];
  index: number;
}

function readItem(el: Element): LightboxItem | null {
  if (el instanceof HTMLImageElement) {
    return { src: el.currentSrc || el.src, alt: el.alt, type: 'image' };
  }
  if (el instanceof HTMLVideoElement) {
    return { src: el.currentSrc || el.src, alt: '', type: 'video' };
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

  return (
    <>
      {children}

      {current && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={close}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            ✕
          </button>

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
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/70">
                {state.index + 1} / {state.items.length}
              </div>
            </>
          )}

          {current.type === 'video' ? (
            <video
              key={current.src}
              src={current.src}
              autoPlay
              loop
              muted
              playsInline
              controls
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={current.src}
              src={current.src}
              alt={current.alt}
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          )}
        </div>
      )}
    </>
  );
}
