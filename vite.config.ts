import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from '@tanstack/devtools-vite'

export default defineConfig({
  plugins: [
    devtools(),
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'], // Add this
  },
  base: "./",
})
