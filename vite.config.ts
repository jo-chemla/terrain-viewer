import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from '@tanstack/devtools-vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    devtools(),
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
      "@": path.resolve(__dirname, "./"),
    },
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'], // Add this
  },
  base: "./",
  publicDir: 'public',
  server: {
    host: true, // bind to 0.0.0.0 so the dev server is reachable on the LAN, not just localhost
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
