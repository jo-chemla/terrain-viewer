import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from '@tanstack/devtools-vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { fileURLToPath, URL } from "url"
import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import http from "http"
import net from "net"

// Build stamp for the About section: the commit and the build day. The
// commit comes from git at build time (CI checks the repo out), "dev" when
// git is not there.
const buildCommit = (() => { try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() } catch { return "dev" } })()
const buildDate = new Date().toISOString().slice(0, 10)

export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
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
    // /docs/slides/ in dev: the built decks and PDFs from .cache/slides-site
    // (the /docs proxy above lets these requests through).
    {
      name: "slides-static",
      configureServer(server) {
        const site = fileURLToPath(new URL("./.cache/slides-site", import.meta.url))
        const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".pdf": "application/pdf", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".mp4": "video/mp4", ".webm": "video/webm" }
        // The live editor (pnpm slides, port 3200, base /docs/slides/) wins
        // when it is up: comments, inspector and inline edits are there. Its
        // reachability is checked at most every few seconds.
        const editorPort = Number(process.env.SLIDES_PORT) || 3200
        let editorUp = false, editorCheckedAt = 0
        const probeEditor = () => new Promise<boolean>((resolve) => {
          const sock = net.connect({ port: editorPort, host: "127.0.0.1" })
          const done = (v: boolean) => { sock.destroy(); resolve(v) }
          sock.once("connect", () => done(true)); sock.once("error", () => done(false)); sock.setTimeout(300, () => done(false))
        })
        server.middlewares.use(async (req, res, next) => {
          const url = req.url ?? ""
          if (!url.startsWith("/docs/slides")) return next()
          if (url === "/docs/slides") { res.writeHead(302, { Location: "/docs/slides/" }); res.end(); return }
          if (Date.now() - editorCheckedAt > 3000) { editorUp = await probeEditor(); editorCheckedAt = Date.now() }
          // PDFs only exist in the published build: those stay on the static site.
          if (editorUp && !url.startsWith("/docs/slides/pdf/")) {
            const up = http.request({ host: "127.0.0.1", port: editorPort, path: url, method: req.method, headers: { ...req.headers, host: `localhost:${editorPort}` } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res) })
            up.on("error", () => { if (!res.headersSent) { res.statusCode = 502; res.end("The slides editor on port " + editorPort + " did not answer.") } })
            req.pipe(up)
            return
          }
          const rel = decodeURIComponent(url.slice("/docs/slides/".length).split("?")[0])
          let file = path.join(site, rel)
          if (!file.startsWith(site)) { res.statusCode = 403; res.end(); return }
          if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html")
          if (!fs.existsSync(file)) {
            res.statusCode = 404
            res.setHeader("content-type", "text/plain; charset=utf-8")
            res.end(fs.existsSync(site)
              ? `Not in the built slides site: ${rel}`
              : "Nothing serves /docs/slides/ yet: run `pnpm slides` for the live editor (port 3200, proxied here), or `pnpm slides:static` / `pnpm slides:pdf` once for the published build (and its PDFs).")
            return
          }
          res.setHeader("content-type", types[path.extname(file).toLowerCase()] ?? "application/octet-stream")
          fs.createReadStream(file).pipe(res)
        })
      },
    },
  ],
  optimizeDeps: {
    exclude: ['@loaders.gl/geopackage', '@loaders.gl/core', 'sql.js'],
    // The node polyfill shims are first imported by a lazy chunk (a
    // visualization mode toggled later); without listing them here Vite
    // bundles them on that first toggle and reloads the page mid-session
    // ("new dependencies optimized"), which also broke screencast takes.
    include: ['vite-plugin-node-polyfills/shims/buffer', 'vite-plugin-node-polyfills/shims/global', 'vite-plugin-node-polyfills/shims/process'],
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
    // The coverage build scripts leave their crawls under .cache/ - one Google
    // 3D crawl to z12 is ~116 000 tile files and a few hundred MB of GeoJSON.
    // Vite's watcher ignores only node_modules and .git by default, and
    // trying to watch that tree wedged the dev server (1.6 GB resident,
    // connections stuck in CLOSE_WAIT, no response at all). Nothing in
    // .cache is ever imported; keep the watcher out of it.
    watch: { ignored: ["**/.cache/**", "**/dist/**", "**/docs/out/**", "**/docs/.next/**"] },
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
        // Screenshots are the second thing this app reads out of the docs
        // tree (the Data layers modal shows one per visualization mode), and
        // they are plain files — there is no reason a picture in the app
        // should need the Next.js dev server to be running. In prod the docs
        // build merges docs/public into dist/docs, so /docs/screenshots/ is
        // already the right URL; here we just point it at where those files
        // actually live on disk and let Vite's own static middleware serve
        // them. Not imported through Vite instead because the folder is 36 MB
        // — bundling it would double every screenshot into dist/assets.
        // The STAC catalog under /docs/stac is read by STAC Map and STAC
        // Browser from their own origins (GitHub Pages sends this in prod).
        configure: (proxy) => { proxy.on("proxyRes", (proxyRes) => { proxyRes.headers["access-control-allow-origin"] = "*" }) },
        // The slide decks (and their PDFs) are not a Next route either: the
        // docs deploy copies slides/scripts/publish.mjs's output to
        // /docs/slides/. Here they come from the same output in
        // .cache/slides-site (built by `pnpm slides:static` or
        // `pnpm slides:pdf`), served by the middleware below.
        bypass: (req) =>
          req.url?.startsWith("/docs/content/")
            ? req.url
            : req.url?.startsWith("/docs/screenshots/")
              ? req.url.replace("/docs/screenshots/", "/docs/public/screenshots/")
              : req.url?.startsWith("/docs/slides/") || req.url === "/docs/slides"
                ? req.url
                : undefined,
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
