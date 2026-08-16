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
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // This app has its own pnpm-lock.yaml (deliberately standalone from the
  // main app's, since Next 16/React 19 here would otherwise fight the root
  // app's React 18/Vite toolchain) — without this, Turbopack sees both
  // lockfiles and warns/guesses at a shared workspace root.
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
};

export default withMDX(config);
