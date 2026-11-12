---
name: ux-flows-capture-theme
description: The ux-flows-latest screenshots (2026-10-16) show a non-default theme and font; the next recapture must use the default theme AND the default font
type: project
---

# UX flows screenshots: default theme and font on the next recapture

Jonathan noted on 2026-11-12 that the /ux-flows screenshots from the `ux-flows-latest` release (captured 2026-10-16 by `.github/workflows/ux-flows-capture.yml`) use a weird theme and seem to miss the Geist or theme font. The capture (`ux-flows/scripts/capture.mjs`) clears local storage before each screen, so the theme is whatever the default was that day, and the font most likely never loaded on the runner before the fixed settle.

**Why:** the page is meant to show the app as a user sees it on first visit, so a stray theme or a fallback font misrepresents it.

**How to apply:** when redoing these screens, make sure every capture uses the default theme AND the default font (check the font has loaded before the screenshot, for instance `document.fonts.ready`, and compare one capture against the live app before publishing the release). No recapture was asked for on 2026-11-12.
