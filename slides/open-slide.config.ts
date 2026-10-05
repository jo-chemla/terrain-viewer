import type { OpenSlideConfig } from '@open-slide/core';

// SLIDES_BASE: the sub-path the built site is served from (the docs deploy
// publishes it at /docs/slides/); "/" for dev and local previews.
const openSlideConfig: OpenSlideConfig = {
  base: process.env.SLIDES_BASE ?? '/',
  // Off the app's 5173 (and the docs' 3100), so `pnpm dev:all` runs the three.
  port: 3200,
};

export default openSlideConfig;
