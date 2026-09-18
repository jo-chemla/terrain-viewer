import Link from 'next/link';

export interface Feature {
  title: string;
  body: string;
  image: string;
  alt: string;
  /** Docs page the card opens (basePath-relative, as next/link expects). */
  href: string;
}

/** The home page's feature cards: each one is a link to its docs page
 *  (image, title and text alike), not a lightbox - the page is the point.
 *  Stills only, no video: the home page has to come up fast. */
export function FeatureGrid({ features }: { features: Feature[] }) {
  return (
    <div className="grid gap-10 sm:grid-cols-2">
      {features.map((f) => (
        <Link key={f.title} href={f.href} className="group flex flex-col gap-3 no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={f.image}
            alt={f.alt}
            loading="lazy"
            className="w-full rounded-xl border object-cover transition-opacity group-hover:opacity-90"
          />
          <h2 className="text-lg font-semibold group-hover:underline">{f.title}</h2>
          <p className="text-sm text-fd-muted-foreground">{f.body}</p>
        </Link>
      ))}
    </div>
  );
}
