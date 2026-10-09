import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { Provider } from '@/components/provider';
import './global.css';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The Umami website id of the build: VITE_UMAMI_WEBSITE_ID from the process
// env, else from the repo root .env (the Pages deploy writes it from the
// ENV_FILE_CONTENT secret). Absent: the tracker is not loaded. Read at build
// time (this layout is a server component of a static export).
const umamiWebsiteId = (() => {
  const fromEnv = process.env.VITE_UMAMI_WEBSITE_ID;
  if (fromEnv) return fromEnv;
  try {
    const m = readFileSync(resolve(process.cwd(), '..', '.env'), 'utf8').match(/^VITE_UMAMI_WEBSITE_ID=([0-9a-f-]{36})s*$/m);
    return m?.[1] ?? '';
  } catch {
    return '';
  }
})();

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
        {umamiWebsiteId && <Script id="umami-loader" strategy="afterInteractive">
          {`(function () {
            var host = location.hostname
            if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "") return
            var ownTag = ""
            try {
              var m = location.search.match(/[?&]umamiTag=([^&]*)/)
              if (m) { if (m[1]) localStorage.setItem("umamiTag", decodeURIComponent(m[1])); else localStorage.removeItem("umamiTag") }
              ownTag = localStorage.getItem("umamiTag") || ""
            } catch (e) {}
            var s = document.createElement("script")
            s.defer = true
            s.src = "https://cloud.umami.is/script.js"
            s.setAttribute("data-website-id", "${umamiWebsiteId}")
            s.setAttribute("data-tag", ownTag || "web")
            s.setAttribute("data-exclude-search", "true")
            // A hash change counts as a pageview too (20 hash-only history calls
            // measured as 20 pageviews on 2026-10-09); the docs headings are hash links.
            s.setAttribute("data-exclude-hash", "true")
            s.setAttribute("data-domains", "terrain-viewer.iconem.com,historical-satellite.iconem.com,jo-chemla.github.io")
            document.head.appendChild(s)
          })()`}
        </Script>}
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
