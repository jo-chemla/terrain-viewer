---
name: git-remotes
description: main lives in two GitHub repos (jo-chemla and Iconem) and every push to main must land in both
type: project
---

# Two GitHub homes for main

The project is mirrored at https://github.com/jo-chemla/terrain-viewer (prod GitHub Pages, fetch remote) and https://github.com/Iconem/terrain-viewer. The user wants every push to `main` to land in both.

**How to apply:** `origin` carries two push URLs (`git remote set-url --add --push origin <url>` for each, since adding one replaces the default), so a plain `git push origin HEAD:main` updates both. Check with `git remote -v`; if only one push URL shows, add both again. Never force-push either.
