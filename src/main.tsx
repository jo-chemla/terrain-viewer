import React from "react"
import ReactDOM from "react-dom/client"
import { NuqsAdapter } from "nuqs/adapters/react"
import App from "./App"
import "./index.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <React.Suspense>
      <NuqsAdapter>
        <App />
      </NuqsAdapter>
    </React.Suspense>
  </React.StrictMode>,
)
