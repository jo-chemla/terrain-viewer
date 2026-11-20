---
name: mcp-apps-plan
description: Terrain Viewer MCP server in mcp/ (five tools, an MCP Apps view with a picture fallback); what Claude allows for framed sites, what was tested in Claude Desktop on 2026-11-19, what is left (public host, claude.ai, ChatGPT)
type: project
---

# Terrain Viewer as an MCP App

`mcp/` (standalone pnpm root, see its README). Tools: `open_view` (MCP Apps
view), `geocode` (Nominatim), `datasets_covering`, `catalog_items`,
`screenshot` (playwright-core driving an installed Chrome, or `CHROME_PATH`).
Server `instructions` tell the model the order (geocode, optionally
datasets_covering, open_view) and which modes fit which subject.

## Facts found the hard way

- **Claude blocks framed websites for local servers, always.** A remote
  custom connector may frame one only after the user allows the origin, for a
  limited set of organizations, in the unified Chat and Cowork experience; a
  directory connector only under a Verified listing. Source:
  claude.com/docs/connectors/building/mcp-apps/embedded-sites. A refused frame
  paints white and nothing tells the page. So `view.html` frames the app only
  when `app.getHostCapabilities().sandbox.csp.frameDomains` lists the origin;
  otherwise it calls the `screenshot` tool (`app.callServerTool`) and shows
  the picture. Host says nothing: picture plus a "Try the live view" button.
- For a remote connector the site must allow framing: `ui.domain` on the
  resource (sha256 of the server URL, first 32 hex, `.claudemcpcontent.com`)
  and `frame-ancestors` for that host and `https://claude.ai`. GitHub Pages
  sends no such header today, so everyone may frame it.
- ext-apps 2.0.4 pairs with the v2 split SDK (`@modelcontextprotocol/server`,
  `/node`, `/client`), not `@modelcontextprotocol/sdk`. The sandbox blocks
  network scripts: `server.mjs` inlines `ext-apps/app-with-deps` in the page.
- `catalog_items` runs the app's own `loadCatalogTicks`: `mcp/build.mjs`
  bundles `mcp/app-lib.ts` with esbuild into `mcp/generated/` (not tracked),
  `import.meta.env` defined empty so no key can enter; Planet answers nothing
  there, by design. It needs the root `node_modules`.
- The app in a frame with no origin (sandbox without allow-same-origin):
  `new Worker(url)` throws, module workers from a blob too. `index.html`'s
  first script swaps storage for memory and starts workers through a blob
  (`importScripts`) or a `data:` URL (`import`). Verified on the live build
  through a local proxy. `?tvRelayErrors=1` posts the frame's errors to its
  parent, for such tests. Vite dev cannot be used for this test (its client
  breaks in that worker): proxy the live build and inject the script.

## Tested 2026-11-19

- `pnpm test`: five tools over stdio against live services.
- Claude Desktop, local server, plain-language request: the model called
  `open_view` and `screenshot` unprompted; the view rendered; the frame was
  blank (the rule above). The picture fallback was verified in
  `host-test.mjs` (HOST_FRAMES=deny), not yet seen in Claude Desktop.
- Driving Claude Desktop with agent-desktop collides with Jonathan typing:
  headed input needs the foreground. Ask him to send the test message.
- Claude Desktop's config has a `terrain-viewer` entry (backup beside it,
  `claude_desktop_config.json.bak-2026-11-19`).

## Remote connector test by Jonathan (2026-11-19)

Added the Cloudflare tunnel address as a custom connector: Claude did not
ask to allow terrain-viewer.iconem.com, so no framed app. Per Claude's
docs the framed site also needs a conversation in the "unified Claude
experience" (chat and Cowork in one; Team/Enterprise owners switch it in
Organization settings > Capabilities, "Chat and Cowork unified"), and is
only on for a limited set of organizations: there is no other switch. The
console line starting `[mcp-ext-apps-host]` that names `frameDomains` says
which case applies. Jonathan saw the picture, not the interactive map; not
known whether the view asked for a computed mode (picture is then the
default) or the map failed there.

Picture speed: one shared browser context (HTTP cache), results cached ten
minutes by URL and size, `open_view` starts the render before the page
asks, and the app sets `window.__tvBusy` / `__tvIdleSeen` (TerrainViewer
onLoad) so the picture is taken when the maps are idle. About 4 to 6 s
with the signal, which the live site only has after a deploy.

## Since 0.3.0 (2026-11-19, later the same day)

Ten tools: plus `compare_sources`, `imagery_dates`, `search_stac`,
`elevation` (points or a profile, several sources), `export_geotiff`
(`mcp/data-tools.mjs`). `view.html` has three displays: an interactive
MapLibre map drawn by the page (maplibre-gl 5 classic build inlined, its
worker from a blob: works in a frame without an origin; v6 is ESM with a
separate worker and does not), the exact picture, the framed app. The map
draws hillshade, 3D and imagery on tile datasets only; `map.exact` in the
tool result says whether that is the whole view. Elevation values are read
by decoding tiles in a headless page (no native image library in Node).
Playwright's "networkidle" never comes on the app (background metadata
polling): `screenshot` waits for tile requests to go quiet instead.
Not yet seen: the interactive map inside Claude itself.

## Next

A public HTTPS host (`mcp/Dockerfile`, untested; Jonathan chooses where),
then claude.ai and ChatGPT as a custom connector. A real interactive map
inside the view itself (MapLibre with `connectDomains` for the tiles) would
show live in every host, without framing the site.

**Why:** the skill only composes links; a server runs the lookups and shows
the result in the chat. See [[reminders]].

## Framing refused, app loaded in the view instead (2026-11-20)

Jonathan tested a custom connector on a personal Max plan and on a team with
"Chat and Cowork unified" on: Claude reported an empty `frameDomains` both
times and never asked. Console: "Not among the sites that Claude allows this
connector to show". No admin setting exists for it. Routes left: a Verified
directory listing (needs a permanent host; steps in the MCP server docs
page), or not framing at all.

"App here (test)" in `mcp/view.html` does the second: the view sets its own
address to the embed parameters (`history.replaceState`), adds a `<base>` to
the site, loads the site's stylesheets and entry module (names read from the
deployed `index.html` by `appAssets()` in `server.mjs`), and mounts the app in
`#root`. Needs the site in `resourceDomains` and `connectDomains`, plus every
host the app reads (`APP_EXTRA_ORIGINS`, incomplete). Found with
`host-test.mjs` (HOST_ORIGIN, HOST_WASM switches):

- A worker whose first script is `import "<site url>"` is checked against
  `worker-src`, not `script-src`: refused when the host only lists the site
  for scripts. MapLibre 6 makes exactly that blob for a cross-origin worker
  URL. The view replaces it with a classic blob worker that does a dynamic
  `import()` (checked against `script-src`) and replays the messages received
  meanwhile. Works with and without an origin.
- After a deploy the asset names change: a stale name is a 404 and the app
  never starts (cache of five minutes in `appAssets()`).
- Without `'wasm-unsafe-eval'` the contour worker fails; the rest draws.
- Not yet seen in Claude itself: whether its policy lets the site's scripts
  load is the open question.
