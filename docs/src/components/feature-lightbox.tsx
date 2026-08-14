'use client';

import { useEffect, useState } from 'react';

export interface Feature {
  title: string;
  body: string;
  image: string;
  alt: string;
}

export function FeatureGrid({ features }: { features: Feature[] }) {
  const [lightbox, setLightbox] = useState<Feature | null>(null);

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
      <div className="grid gap-10 sm:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {f.image.endsWith('.mp4') ? (
              <video
                src={f.image}
                autoPlay loop muted playsInline
                onClick={() => setLightbox(f)}
                className="w-full cursor-zoom-in rounded-xl border object-cover transition-opacity hover:opacity-90"
              />
            ) : (
              <img
                src={f.image}
                alt={f.alt}
                onClick={() => setLightbox(f)}
                className="w-full cursor-zoom-in rounded-xl border object-cover transition-opacity hover:opacity-90"
              />
            )}
            <h2 className="text-lg font-semibold">{f.title}</h2>
            <p className="text-sm text-fd-muted-foreground">{f.body}</p>
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
          {lightbox.image.endsWith('.mp4') ? (
            <video
              src={lightbox.image}
              autoPlay loop muted playsInline controls
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.image}
              alt={lightbox.alt}
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          )}
        </div>
      )}
    </>
  );
}
