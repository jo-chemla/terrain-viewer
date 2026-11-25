---
name: changelog-style
description: How the user wants CHANGELOG.md entries written - one entry per day, a TL;DR of 3 to 5 plain bullets always, repeats folded, details under a second heading, a released marker
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

## The released marker, and TL;DRs for end users

Every entry carries `<!-- released: YYYY-MM-DDTHH:MM -->` right under its
heading (the commit's date and time; the time keeps same-day entries distinct
and ordered). Settings > What's new keys entries on it: without it an entry
never shows as new, and two alike collide. Eleven agent entries of
2026-11-24/25 went out without one; `lib/changelog.test.ts` (run by the deploy
workflow: `node scripts/test-lib.mjs lib/changelog.test.ts`) now fails on a
missing or duplicate marker, or an entry out of newest-first order.

The TL;DR is read by end users in the app: short, plain words, no file names,
URL parameters, internal ids, endpoints or measurements; that prose goes under
Details, which the app never shows.

## One entry per day, always with a TL;DR

**Same-day work goes into ONE entry** (the user has asked several times; on
2026-11-25 they had nine agent entries for two days merged into two). Before
adding an entry, look at the top one: if it is from today, fold your change into
its TL;DR (rewording, still 3 to 5 bullets in all) and append your prose to its
Details under a `##### <topic>` sub-heading; keep its marker, or move it to your
commit time. Never add a second entry for the same day. Every entry has a
TL;DR (a dependency bump or API change folds into the day's entry, or goes only
under its Details). Parallel agents: one agent (or the parent) owns the day's
entry; the others report a one-line summary instead of editing CHANGELOG.md.

**Why:** "when multiple features are the same day, merge them and be concise,
and always include the TL;DRs for the changelog surfaced to our clients through
the app" (user, 2026-11-25).

QGIS plugin changes (2026-11-25, user ask): within the day's entry, every QGIS bullet goes in one "##### QGIS Plugins" group under Details, newest version first, never scattered across other groups; the TL;DR keeps one QGIS bullet.
