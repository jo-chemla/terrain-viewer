---
name: changelog-style
description: How the user wants CHANGELOG.md entries written - a TL;DR of 3 to 5 bullets at most, repeats folded, details under a second heading, a link and one picture when a feature has a page
type: feedback
---

# Changelog entries: 3 to 5 bullets, always

The `#### TL;DR` list of a changelog entry holds **3 to 5 bullets at most**.
A later patch to something already in the list is folded into its bullet,
never appended as a new one (the 2026-10-05 weekend entry had grown to about
sixty bullets with "Timeline overlay pills" three times; folded on
2026-10-08). Everything else goes under `#### Details`, itself short. When a
feature has a docs page, the bullet links it and carries one picture
(`/docs/screenshots/...`, as the other entries do).

**Why:** the user asked on 2026-10-08: "fold all repeats, I want the changelog
entries to always be very concise, 3-5 items at most." The TL;DR is what the
app's What's New and the docs changelog page show.

**How to apply:** when adding to the current entry, re-read its TL;DR first
and fold; when a sixth bullet would be needed, start a new entry or move
items to Details.
