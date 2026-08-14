'use client';

import { useEffect, useState } from 'react';

export interface VizModeExample {
  /** Mode name shown above the screenshot, e.g. "Slope". */
  label: string;
  /** Screenshot with that mode active AND its own controls-panel section
   *  expanded — not yet captured for any of these (placeholder paths below),
   *  see docs task "Visualization Modes docs page: add 3x3 screenshot table". */
  image: string;
  alt: string;
}

export interface VizModeGroup {
  /** Matches this page's own section headings (Terrain Analysis, Relief
   *  Visualization, Light) so the table reads as a visual index into them. */
  category: string;
  modes: VizModeExample[];
}

/** Mode-name-on-top, screenshot-below cards, grouped by category, 3 per row.
 *  Same click-to-lightbox convention as the homepage's FeatureGrid (see
 *  feature-lightbox.tsx) and the app's own changelog/settings lightbox. */
export function VizModeGrid({ groups }: { groups: VizModeGroup[] }) {
  const [lightbox, setLightbox] = useState<VizModeExample | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightbox]);

  return (
    <>
      <div className="not-prose flex flex-col gap-8">
        {groups.map((group) => (
          <div key={group.category} className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
              {group.category}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {group.modes.map((mode) => (
                <div key={mode.label} className="flex flex-col gap-2">
                  <div className="text-sm font-medium">{mode.label}</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mode.image}
                    alt={mode.alt}
                    onClick={() => setLightbox(mode)}
                    className="aspect-video w-full cursor-zoom-in rounded-lg border object-cover transition-opacity hover:opacity-90"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.image}
            alt={lightbox.alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </>
  );
}
