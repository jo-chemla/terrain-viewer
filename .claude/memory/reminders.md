---
name: reminders
description: Things the user asked to be reminded of at the start of a session - check the dates and bring them up
type: feedback
---

# Reminders (bring up at the start of a session, then prune)

- **Upstream requests**, checked against GitHub on 2026-11-13: everything on
  the docs page (docs/content/docs/dev/upstream-requests.mdx) is posted
  except three: the follow-up comment on maplibre-contour issue 434 (no
  comment there yet), the Allmaps "plain images as a resource" request (no
  issue on allmaps/allmaps), and the Planet browser OAuth client post
  (community forum, cannot be checked from here; ask Jonathan). Mapterhorn
  issue 27 was commented 2026-10-29. The impasto CORS request is "not to be
  sent yet" by his choice. Check with `gh search issues --author jo-chemla
  --repo <repo>` before reminding again.
- Open since 2026-10-09: **backlinks** have no API; ask Jonathan for a
  manual export of the Search Console Links report when they matter.
- **Umami website swap**, when Jonathan decides: a NEW Umami website id, because
  someone's old clone on localhost still sends events with the current id
  and eats the 100k monthly quota (see [[umami-analytics]]). The id goes
  into `VITE_UMAMI_WEBSITE_ID` (.env and the ENV_FILE_CONTENT secret, which
  only he edits), then the old website is deleted. Not about dropping the historical
  host.
- Done, do not raise again: the historical host is a Search Console property
  (both hosts answer scripts/search-console.mjs, 2026-11-13); the demo
  re-cut (video/src/Demo3.tsx, takes up to basic-modes-v8 on the
  `demo-takes` release).

**Why:** the user asked "remind me about this next time and tomorrow".
**How to apply:** mention open reminders in the first reply of a session;
remove them once done.
