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

**Statuses seen** on `GET .../pages/deployments/{sha}`: `deployment_in_progress`,
`syncing_files`, `succeed`, `purging_cdn`, `""` (older deployments the backend
no longer reports on), 404 for a sha never deployed. `succeed` can show
before `purging_cdn`; a deployment in `purging_cdn` did not block a new one
on 2026-11-04 09:40, so what exactly blocks is still unclear.

**The artifact** (545 MB unpacked, 2026-11-04) is 495 MB of `docs/`: the
screenshots are in it three times (`docs/screenshots` 172 MB, Next's
`_next/static/media` 84 MB, the slides' `slides/assets` 72 MB), 45 jpg
screenshots over 1.5 MB are 4K at a high quality (about 97 MB, a quarter of
that at 2560 px and quality 82), and the five slide PDFs are 86 MB.
Whether the artifact size makes the purge slow is unproven.
