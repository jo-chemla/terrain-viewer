# Terrain Viewer — marketing + docs site

Marketing homepage + documentation for the [main app](../README.md), built with [Fumadocs](https://fumadocs.dev) on Next.js. Deployed as a static export under `/docs/` alongside the main app — see `../.github/workflows/deploy-gh-page-on-push.yml`.

A standalone project (own `package.json`/lockfile/`node_modules` — Next 16 + React 19 here, vs. the main app's Vite + React 18), run from the repo root via `pnpm run docs:dev` / `docs:build` / `docs:preview` (fixed port 3100; the main app's own `pnpm dev` proxies `/docs` to it, see `../vite.config.ts`).

Content lives in `content/docs/*.mdx`; the marketing homepage is `src/app/(home)/page.tsx`.

---

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

It is a Next.js app with [Static Export](https://nextjs.org/docs/app/guides/static-exports) configured.

Run development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

Open http://localhost:3000 with your browser to see the result (note: this repo pins the dev server to port 3100 instead — see package.json).

## Explore

In the project, you can see:

- `lib/source.ts`: Code for content source adapter, [`loader()`](https://fumadocs.dev/docs/headless/source-api) provides the interface to access your content.
- `lib/layout.shared.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/search/route.ts` | The Route Handler for search.                          |

### Fumadocs MDX

Collections are defined with the [Macro API](https://fumadocs.dev/docs/mdx/macro) in `lib/source.ts`.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.dev) - learn about Fumadocs
