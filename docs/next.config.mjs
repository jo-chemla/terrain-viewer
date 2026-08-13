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
  // This app has its own pnpm-lock.yaml (deliberately standalone from the
  // main app's, since Next 16/React 19 here would otherwise fight the root
  // app's React 18/Vite toolchain) — without this, Turbopack sees both
  // lockfiles and warns/guesses at a shared workspace root.
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
};

export default withMDX(config);
