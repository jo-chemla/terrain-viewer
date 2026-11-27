---
name: atproto-view-sharing
description: Saved views as AT Protocol records behind ?view=at/<did>/<rkey> (beta flag, 2026-11-27 prototype): browser-only OAuth, what was verified live (CORS, blobs, CDN, lifetimes), per-host client metadata, what is untested
type: project
---

Prototype on `feat/atproto-view-sharing` (2026-11-27). No server of ours.

- **Files**: `lib/view-sharing.ts` is the one door (`signIn`, `signOut`, `session`, `saveView`, `loadView`). `lib/atproto-view.ts` has no dependency: reference parser, record builder, the public read (plain fetch), the per-host client config. `lib/atproto-oauth.ts` is the only importer of `@atcute/oauth-browser-client` and is always loaded by dynamic import (chunk 39.7 kB, 13.8 kB gzip; nothing in `main`). UI: `components/TerrainControlPanel/SavedViewPanel.tsx` (React.lazy from the Share dialog), flag `atprotoBetaEnabledAtom` (Settings > Beta, local, default off). `src/main.tsx` `settleArrival()` runs before React and nuqs.
- **A link opens for everyone**, flag or not: handle → DID (public.api.bsky.app, then DoH), DID → PDS (plc.directory or did:web), `com.atproto.repo.getRecord` on that PDS, then `history.replaceState` to the full query string. The short form does not stay in the address bar: nuqs owns the query string and rewrites the whole state on the first change.
- **Record** `com.iconem.terrainviewer.view`: `params` is the query string key by key, values as strings (the atproto data model has no floats). Credential-named keys dropped, credentials inside source URLs masked, on write and again on read.
- **Client metadata**: `public/atproto/<host>.json`, one per deployed host, both in every build; the page picks the one named after its own hostname. No SITE_MODE coupling. A new host needs a file and an entry in `OAUTH_CLIENT_HOSTS` (a test compares the files with the code). Dev is the loopback client: the page must be on `http://127.0.0.1:<port>`, not `localhost`.
- **Verified live 2026-11-27**: getRecord and getBlob answer `Access-Control-Allow-Origin: *` on bsky.network hosts and on 11 other PDS hosts (reference PDS, blacksky's rsky, others). getBlob comes with `Content-Disposition: attachment`, `CSP: default-src 'none'; sandbox`, the right image content type. `cdn.bsky.app/img/feed_thumbnail/plain/<did>/<cid>@jpeg` served blobs of a non-Bluesky collection on 10 of 11 hosts (undocumented, could change). Reference server lifetimes: public client 2 weeks (session and refresh), confidential 2 years / 3 months.
- **Not tested**: a completed sign-in and a real save (no credentials here: PAR and the bsky.social authorize page were reached, and the cancel path back). The granular scope `repo:<nsid> blob:image/*` was accepted by bsky.social's PAR; an old self-hosted PDS may refuse it.
- **Traps**: the library only returns its `state` on success, so the return address is kept in localStorage (`tv-atproto-return-to`, 30 min). Start vite with `--host 127.0.0.1` for sign-in tests.
