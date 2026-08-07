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
// Imported AFTER index.css so the [data-theme="…"] preset blocks (tweakcn color
// presets, picked from Settings > Appearance) win over :root/.dark by source order.
import "./styles/themes/index.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TanStackDevtools } from '@tanstack/react-devtools'

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
            "sourceA", "splitStyle", "gridLayout", "sourceB",
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
