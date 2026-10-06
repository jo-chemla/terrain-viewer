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
  // Every page's <title> gets the site's name: a bare "Dev" or "Features"
  // is too short for a search result (Bing flagged eleven pages), and the
  // suffix says what the site is.
  title: { template: '%s · Terrain Viewer docs', default: 'Terrain Viewer docs: elevation, relief and historical imagery' },
  // Without this, the browser falls back to fumadocs-ui's own default
  // favicon (a generic, unstyled lucide book-open glyph) instead of this
  // colored one. Deliberately a book-open glyph (not the main app's mountain
  // icon) since this is the docs site, not the viewer — but same
  // purple(dev)/blue(prod) color convention as the main app's own favicon
  // (index.html at the repo root). Defaults to the PROD (blue) icon: a
  // static-exported Next app has no request-time hostname, and production is
  // what visitors see. The script below turns it purple on a dev host. It
  // used to be the other way round (purple by default, swapped up to blue),
  // but after hydration the head could hold a second, purple icon link that
  // the swap never saw, and the browser uses the last one: production docs
  // showed the dev icon.
  icons: { icon: '/docs/favicon.svg' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        {/* beforeInteractive so this swaps as early as possible, same intent
            as the main app's own inline favicon script (index.html). Only on
            a dev host (localhost, a LAN address): every icon link turns
            purple, and so does any added later, which a MutationObserver
            catches. Production, historical-satellite.iconem.com and
            jo-chemla.github.io keep the blue default. */}
        {/* Umami, the same website as the app (index.html), so docs visits
            and the app share one dashboard. Not on localhost, where every dev
            session would otherwise report into production. */}
        <Script id="umami-loader" strategy="afterInteractive">
          {`(function () {
            var host = location.hostname
            if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "") return
            var s = document.createElement("script")
            s.defer = true
            s.src = "https://cloud.umami.is/script.js"
            s.setAttribute("data-website-id", "89d911b9-9de7-4665-872e-5b91ff4b7b39")
            s.setAttribute("data-exclude-search", "true")
            document.head.appendChild(s)
          })()`}
        </Script>
        <Script id="favicon-swap" strategy="beforeInteractive">
          {`(function () {
            var host = location.hostname
            var isDev = host === "localhost" || host === "127.0.0.1" || host === "::1" ||
              /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host)
            if (!isDev) return
            // Every icon link, and any added later: after hydration the head
            // can hold a second icon link, and the browser uses the last one.
            var swap = function () {
              document.querySelectorAll('link[rel~="icon"]').forEach(function (l) {
                if (l.getAttribute("href") !== "/docs/favicon-dev.svg") l.setAttribute("href", "/docs/favicon-dev.svg")
              })
            }
            swap()
            new MutationObserver(swap).observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] })
          })()`}
        </Script>
      </head>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
