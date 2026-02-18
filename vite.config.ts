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
    nodePolyfills({ include: ['buffer'] }),
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
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: true, 
  }
})
