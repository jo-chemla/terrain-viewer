import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { Provider } from '@/components/provider';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
});

// Only affects absolute-URL resolution for OG/Twitter meta tags — the app
// itself is also served from historical-satellite.iconem.com, but there's no
// single "canonical" domain to prefer over the other for this purpose.
export const metadata: Metadata = {
  metadataBase: new URL('https://terrain-viewer.iconem.com/docs/'),
  // Without this, the browser falls back to fumadocs-ui's own default
  // favicon (a generic, unstyled lucide book-open glyph) instead of this
  // colored one. Deliberately a book-open glyph (not the main app's mountain
  // icon) since this is the docs site, not the viewer — but same
  // purple(dev)/blue(prod) color convention as the main app's own favicon
  // (index.html at the repo root). Defaults to the DEV (purple) icon, not
  // prod — a static-exported Next app has no request-time hostname to branch
  // on at render time, so this literal tag is what the browser sees (and may
  // already cache as the tab icon) before the client-side swap below ever
  // runs: next/script's "beforeInteractive" scripts are queued through
  // Next's own self.__next_s bootstrap rather than a truly synchronous inline
  // <script>, unlike index.html's — confirmed live, it can lose the race to
  // this static tag. Defaulting to dev and only swapping UP to the prod icon
  // once confirmed means a lost race still shows purple in dev (safe) rather
  // than blue on a non-prod tab (confusable with the real site).
  icons: { icon: '/docs/favicon-dev.svg' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        {/* beforeInteractive so this swaps as early as possible, same intent
            as the main app's own inline favicon script (index.html) — but
            unlike that literal synchronous <script>, next/script's
            "beforeInteractive" is only queued via Next's self.__next_s
            bootstrap, not guaranteed to beat the browser to the static
            metadata <link> tag above. Swaps UP to the prod icon (the tag
            above already defaults to dev/purple, the safe fallback if this
            loses that race) rather than the reverse. historical-satellite.
            iconem.com (and any subdomain) counts as "prod" too, same as the
            main app: it's a real deploy of this same docs site, just a
            different domain — same for jo-chemla.github.io, the plain
            GitHub Pages URL this same build is also served from. */}
        <Script id="favicon-swap" strategy="beforeInteractive">
          {`(function () {
            var host = location.hostname
            var isProd = host === "terrain-viewer.iconem.com" || host === "jo-chemla.github.io" ||
              host === "historical-satellite.iconem.com" || /\\.historical-satellite\\.iconem\\.com$/.test(host)
            if (!isProd) return
            var link = document.querySelector('link[rel="icon"]')
            if (link) link.href = "/docs/favicon.svg"
          })()`}
        </Script>
      </head>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
