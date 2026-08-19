export interface VizModeExample {
  /** Mode name shown above the screenshot, e.g. "Slope". */
  label: string;
  /** Screenshot with that mode active AND its own controls-panel section
   *  expanded — not yet captured for any of these (placeholder paths below),
   *  see docs task "Visualization Modes docs page: add 3x3 screenshot table". */
  image: string;
  alt: string;
  /** Live app URL reproducing this exact screenshot's view/mode state
   *  (nuqs query string) — when present, the label links out to it. */
  href?: string;
}

export interface VizModeGroup {
  /** Matches this page's own section headings (Terrain Analysis, Relief
   *  Visualization, Light) so the table reads as a visual index into them. */
  category: string;
  modes: VizModeExample[];
}

/** Mode-name-on-top, screenshot-below cards, grouped by category, 3 per row.
 *  Click-to-lightbox via the page's shared LightboxProvider (see
 *  [...slug]/page.tsx and lightbox.tsx) — looping left/right arrow-key
 *  navigation across every image on the page, including the individual
 *  per-mode screenshots further down this same MDX page. */
export function VizModeGrid({ groups }: { groups: VizModeGroup[] }) {
  return (
    <div className="not-prose flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group.category} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
            {group.category}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {group.modes.map((mode) => (
              <div key={mode.label} className="flex flex-col gap-2">
                {mode.href ? (
                  <a
                    href={mode.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-fd-primary hover:underline"
                  >
                    {mode.label} ↗
                  </a>
                ) : (
                  <div className="text-sm font-medium">{mode.label}</div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mode.image}
                  alt={mode.alt}
                  data-lightbox=""
                  data-lightbox-title={mode.label}
                  data-lightbox-href={mode.href}
                  className="aspect-video w-full cursor-zoom-in rounded-lg border object-cover transition-opacity hover:opacity-90"
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
