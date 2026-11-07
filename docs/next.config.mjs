import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath } from 'url';

const withMDX = createMDX();

// Deployed under /docs/ alongside the main app (see
// .github/workflows/deploy-gh-page-on-push.yml, which builds this as a
// static export and merges it into the main app's own dist/docs) — same
// URL convention the previous VitePress site used, and what
// components/TerrainControlPanel/settings-dialog.tsx's docs link
// ("docs/", relative) already assumes. basePath/assetPrefix must always be
// set (not just in prod) since `next dev` here is also always reached via
// the root Vite dev server's own /docs proxy (see vite.config.ts) at that
// same path.
/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  basePath: '/docs',
  trailingSlash: true,
  images: { unoptimized: true },
  // The main app's own Vite dev server proxies /docs here (see
  // vite.config.ts) — so in dev, requests for this app's own JS/CSS chunks
  // actually arrive at Next's dev server via that proxy, with an Origin
  // header of the MAIN app's origin (127.0.0.1:5173/5174/etc, not this
  // server's own port). Next's dev server blocks that by default (a CSRF-
  // style protection); without this, every script silently 404s, hydration
  // never completes, and every client-interactive widget (theme toggle,
  // search, collapsible sidebar sections) looks present but dead.
  // The private-network ranges too, so the docs work when opened from a
  // phone on the same network (http://<LAN IP>:5173/docs/): otherwise the
  // same silent block leaves every page dead on mobile.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.*.*', '10.*.*.*', '172.*.*.*'],
  // docs/ is a package of the root pnpm workspace (one lockfile, one install;
  // pnpm keeps its React 19 / Next 16 apart from the app's React 18 / Vite).
  // Its node_modules are symlinks into the root node_modules/.pnpm store, so
  // Turbopack's root must be the repository root, or every dependency
  // resolves to a file "outside the project root".
  turbopack: { root: fileURLToPath(new URL('..', import.meta.url)) },
};

export default withMDX(config);
