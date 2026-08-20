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
// The Next basePath this whole app is mounted under (next.config.mjs) —
// needed wherever a URL leaves the Next router's own <Link>/redirect
// machinery (which prefixes it automatically) and gets handed to the
// outside world as a plain string instead: the page-actions "Open in
// ChatGPT/Claude" prompt URLs and the raw content.md links (see
// src/components/page-actions.tsx). fumadocs-ui's own ViewOptionsPopover
// builds those from usePathname(), which EXCLUDES basePath in Next — that
// shipped "Open in X" prompts pointing at terrain-viewer.iconem.com/changelog
// instead of /docs/changelog.
export const docsBasePath = '/docs';

export const gitConfig = {
  user: 'Iconem',
  repo: 'terrain-viewer',
  branch: 'main',
};
