// The docs site's screenshots (docs/public/screenshots), by URL rather than
// imported: the published decks sit next to the docs under /docs/, where
// the files already are (an import would make Vite emit a hashed copy of
// each, 72 MB more in the site artifact). In dev, scripts/dev.mjs proxies
// /docs/screenshots/ to the docs server; the static site of
// scripts/publish.mjs serves the folder itself. A deck published elsewhere
// sets VITE_SCREENSHOTS_BASE to the full URL of the folder, e.g.
// https://terrain-viewer.iconem.com/docs/screenshots/.
const base: string = import.meta.env.VITE_SCREENSHOTS_BASE ?? '/docs/screenshots/';

export const shot = (path: string) => `${base}${path}`;
