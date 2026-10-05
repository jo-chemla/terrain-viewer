import type { OpenSlideConfig } from '@open-slide/core';

// SLIDES_BASE: the sub-path the built site is served from (the docs deploy
// publishes it at /docs/slides/); "/" for dev and local previews.
const openSlideConfig: OpenSlideConfig = {
  base: process.env.SLIDES_BASE ?? '/',
};

export default openSlideConfig;
