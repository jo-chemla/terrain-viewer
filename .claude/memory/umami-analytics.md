---
name: umami-analytics
description: Umami Cloud analytics for the app and docs (one website id, dashboard URL, 100k events a month on the free plan, pageviews and custom events both count), the September 2026 quota overrun, the October 2026 numbers and the two-day pageview spike, what to check and what to trim if it recurs.
type: project
---

# Umami analytics (state on 2026-10-09)

- Dashboard: https://cloud.umami.is/analytics/eu/websites/89d911b9-9de7-4665-872e-5b91ff4b7b39
  (account jchemla@iconem.com, EU region). One website id for the app
  (`index.html`, not loaded on localhost), the docs
  (`docs/src/app/layout.tsx`) and historical-satellite.iconem.com.
- **Quota**: the free Cloud plan counts **100,000 events a month, pageviews
  and custom events together**, then answers 429 and records nothing until
  the next month. September 2026 ran out (every nuqs query rewrite counted
  as a pageview until `data-exclude-search` on 2026-09-25). On 2026-10-09
  the mail said 55,500 of 100,000 used.
- October 2026 so far: 732 visitors, 1.0k visits, 24.1k pageviews, 11.7k
  custom events, 33 event names. Pageviews are two thirds of the spend.
  **Oct 2 and 3 alone hold about 18k pageviews from a visitor count that
  did not move**, so one or a few sessions produced thousands of path
  changes: an embedder remounting the iframe (app.heritagewatch.ai and
  expertises-territoires.fr embed it; each iframe load is a pageview and an
  `app-embed` event), a crawler that runs JavaScript, or our own headless
  checks against prod (`.cache/pw/umami-*.mjs` fire pageviews too). Umami's
  Sessions page sorted by views names the session; the Events page's
  Properties tab gives `app-embed`'s embedder counts.
- The mail's 55.5k against the dashboard's 36k: the quota is per account,
  so other websites on it (if any) count, and the billing month may not be
  the calendar month shown.
- Channels this month: Direct 65 %, organic search 13 %, referral 11 %, LLM
  7 % (chatgpt.com 54 visitors, second referrer after google.com), social
  5 %. Docs pages are 17 % of views; the app root 83 %.

## If the quota keeps getting close

1. Find the spike's session first (above); a bot or an embedder loop is
   fixed at the source, not by trimming events.
2. Custom events are a third of the spend and the only usage signal
   (`lib/analytics.ts`: one event per intentional action, never per render);
   keep them. If trimming is needed, drop the noisiest names (the Events
   page lists counts per name) or sample them per session, not the
   referrer/channel data, which costs nothing extra (it rides on the first
   pageview).
3. Last resort: `data-auto-track="false"` on the tracker and one manual
   pageview per load, so docs navigation stops counting per page.
