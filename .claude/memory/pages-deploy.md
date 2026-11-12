---
name: pages-deploy
description: Why a Pages deploy can be refused for 30 minutes after the previous push, what the deploy job does about it (cancel, then poll), and the backend statuses seen
type: project
---

# GitHub Pages deploys: the "in progress deployment" refusal

A push to `main` runs `.github/workflows/deploy-gh-page-on-push.yml`: about 5 min
of build, then `actions/deploy-pages`. The concurrency group serialises runs,
but GitHub keeps the previous Pages deployment "in progress" for 20 minutes
and more after its files were synced (status `purging_cdn`), and refuses a
new one meanwhile with `Deployment request failed for <sha> due to in progress
deployment. Please cancel <other sha> first or wait for it to complete`
(HTTP 400). Two pushes a few minutes apart made the second one wait up to
half an hour on fixed sleeps (150 s, 600 s, 1200 s, until 2026-11-04).

**Since 2026-11-04** the deploy job runs `.github/scripts/pages-deployments.sh`:
`cancel` before the first deploy attempt (cancels every previous deployment
still in progress, `POST /repos/{o}/{r}/pages/deployments/{sha}/cancel`), and
`wait` after a refused attempt (cancels again, then polls
`GET .../pages/deployments/{sha}` every 30 s until nothing is in progress, up
to TIMEOUT). Only the newest build matters, so cancelling is fine. The job
needs `actions: read` (it lists this workflow's runs to find the candidate
shas: a Pages deployment is named by its commit sha and there is no list
endpoint).

**Seen on 2026-11-12** (three failed Iconem deploys, none on jo-chemla): the
sha named by the refusal reported `succeed` on the status endpoint, and
`POST .../cancel` answered 400 "Unable to cancel deployment ... as it's
finished", while the backend kept refusing new deployments for 26 minutes
after that sha's own "Reported success!" (free again 4 minutes later: a
rerun of the failed job passed). So `wait` found "no previous deployment in
progress after 4s" and the three retries 5 s apart failed three times. A
refused attempt also leaves a ghost: cd851b1, whose every attempt was
refused at 21:21, showed as `purging_cdn` at 21:43 and was cancelled. Since
2026-11-12 `wait` takes `MIN_WAIT` (a floor on the wait even when nothing
is in progress), the deploy job retries three times on a 3, 7 then 15 minute
backoff, and the concurrency group has `cancel-in-progress: true`, so a push
during a run cancels it: fewer deployments, fewer refusals. Two pushes a few
seconds apart (a commit and its fix-up) were the usual trigger.

**Statuses seen** on `GET .../pages/deployments/{sha}`: `deployment_in_progress`,
`syncing_files`, `succeed`, `purging_cdn`, `""` (older deployments the backend
no longer reports on), 404 for a sha never deployed. `succeed` can show
before `purging_cdn`; a deployment in `purging_cdn` did not block a new one
on 2026-11-04 09:40, so what exactly blocks is still unclear.

**The artifact** was 545 MB unpacked on 2026-11-04, 495 MB of it `docs/`, with
the screenshots in it three times: `docs/screenshots` (docs/public, 172 MB),
Next's `_next/static/media` (84 MB, the remark-image plugin's imports) and
the slides' `slides/assets` (72 MB, Vite's copies of `@assets` imports).
Since 2026-11-04 the docs keep the public path (`remarkImageOptions:
{ useImport: false }` in `docs/source.config.ts`, the basePath added by the
`img` component in `docs/src/components/mdx.tsx`) and the decks use
`shot('...')` from `slides/assets/shots.ts` (`/docs/screenshots/...`, proxied
in dev by `slides/scripts/dev.mjs`, served by `slides/scripts/publish.mjs`),
which leaves one copy. Still large: 45 jpg screenshots are 4K at a high
quality (about 97 MB; a webp or avif conversion is a later option, the 4K
originals stay for now) and the five slide PDFs are 86 MB.
`slides/scripts/check-images.mjs` opens every docs page and deck in Chrome
and lists the image requests that fail. Whether the artifact size makes the
purge slow is unproven.
