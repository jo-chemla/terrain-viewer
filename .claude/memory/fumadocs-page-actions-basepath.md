---
name: fumadocs-page-actions-basepath
description: Fumadocs' stock page actions (Copy Markdown, Open in ...) handle Next's basePath since Next 16.3 (Turbopack's import.meta.env.BASE_URL); never pre-prefix markdownUrl, and do not file the "withBasePath is Vite-only" bug
type: project
---

**Fact (2026-10-14).** fumadocs-ui's `withBasePath` reads `import.meta.env.BASE_URL`.
Under Next that is not Vite-only: Turbopack derives `BASE_URL` from `basePath`
since Next 16.3 (vercel/next.js#96225, merged 2026-07-28, in 16.3.0 of 2026-08-03).
Verified by clicking the stock `MarkdownCopyButton` and `ViewOptionsPopover` on a
static export (fumadocs-ui 16.17.3, Next 16.3.7) in headless Chrome: the fetch
and the links carry `/docs` once; the popover is not server-rendered, so the
`usePathname` server branch never shows.

**Why:** the docs carried a copy of the popover and a pre-prefixed `markdownUrl`
from 2026-08-20 (written against Next 16.3.0, five days after the bump: the
bug it fixed was already gone, or seen on an older Next). After the Next bump
the pre-prefix doubled to `/docs/docs/llms.mdx/...` on the Copy Markdown fetch.
The upstream bug report drafted on 2026-10-13 was withdrawn.

**How to apply:** pass `getPageMarkdownUrl(page).url` as is to the stock buttons;
when a Fumadocs base-path bug seems to appear, click the stock component on an
export first (`.cache/pa-test-export.sh` pattern: patch `window.fetch`, click,
read the URLs) before writing a workaround. See also [[fumadocs-studio]].
