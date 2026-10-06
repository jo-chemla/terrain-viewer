---
name: docs-slides-video-tooling
description: Tooling the user rates for docs, slide decks and agent-made demo videos - what is in use (Fumadocs, open-slide, agent-browser) and the alternatives they liked (Nextra, Slidev, Lumae)
type: project
---

# Docs, slides and video tooling (2026-10-06)

In use: Fumadocs on Next.js for `docs/`, open-slide for `slides/` (published
static under `/docs/slides/` with PDFs by `slides/scripts/publish.mjs`),
agent-browser plus a CDP capture for demo videos (see [[agent-browser-recording]]).

Alternatives the user looked at and rated "look good" (keep in mind if either
tool is replaced; nothing planned):
- **Nextra** (Next.js, MDX docs theme, simpler than Fumadocs, fewer components).
- **Slidev** (Vue, Markdown decks, presenter view, PDF and static export built
  in, `slidev export`; not React, so the app's components cannot be embedded).

Demo recording with an agent: **Lumae** (lumae.app) is a free, closed-source
macOS-only screen recorder with a built-in MCP server (record, cut, zoom on the
cursor, captions, export; every edit an undo step). Not usable on the user's
Windows laptop; noted as the reference for what an agent-driven editor looks
like. A Windows open-source counterpart to check: Mas-inx/lumen-ai-video-editor.

**Why:** the user asked to note these choices so later tooling questions do not
restart from zero.

**How to apply:** when asked about docs or slides alternatives, start from this
list; do not propose migrating without being asked.
