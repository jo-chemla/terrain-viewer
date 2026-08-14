export const appName = 'Terrain Viewer';
// Doc pages live at the app's own root ("/getting-started", "/features/...",
// no "/docs" segment) — this whole app is ALREADY mounted at /docs/ via
// Next's basePath (see next.config.mjs) when deployed alongside the main
// app, so giving the docs section its own internal "/docs" too (the
// fumadocs default) produced a doubled "/docs/docs/..." URL. The (home)
// route group still owns the bare "/" for the marketing page — see
// src/app/[...slug]/page.tsx's REQUIRED (not optional) catch-all, which by
// construction never matches the empty path.
export const docsRoute = '/';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: 'Iconem',
  repo: 'terrain-viewer',
  branch: 'main',
};
