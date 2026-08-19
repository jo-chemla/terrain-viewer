export interface GalleryItem {
  /** Short label shown above the thumbnail, and used as the lightbox title. */
  title: string;
  image: string;
  alt: string;
  /** Live app URL reproducing this exact screenshot's state — when present,
   *  the title becomes a link (grid) / the lightbox title becomes clickable. */
  href?: string;
}

export interface GalleryGroup {
  /** Optional section heading above this group's row — omit for a single
   *  ungrouped grid. */
  category?: string;
  items: GalleryItem[];
}

/** Compact thumbnail grid, click-to-lightbox via the page's shared
 *  LightboxProvider (see lightbox.tsx) — fumadocs ships no gallery/carousel
 *  primitive of its own, so this is the reusable stand-in: a flat grid
 *  instead of a long vertical run of individual markdown images, for any
 *  page with more than a handful of screenshots (Walkthrough, blend-mode
 *  comparisons, LRM radius variants, …). */
export function Gallery({
  groups,
  cols = 4,
}: {
  groups: GalleryGroup[];
  cols?: 2 | 3 | 4;
}) {
  const colsClass = cols === 2 ? 'sm:grid-cols-2' : cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4';
  return (
    <div className="not-prose flex flex-col gap-8">
      {groups.map((group, gi) => (
        <div key={group.category ?? gi} className="flex flex-col gap-3">
          {group.category && (
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
              {group.category}
            </h3>
          )}
          <div className={`grid grid-cols-2 gap-4 ${colsClass}`}>
            {group.items.map((item) => (
              <div key={item.title} className="flex flex-col gap-2">
                {item.href ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-fd-primary hover:underline"
                  >
                    {item.title} ↗
                  </a>
                ) : (
                  <div className="text-sm font-medium">{item.title}</div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.image}
                  alt={item.alt}
                  data-lightbox=""
                  data-lightbox-title={item.title}
                  data-lightbox-href={item.href}
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
