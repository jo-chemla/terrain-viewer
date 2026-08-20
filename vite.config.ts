import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from '@tanstack/devtools-vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { fileURLToPath, URL } from "url"

export default defineConfig({
  plugins: [
    devtools({
      // Fixed port, so two dev servers started from this repo at once (a git
      // worktree alongside the main checkout, say) collide on it and the
      // second one dies with EADDRINUSE — even though --port for the dev
      // server itself was already unique. Overridable so those can coexist:
      //   DEVTOOLS_EVENT_BUS_PORT=42170 pnpm dev --port 5173
      // Default unchanged, so nothing has to be set for the usual single-
      // server case.
      eventBusConfig: { port: Number(process.env.DEVTOOLS_EVENT_BUS_PORT) || 42169 },
      // react-map-gl's <Source>/<Layer> spread ALL received JSX props
      // straight into the maplibre style-spec source/layer definition object
      // (addSource/addLayer), with no allowlist — the injected data-tsd-source
      // debug attribute this plugin normally adds to every JSX element trips
      // maplibre's schema validator ("unknown property") the moment such a
      // source/layer is freshly mounted (confirmed via TellsSource's frozen
      // geojson variant, MapSources.tsx — a source id/type combo that only
      // gets added at runtime, unlike the ones already present at initial
      // mount). Every other JSX element is a plain DOM node, where an extra
      // data-* attribute is harmless, so this is scoped to just these two.
      injectSource: { enabled: true, ignore: { components: [/^Source$/, /^Layer$/] } },
    }),
    react(),
    tailwindcss(),
    nodePolyfills({
      include: ['buffer', 'fs', 'path', 'crypto', 'stream', 'util'],
    }),
  ],
  optimizeDeps: {
    exclude: ['@loaders.gl/geopackage', '@loaders.gl/core', 'sql.js'],
  },
  ssr: {
    noExternal: ['@loaders.gl/geopackage', '@loaders.gl/core'],
  },
  resolve: {
    alias: {
    "@": fileURLToPath(new URL("./", import.meta.url)),
    },
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'], // Add this
  },
  base: "./",
  publicDir: 'public',
  server: {
    host: true, // bind to 0.0.0.0 so the dev server is reachable on the LAN, not just localhost
    // /docs is a separate Next.js app (docs/), not part of this Vite app —
    // without this, a request for e.g. /docs/getting-started/ falls through
    // Vite's own SPA history-fallback and silently serves this app's
    // index.html instead, reading as "/docs/ redirects to the app". Run the
    // docs dev server alongside this one (`pnpm run docs:dev`, fixed port
    // 3100) for /docs to work here too; if it isn't running, this proxy
    // fails loudly (connection refused) instead of that silent wrong page.
    proxy: {
      // ws: true also forwards the WebSocket upgrade for Next/Turbopack's
      // own dev-time HMR channel — without it, plain page loads still work
      // (confirmed: identical HTML/JS all load fine), but every client
      // component stayed inert (theme toggle, search, sidebar sections all
      // no-op with zero DOM change and no thrown error) since Next's dev
      // client apparently gates finishing its own setup on that socket.
      // DOCS_PORT env override mirrors DEVTOOLS_EVENT_BUS_PORT's purpose: in
      // a git worktree running alongside the main checkout, 3100 is already
      // taken by the main checkout's docs server — which would silently serve
      // ITS content here. Run e.g. `pnpm --dir docs exec next dev -p 3101`
      // and `DOCS_PORT=3101 pnpm dev --port 5174` instead.
      "/docs": {
        target: `http://localhost:${process.env.DOCS_PORT ?? 3100}`,
        changeOrigin: true,
        ws: true,
        // docs/content/docs/*.mdx files are also imported here (via `?raw`)
        // as the single source of truth for Settings-dialog sections like
        // Keyboard Shortcuts — Vite serves that raw-string module at the
        // same on-disk-relative URL, which happens to start with "/docs" and
        // would otherwise be swallowed by the proxy above before Vite's own
        // module-serving middleware ever sees it. Returning the untouched
        // req.url here tells http-proxy-middleware to skip proxying and let
        // the request fall through to Vite instead.
        bypass: (req) => (req.url?.startsWith("/docs/content/") ? req.url : undefined),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: true,
  },
  // lib/cog-contour-worker.ts (new Worker(..., { type: "module" }) in
  // lib/cog-contour-protocol.ts) itself imports other modules, so Rollup
  // needs to code-split its bundle - Vite's default worker output format
  // ("iife") doesn't support that ("UMD and IIFE output formats are not
  // supported for code-splitting builds"). "es" does.
  worker: {
    format: 'es',
  },
})
