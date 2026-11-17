// react-scan's own docs ask for this to be imported before react/react-dom so
// it can hook into React's internals as early as possible. A dynamic import
// (rather than a static one) keeps it out of the production bundle entirely:
// import.meta.env.DEV is statically replaced at build time, so Rollup treats
// this whole block as dead code and drops both it and the react-scan chunk.
if (import.meta.env.DEV) {
  // enabled: false keeps outline-drawing off by default; showToolbar must be
  // passed explicitly (not just left at its own default) — scan() early-
  // returns and skips creating the toolbar entirely if enabled is false and
  // showToolbar isn't ALSO explicitly true in this same options object.
  // Click the toolbar's play button to turn scanning back on.
  import("react-scan").then(({ scan }) => scan({ enabled: false, showToolbar: true }))
}

import React from "react"
import ReactDOM from "react-dom/client"
import { NuqsAdapter } from "nuqs/adapters/react"
import App from "./App"
import "./index.css"
import { initDesktopBridge } from "@/lib/desktop-bridge"

initDesktopBridge()
// Imported AFTER index.css so the [data-theme="…"] preset blocks (tweakcn color
// presets, picked from Settings > Appearance) win over :root/.dark by source order.
import "./styles/themes/index.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TanStackDevtools } from '@tanstack/react-devtools'
import { startEmbedBridge } from "@/lib/embed-bridge"
import { migrateLegacyUrlKeys } from "@/lib/url-keys"
import { setWorkerUrl, setWorkerCount, getWorkerCount, getVersion } from "maplibre-gl"
import maplibrePkg from "maplibre-gl/package.json"
import { pushToast } from "@/components/ui/toast"
// MapLibre 6 is ESM-only and, under a bundler, cannot find its own worker
// from import.meta.url; Vite's ?worker&url emits a self-contained chunk.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"

setWorkerUrl(maplibreWorkerUrl)

// MapLibre keeps ONE worker on Chrome, Edge and Firefox (up to 3 on Safari),
// shared by every map on the page. Contours are traced there (lib/contour-
// worker-client.ts), next to vector tile parsing, so a split view or a
// screenful of contour tiles queued on that single worker. The pool is sized
// like the raster one (lib/raster-compute-pool.ts): cores minus 2, at most 4.
// It must be set before the first map exists. localStorage "tv-map-workers"
// (1 to 8) overrides it, for measuring.
{
  let override = NaN
  try { override = Number(localStorage.getItem("tv-map-workers")) } catch { /* storage blocked */ }
  const cores = navigator.hardwareConcurrency || 4
  const wanted = override >= 1 && override <= 8 ? Math.round(override) : Math.max(1, Math.min(4, cores - 2))
  setWorkerCount(override >= 1 ? wanted : Math.max(getWorkerCount(), wanted))
}

// Dev only: the main thread's MapLibre comes from Vite's dependency cache,
// the worker from the installed package. After a bump the cache once kept
// 6.11.2 under the 6.13.0 worker: every tile failed with "can't deserialize
// unregistered class StructArrayLayout...", the style never loaded and the
// drawing tools never initialised, with nothing naming the cause. Compare
// the two versions and catch that error, and say what to do.
if (import.meta.env.DEV) {
  const installed = maplibrePkg.version
  const running = getVersion()
  const explain = (what: string) => {
    const title = "MapLibre is split across two versions"
    const body = `${what} Stop the dev server, delete node_modules/.vite and start it again (pnpm app --force).`
    console.error(`[dev] ${title}: ${body}`)
    pushToast({ key: "maplibre-version-split", title, body, duration: 120_000, tone: "alert", action: { label: "Reload", onClick: () => window.location.reload() } })
  }
  if (installed !== running) explain(`Vite's dependency cache serves ${running} to the page while ${installed} is installed (and runs the worker).`)
  window.addEventListener("unhandledrejection", (e) => {
    const msg = String((e.reason as { message?: string })?.message ?? e.reason ?? "")
    if (msg.includes("unregistered class")) explain("The worker sends tile data the page cannot read (" + msg.slice(0, 80) + ").")
  })
}

// Links written before the terrain-source URL keys were renamed carry
// sourceA=..; rewrite them before nuqs reads the address bar.
{
  const url = new URL(window.location.href)
  if (migrateLegacyUrlKeys(url.searchParams)) window.history.replaceState(window.history.state, "", url.toString())
}

// When iframed by an allowed meta-app wrapper (heritagewatch/anchise/localhost),
// stream our URL state up to it once a second — see lib/embed-bridge.ts.
startEmbedBridge()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <React.Suspense>
      <NuqsAdapter
        // processUrlSearchParams={(search) => {
        //   search.sort()
        //   console.log({ search })
        //   return search
        // }}
        processUrlSearchParams={(search) => {
          const priorityOrder = [
            "project",
            "appMode",
            "viewMode", "zoom", "lat", "lng", "pitch", "bearing",
            "terrainSourceA", "splitStyle", "gridLayout", "terrainSourceB",
            "showHillshade", "showColorRelief", "showRasterBasemap", "showContours", "showBackground",
          ];

          const entries = Array.from(search.entries());
          const ordered = new URLSearchParams();

          // Insert priority keys in order, only if present
          for (const key of priorityOrder) {
            const found = entries.filter(([k]) => k === key);
            for (const [k, v] of found) ordered.append(k, v);
          }

          // Insert all remaining keys, preserving original order
          for (const [k, v] of entries) {
            if (!priorityOrder.includes(k)) {
              ordered.append(k, v);
            }
          }

          return ordered;
        }}
      >
        <ThemeProvider>
          <App />
        </ThemeProvider>
        <TanStackDevtools />
      </NuqsAdapter>
    </React.Suspense>
  </React.StrictMode>,
)
