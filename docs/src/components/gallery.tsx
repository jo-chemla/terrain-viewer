'use client';

import type { MouseEvent } from 'react';

export interface GalleryItem {
  /** Short label — used as the lightbox title (and as the filmstrip
   *  thumbnail's tooltip), not rendered as visible on-page text (that's
   *  what made the old grid layout's row heights fight each other: some
   *  labels wrapped to two lines, some didn't, so cards in the same row
   *  stopped lining up). */
  title: string;
  image: string;
  alt: string;
  /** Live app URL reproducing this exact screenshot's state — becomes the
   *  lightbox title's link when present. */
  href?: string;
}

export interface GalleryGroup {
  /** Optional section heading above this group's hero+filmstrip — omit for
   *  a single ungrouped gallery. */
  category?: string;
  items: GalleryItem[];
}

/** Large first-image "hero" + a filmstrip of every image in the group below
 *  it, click-to-lightbox (looping left/right through the whole group) via
 *  the shared LightboxProvider — fumadocs ships no gallery/carousel
 *  primitive of its own. The hero delegates its click to the filmstrip's
 *  own first thumbnail (a real click, not a second data-lightbox element)
 *  so the lightbox's item list has exactly one entry per image, not two. */
export function Gallery({ groups }: { groups: GalleryGroup[] }) {
  const openFirst = (e: MouseEvent<HTMLImageElement>) => {
    const filmstrip = e.currentTarget.parentElement?.querySelector<HTMLElement>('[data-lightbox]');
    filmstrip?.click();
  };

  return (
    <div className="not-prose flex flex-col gap-8">
      {groups.map((group, gi) => {
        const [first, ...rest] = group.items;
        if (!first) return null;
        return (
          <div key={group.category ?? gi} className="flex flex-col gap-3">
            {group.category && (
              <h3 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
                {group.category}
              </h3>
            )}
            <div className="flex flex-col gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={first.image}
                alt={first.alt}
                onClick={openFirst}
                className="aspect-video w-full cursor-zoom-in rounded-lg border object-cover transition-opacity hover:opacity-90"
              />
              <div className="flex gap-2 overflow-x-auto pb-1">
                {group.items.map((item) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={item.title}
                    src={item.image}
                    alt={item.alt}
                    title={item.title}
                    data-lightbox=""
                    data-lightbox-title={item.title}
                    data-lightbox-href={item.href}
                    className="aspect-video w-24 shrink-0 cursor-zoom-in rounded border object-cover transition-opacity hover:opacity-90 sm:w-32"
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
