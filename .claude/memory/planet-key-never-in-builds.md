---
name: planet-key-never-in-builds
description: The Planet API key (PLAK…) must never reach a build, the public sites, the desktop bundles or the GitHub secrets; the three guards and the 2026-10 leak that motivated them
type: project
---

The Planet API key must never reach a build, local or CI, nor the public
sites, the desktop bundles, or the `ENV_FILE_CONTENT` GitHub secret. Users
paste their own key into Settings (`planetKeyAtom`, localStorage).

**Why:** on 2026-10-09 the deploy and desktop workflows began writing `.env`
from the `ENV_FILE_CONTENT` secret, which was a copy of the local `.env`
with `VITE_PLANET_API_KEY`. Every Pages deploy from 2026-10-10 to 2026-11-03
shipped the key in the public JS bundle (all three sites), and Planet usage
under the owner's account spiked (42 756 tiles on 2026-10-10 alone). Planet
reset the key on 2026-11-04. The secret still holds the dead key, which is
fine; a new key must never be put in it.

**How to apply:** three guards, keep all three:
1. `vite.config.ts` plugin `planet-key-out-of-builds` blanks
   `process.env.VITE_PLANET_API_KEY` in its `config()` hook for builds
   (process env beats every `.env*` file). Dev server keeps the key.
2. `scripts/check-no-planet-key.mjs` runs at the end of `pnpm build` and
   fails on any `PLAK[0-9a-zA-Z]{10,}` in `dist/`. Local builds included.
3. Both workflows `sed` the key out of the written `.env` and grep `dist/`
   again after the docs merge.
Never add a `VITE_PLANET_*` read outside `planetKeyAtom`, never put the key
in a workflow, secret, Tauri/Electrobun config or test fixture. When
re-setting `ENV_FILE_CONTENT`, pipe `.env` through
`grep -v '^VITE_PLANET_API_KEY='` first. Never print the local key in full.
