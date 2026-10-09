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

## Measured on 2026-10-09 (.cache/pw/umami-embed-probe.mjs, headless on prod)

- The wrapper app.heritagewatch.ai/?app=terrain-viewer loads the app once
  (1 pageview, app-embed, app-mode), nothing more over 40 s idle, nothing
  on five camera drags (the wrapper mirrors lat/lng into its URL with
  replaceState; it runs Vercel Analytics, not Umami). A theme toggle
  remounts the iframe: one more load. So the wrapper is not a loop.
- The docs: 1 pageview per page, 0 on scrolling, 1 per link navigation.
- The app: 20 hash-only history calls gave 20 pageviews, so
  `data-exclude-hash` was added to both loaders (the app writes no hash;
  the docs headings are hash links).

## The Oct 2-3 spike, found (2026-10-09, from the CSV exports)

Jonathan exported the data (Umami Cloud, Settings, Export; two zips with
website_event.csv, event_data.csv). `scripts/umami-export-analyze.mjs <dir>
[days]` lists pageviews per day and the top sessions of given days.

- **One session: 18,100 pageviews on Oct 2-3**, then 1,362 and 857 more on
  Oct 8, all with hostname **localhost**, Chrome on Mac OS, a 3440x1440
  screen, Kansas City (US), no referrer, no custom event at all, every
  pageview carrying the full nuqs query string (zoom, lat, lng, a
  `sourceA=custom-...` terrain of their own) over the Wyoming-Colorado
  border and Zermatt.
- So: **someone runs an old clone of the repo locally** (a build from
  before 2026-09-25, when the tracker was a static tag with no localhost
  guard and no `data-exclude-search`): every pan is a pageview sent to our
  website id, which is public in index.html. Since Sept 26, 22,284 of the
  query-carrying pageviews came from localhost and 10 from the real site.
- Not bots, not the toolbox, not the desktop app, not us. Their clone
  predates lib/analytics.ts (2026-07-23: no custom event at all) and the
  localhost guard on the tracker (2026-07-27), so it is three months old; their two custom terrain sources were created on 2026-10-01
  (12:37 and 12:39 UTC, the ids are Date.now()) and their definitions
  live in their localStorage only. The location comes from Umami's own
  IP geolocation (US-MO, Kansas City): an ISP's point of presence or a
  VPN as likely as a desk. No public fork of either repo is from there
  (Harrydtt, pr116, fabiodr, luothink, link1412, none pushed since
  August): a plain clone.
- Both trackers now also carry `data-domains` (the real hostnames plus
  "app" for the desktop), so any future clone or fork of a current build
  stays silent wherever it runs. Hiding the website id in a GitHub secret
  gains nothing: the browser must send to it, so it is in the shipped HTML.
- **What stops it:** only a new website id (Umami: add a website, swap the
  id in index.html and docs/src/app/layout.tsx, delete the old website so
  its events are refused and no longer count on the account's quota). The
  dashboard history before the swap is lost (the exports keep it). The
  tags and the hash/search exclusions do nothing for an old build.

## Tags (since 2026-10-09)

The app loader sets `data-tag`: "desktop" when the protocol is not http(s)
(Electrobun serves views://app/), "embed" when iframed, "web" otherwise.
Umami's dashboard filters by tag (the Filter button). The API key needs
the Pro plan (confirmed 2026-10-09); Jonathan exports the data by hand.

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
