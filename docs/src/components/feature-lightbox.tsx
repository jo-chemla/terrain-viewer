export interface Feature {
  title: string;
  body: string;
  image: string;
  alt: string;
}

/** Click-to-lightbox via the page's shared LightboxProvider (see
 *  (home)/page.tsx and lightbox.tsx) — looping left/right arrow-key
 *  navigation across every feature image/video. */
export function FeatureGrid({ features }: { features: Feature[] }) {
  return (
    <div className="grid gap-10 sm:grid-cols-2">
      {features.map((f) => (
        <div key={f.title} className="flex flex-col gap-3">
          {f.image.endsWith('.mp4') ? (
            <video
              src={f.image}
              autoPlay
              loop
              muted
              playsInline
              data-lightbox=""
              className="w-full cursor-zoom-in rounded-xl border object-cover transition-opacity hover:opacity-90"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={f.image}
              alt={f.alt}
              data-lightbox=""
              className="w-full cursor-zoom-in rounded-xl border object-cover transition-opacity hover:opacity-90"
            />
          )}
          <h2 className="text-lg font-semibold">{f.title}</h2>
          <p className="text-sm text-fd-muted-foreground">{f.body}</p>
        </div>
      ))}
    </div>
  );
}
