import React from "react"
import ReactDOM from "react-dom/client"
import { NuqsAdapter } from "nuqs/adapters/react"
import App from "./App"
import "./index.css"
// TEST (try/tweakcn-theme-picker branch): imported AFTER index.css so the
// [data-theme="…"] preset blocks win over :root/.dark by source order.
import "./styles/themes/index.css"
import { ThemeProvider } from "@/components/theme-provider"
import { ThemeSwitcher } from "@/components/theme-switcher"
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
            "viewMode", "zoom", "lat", "lng", "pitch", "bearing",
            "sourceA", "splitScreen", "sourceB",
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
          {/* TEST-only floating theme picker (top-center, clear of the geocoder
              and the right-side control panel; dropdown opens downward). */}
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999]">
            <ThemeSwitcher />
          </div>
        </ThemeProvider>
        <TanStackDevtools />
      </NuqsAdapter>
    </React.Suspense>
  </React.StrictMode>,
)
