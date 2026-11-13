---
name: search-performance
description: What Search Console and Bing say (reading of 2026-11-13) and what was changed for it - timelapse page retitled and canonical on the historical host, OpenInApp buttons, sun calculator links and JSON-LD, IndexNow on deploy, nofollow on app deep links; the docs page to update at the next reading
type: project
---

# Search performance (2026-11-13)

Readings live in `docs/content/docs/dev/search-performance.mdx`: add a dated
section on top at each new reading (`node scripts/search-console.mjs [--site
https://historical-satellite.iconem.com/] [--days 90 --json out.json]`,
`node scripts/bing-webmaster.mjs`). Both hosts are Search Console properties.

- 28 days to 2026-11-11: main host 373 clicks / 8 025 impressions, historical
  194 / 7 732. Brand query position 1. The historical host lives on one page,
  `dev/google-timelapse` (157 clicks, "google earth timelapse").
- **Canonical rule** (Jonathan: one build for both hosts, no repo env): a
  page's canonical is a property of the page. All docs pages name
  terrain-viewer.iconem.com except those in `HISTORICAL_HOST_PAGES`
  (`docs/src/app/[...slug]/page.tsx`), which name the historical host on
  both copies. Add a page there only when Search Console shows the
  historical host ranking for it.
- `<OpenInApp href="/?...">label</OpenInApp>` (docs/src/components/open-in-app.tsx)
  is the button from a docs page into the app; root-relative so it works on
  both hosts. Markdown links starting with `/?` are plain anchors, new tab,
  nofollow (mdx.tsx). Jonathan wants app links wherever they make sense.
- A link to a catalog layer of a regional series (a Timelapse year) is
  `timelineCatalogs=cat-nat-gtimelapse&overlayBasemapIds=custom-basemap-cat-cat-nat-gtimelapse--gtl-<year>`;
  `resolveCatalogSourceId` rebuilds it on load since 2026-11-13 (before, the
  link opened on the basemap).
- IndexNow: key file `public/88c943f2620c29830b70a0e3a57f22bc.txt`, last step
  of the deploy (`.github/scripts/indexnow.sh`), changed pages only.
- Sun calculator (`public/sun-position-estimator.html`): canonical, JSON-LD,
  sitemap entry, links from index.html's static shell and three docs pages.
- Open ideas: give the Esri Wayback dev page the timelapse treatment; name
  countries in the National Datasets title; Bing needs inbound links.
