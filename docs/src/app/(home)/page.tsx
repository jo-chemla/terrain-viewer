import Link from 'next/link';
import { FeatureGrid } from '@/components/feature-lightbox';
import { DemoCut } from '@/components/demo-videos';

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
    href: '/features/visualization-modes',
  },
  {
    title: 'Light-Direction XYPad',
    body: 'Drag a 2D pad to set Hillshade/Phong illumination azimuth and elevation together, bound to real sun position and day/night constraints.',
    // A still, not the .mp4 it used to be: the home page must come up fast.
    image: '/docs/screenshots/viz-modes/hillshade.jpg',
    alt: 'Hillshade lit from the direction set on the XYPad',
    href: '/features/sun-position',
  },
  {
    title: 'Historical Imagery',
    body: 'Browse decades of historical satellite imagery (Wayback, HLS, Google Earth Historical, Planet) along a draggable timeline, per view.',
    image: '/docs/screenshots/historical-timeline.jpg',
    alt: 'Scrubbing the historical imagery timeline',
    href: '/features/historical-imagery',
  },
  {
    title: 'Split Screen & N-Map Compare',
    body: 'Side-by-side, overlay/blend, or up to an 8-view grid to compare terrain sources, basemaps, or historical dates against each other.',
    image: '/docs/screenshots/n-grid.jpg',
    alt: 'Comparing basemap sources side-by-side',
    href: '/features/split-modes',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-col">
      {/* The hero: the app over the Alps (overview-hero.jpg without its
          sidebar, cropped by ffmpeg into home-hero.jpg), darkened at the
          bottom so the words read, two equal calls to action (the app first,
          it is what the docs describe), and three quick links underneath. */}
      <section className="relative overflow-hidden border-b">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/docs/screenshots/home-hero.jpg" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/35 via-black/55 to-black/80" />
        <div className="relative mx-auto max-w-4xl px-6 py-28 text-center text-white sm:py-36">
          <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-white/70">Terrain Viewer · docs</p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">Terrain &amp; historical imagery, in the browser</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-white/80">
            Hillshade, hypsometric tint, contours and relief visualization from any elevation source, and decades of satellite imagery on one timeline. MapLibre GL, nothing to install.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a href="../" className="rounded-lg bg-white px-6 py-3 text-base font-semibold text-black shadow-lg transition hover:bg-white/90">Launch the app</a>
            <Link href="/overview" className="rounded-lg border border-white/40 bg-white/10 px-6 py-3 text-base font-semibold text-white backdrop-blur transition hover:bg-white/20">Read the docs</Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-white/70">
            <Link href="/features/walkthrough" className="hover:text-white">Walkthrough</Link>
            <Link href="/features/demo-videos" className="hover:text-white">Demo videos</Link>
            <Link href="/features/slide-decks" className="hover:text-white">Slide decks</Link>
            <Link href="/features/national-datasets" className="hover:text-white">National datasets</Link>
          </div>
        </div>
      </section>

      {/* The narrated demo, from the Demo videos page's player: a poster
          until pressed, then the MP4 streams from the demo-takes release. */}
      <section className="mx-auto w-full max-w-4xl px-6 pt-16">
        <h2 className="text-center text-2xl font-semibold tracking-tight">Two and a half minutes of it</h2>
        <p className="mt-2 text-center text-fd-muted-foreground">Slope and hypsometric tint over Mont Blanc, then the Champ de Mars across fifteen years of imagery.</p>
        <DemoCut />
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
