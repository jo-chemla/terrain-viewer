import React from "react"
import ReactDOM from "react-dom/client"
import { NuqsAdapter } from "nuqs/adapters/react"
import App from "./App"
import "./index.css"
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
        <App />
        
      <TanStackDevtools />
      </NuqsAdapter>
    </React.Suspense>
  </React.StrictMode>,
)
