---
name: history-rewrite-2026-11-13
description: The git history was rewritten on 2026-11-13 to drop 450 MB of old media; how to keep heavy files out for good, and what an old clone must do
type: project
---

On 2026-11-13 (Jonathan's go) the history of both remotes was rewritten with
git-filter-repo `--strip-blobs-with-ids`: 457 media blobs that were no longer
in main's tree (old docs screenshots, coverage footprints, VRT indexes,
posted-on-twitter pictures, earlier versions of README and bookmark pictures).
No code blob was touched; main's final tree was byte-identical before and
after, 1131 commits kept. A fresh clone went from 464 MiB to 15 MB.
jo-chemla was pushed first as a trial (all 13 branches), Iconem the same day
(main, its 8 branches and its 9 release tags, moved to the rewritten commits;
releases stay attached by tag name, winget's desktop-v2026.11.12 asset still
downloads). Short hashes in CHANGELOG.md and these memory notes were remapped
through filter-repo's commit-map (161 of them); 6 never existed on main
(pre-squash branch commits) and were left as they were.

**Rules so it never comes back** (a blob, once pushed, is in every clone forever):
- Heavy media never goes in git. Docs screenshots: docs-media release
  (`pnpm docs:media:push`, commit docs/media.lock). VRTs and coverage
  footprints: dataset-indexes release (`pnpm datasets:push`, commit
  datasets.lock.json). Videos: demo-takes. Decks: slides-<date>. Tweets and
  one-off pictures: a zip on docs-media. See docs/content/docs/dev/releases.mdx.
- A picture that must be tracked (README, bookmark thumbnails, the og image)
  is recompressed first: at most 600 KB, 1600-1920 px wide.
- `node scripts/check-media.mjs` enforces it: forbidden folders, 600 KB per
  media file, 8 MB of media in total. The deploy workflow runs it on every
  push and fails the deploy. Run it before committing pictures.
- Before `git add -A`, look at `git status` for new binaries; never commit
  docs/public/screenshots, public/vrt, public/coverage/*.geojson (ignored).

**Old clones and branches**: a clone or worktree made before the rewrite holds
the old history. Never push from one: `git push origin main` goes to both
remotes and would re-add the old commits. Fetch with `--force` and
`git reset --hard origin/<branch>` (no local commits), or re-clone. Local
branches with unpushed work on the old history need `git rebase --onto` the
rewritten commit (map: filter-repo's commit-map, or find the same tree).
Left on the old history in Jonathan's main checkout on 2026-11-13, for him to
clean up: t3/annotation-canvas-synopsis-json, t3/dura-replace-mounds-with-relief-viz-modes
(worktree), t3/upstream-drafts-and-left-items, t3code/moon-lola-terrain-explore,
t3code/read-handoff-continue-work. GitHub keeps the old objects under
refs/pull/* until support runs a cleanup; clones do not fetch those.

**Why:** a clone had grown to 464 MiB, 97 % of it pictures nobody used any more.
**How to apply:** check sizes before committing media; run check-media; push
heavy files to a release.
