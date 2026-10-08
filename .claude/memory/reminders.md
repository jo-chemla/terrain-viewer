---
name: reminders
description: Things the user asked to be reminded of at the start of a session - check the dates and bring them up
type: feedback
---

# Reminders (bring up at the start of a session, then prune)

- Set 2026-10-07, for the next session and again on 2026-10-08: the
  **Upstream requests** page, http://localhost:5204/docs/dev/upstream-requests/
  (four drafted requests to Allmaps, Electrobun and Planet, and the earlier
  items). The user posts them; when posted, update the status column.
- Set 2026-10-07: **Google Search Console API access** needs a service
  account: create one in Google Cloud, enable the Search Console API, add the
  service account's e-mail as a user on the property, save the JSON key and
  put its path in `.env` as `GOOGLE_SEARCH_CONSOLE_KEY_FILE`. Bing is done
  (`BING_WEBMASTER_API_KEY` in `.env`).
- Set 2026-10-08, for 2026-10-09: **the Google connection**. Once the
  service account key is in `.env`, the agent (not the user) pulls the
  Search Console data itself: queries, pages, and the **backlinks** (the
  Links report has no API; use the Search Console `sites`/`searchanalytics`
  endpoints for queries and pages, and for backlinks the Bing API we have
  plus a manual export of the Search Console Links report), and writes the
  findings on the dev indexing page. (The dev servers were started again
  on 2026-10-08 after the Windows-update restart.)

**Why:** the user asked "remind me about this next time and tomorrow".
**How to apply:** mention open reminders in the first reply of a session;
remove them once done.
