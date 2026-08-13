import { defineConfig } from "vitepress"

// Served at terrain-viewer.iconem.com/docs/ (or historical-satellite.iconem.com/docs/,
// or <owner>.github.io/<repo>/docs/ on a plain GitHub Pages project URL) —
// built separately from the main Vite SPA and copied into dist/docs by the
// GitHub Pages workflow, see .github/workflows/deploy-gh-page-on-push.yml.
export default defineConfig({
  base: "/docs/",
  title: "Terrain Viewer",
  description: "Documentation for the Iconem terrain & historical imagery viewer",
  cleanUrls: true,
  head: [["link", { rel: "icon", href: "/docs/favicon.svg" }]],
  themeConfig: {
    logo: "/favicon.svg",
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Features", link: "/features/" },
      { text: "App", link: "/" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Getting Started", link: "/getting-started" },
        ],
      },
      {
        text: "Features",
        items: [
          { text: "Overview", link: "/features/" },
          { text: "Terrain Visualization Modes", link: "/features/visualization-modes" },
          { text: "Basemaps & Historical Imagery", link: "/features/basemaps-and-historical" },
          { text: "Bookmarks", link: "/features/bookmarks" },
          { text: "Bring Your Own Data", link: "/features/byod" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/Iconem/elevation-terrain-visualizer" },
    ],
    search: { provider: "local" },
  },
})
