import Link from 'next/link';
import { FeatureGrid } from '@/components/feature-lightbox';

// Plain public/-relative string paths, explicitly prefixed with the app's
// own basePath ("/docs", see next.config.mjs) — unlike next/link's href,
// a plain <img src> (or next/image's src) never gets basePath auto-applied
// by Next.js, so it has to be included here by hand. Plain <img> (not
// next/image) since images.unoptimized is already set globally for the
// static export, and next/image's <fill>/GIF handling adds friction for no
// benefit once optimization itself is a no-op.
const FEATURES = [
  {
    title: 'Terrain Visualization Modes',
    body: 'Hillshade, hypsometric tinting, contours, slope/aspect/curvature, TRI/TPI/roughness, LRM, Sky-View Factor, Openness, and mound (tell) detection.',
    image: '/docs/screenshots/terrain-viewer.jpg',
    alt: 'Sky-View Factor relief visualization',
  },
  {
    title: 'Historical Imagery',
    body: 'Browse decades of historical satellite imagery (Wayback, HLS, Google Earth Historical, Planet) along a draggable timeline, per view.',
    image: '/docs/screenshots/historical-timeline.jpg',
    alt: 'Scrubbing the historical imagery timeline',
  },
  {
    title: 'Light-Direction XYPad',
    body: 'Drag a 2D pad to set Hillshade/Phong illumination azimuth and elevation together, bound to real sun position and day/night constraints.',
    image: '/docs/screenshots/hillshade-direction.mp4',
    alt: 'Dragging the XYPad to set light direction',
  },
  {
    title: 'Split Screen & N-Map Compare',
    body: 'Side-by-side, overlay/blend, or up to an 8-view grid to compare terrain sources, basemaps, or historical dates against each other.',
    image: '/docs/screenshots/n-grid.jpg',
    alt: 'Comparing basemap sources side-by-side',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-col">
      <section className="relative overflow-hidden border-b">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/docs/screenshots/terrain-viewer.jpg"
          alt=""
          className="absolute inset-0 -z-10 h-full w-full object-cover opacity-20"
        />
        <div className="relative mx-auto max-w-4xl px-6 py-24 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Terrain & historical imagery, in the browser
          </h1>
          <p className="mt-4 text-lg text-fd-muted-foreground">
            Hillshade, hypsometric tint, contours, relief visualization, and a
            historical satellite imagery timeline — built on MapLibre GL.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/overview"
              className="rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
            >
              Read the Docs
            </Link>
            <a
              href="../"
              className="rounded-lg border px-5 py-2.5 font-medium transition-colors hover:bg-fd-accent"
            >
              Launch the App
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <FeatureGrid features={FEATURES} />
      </section>

      <section className="border-t">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h2 className="text-2xl font-semibold">
            Every view is a shareable link
          </h2>
          <p className="mt-3 text-fd-muted-foreground">
            Viewport, sources, and every visualization setting live in the
            URL — copy the address bar to reproduce the exact same view for
            anyone else, or save it as a bookmark.
          </p>
          <Link
            href="/overview"
            className="mt-6 inline-block rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Get Started
          </Link>
        </div>
      </section>
    </main>
  );
}
