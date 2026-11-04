// `open-slide dev` with one addition: the docs' screenshots, which the
// decks show by URL (assets/shots.ts), proxied from the docs dev server
// (port 3100, or DOCS_PORT). open-slide builds its Vite config itself
// (configFile: false, no proxy option), so this reuses that config through
// its public entry and adds the proxy. Port and base come from
// open-slide.config.ts as before. vite is a devDependency here so that this
// resolves the same vite 8 open-slide runs on (not the app's vite 7 up the
// tree, whose plugins fail in rolldown with "Missing field `moduleType`").
import { createServer, mergeConfig } from "vite"
import { createViteConfig } from "@open-slide/core/vite"

const docsPort = Number(process.env.DOCS_PORT) || 3100
const base = await createViteConfig({ userCwd: process.cwd(), mode: "serve" })
const server = await createServer(mergeConfig(base, {
  server: {
    proxy: {
      "/docs/screenshots/": { target: `http://localhost:${docsPort}`, changeOrigin: true },
    },
  },
}))
await server.listen()
server.printUrls()
console.log(`  /docs/screenshots/ -> http://localhost:${docsPort} (the docs dev server; DOCS_PORT to change)`)
if (process.stdin.isTTY) server.bindCLIShortcuts({ print: true })
