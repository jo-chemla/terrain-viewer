import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from '@tanstack/devtools-vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { fileURLToPath, URL } from "url"

export default defineConfig({
  plugins: [
    devtools({ eventBusConfig: { port: 42169 } }),
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
      "/docs": { target: "http://localhost:3100", changeOrigin: true },
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
