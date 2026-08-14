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
  // (index.html at the repo root), swapped client-side below since a
  // static-exported Next app has no request-time hostname to branch on at
  // render time.
  icons: { icon: '/docs/favicon.svg' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        {/* beforeInteractive so this swaps before first paint, same as the
            main app's own inline favicon script (index.html) — no flash of
            the wrong-colored icon. historical-satellite.iconem.com (and any
            subdomain) counts as "prod" too, same as the main app: it's a
            real deploy of this same docs site, just a different domain. */}
        <Script id="favicon-swap" strategy="beforeInteractive">
          {`(function () {
            var host = location.hostname
            var isProd = host === "terrain-viewer.iconem.com" ||
              host === "historical-satellite.iconem.com" || /\\.historical-satellite\\.iconem\\.com$/.test(host)
            if (isProd) return
            var link = document.querySelector('link[rel="icon"]')
            if (link) link.href = "/docs/favicon-dev.svg"
          })()`}
        </Script>
      </head>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
