import type { OpenSlideConfig } from '@open-slide/core';

// SLIDES_BASE: the sub-path the site is served from. The docs deploy
// publishes the build at /docs/slides/, and the dev server runs there too,
// so the app's Vite server can proxy /docs/slides/ to the live editor
// (vite.config.ts); "/" only when asked for.
const openSlideConfig: OpenSlideConfig = {
  base: process.env.SLIDES_BASE ?? '/docs/slides/',
  // Off the app's 5173 (and the docs' 3100), so `pnpm dev:all` runs the three.
  port: 3200,
};

export default openSlideConfig;
