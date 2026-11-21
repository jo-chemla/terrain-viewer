# Terrain Viewer MCP server

Lets an assistant (Claude, ChatGPT, any MCP client) answer "show me the
relief of this place" in plain language: it finds the place, picks the data
and the modes, and shows the view in the conversation.

| Tool | What it does |
|---|---|
| `open_view` | A place and modes, shown in the conversation by hosts that support [MCP Apps](https://github.com/modelcontextprotocol/ext-apps), with the link |
| `compare_sources` | One place twice: two terrain datasets or the imagery of two dates |
| `geocode` | A place name to coordinates (OpenStreetMap Nominatim) |
| `datasets_covering` | The library's terrain datasets covering a point, finest first, and the imagery catalogs that have something there |
| `catalog_items` | Dated imagery and old maps for an area, from the catalogs the app's timeline reads |
| `imagery_dates` | Capture dates of the built-in dated imagery (Esri Wayback, Google Earth historical) at a place |
| `search_stac` | Items of any STAC API or static catalog over an area |
| `elevation` | Heights of points or a profile along a line, on one or several tile datasets |
| `export_geotiff` | The elevation of a box as a Float32 GeoTIFF (EPSG:3857) |
| `screenshot` | A picture of a view, rendered in a headless Chrome, for the model to look at |

A standalone pnpm root, like `video/`: it is not part of the root install,
but its build step reads the app's code, so the root install must exist.

```bash
pnpm install             # at the repository root, once
cd mcp && pnpm install
pnpm test                # builds, then runs every tool over stdio (network; NO_SCREENSHOT=1 skips the picture)
pnpm start               # Streamable HTTP on http://localhost:3300/mcp
node server.mjs --stdio  # stdio, for a desktop client (run `pnpm build` first)
pnpm host                # a stand-in host on http://localhost:3301/ (HOST_FRAMES=allow|deny, HOST_VIEW=exact)
```

Environment: `TV_BASE_URL` (default `https://terrain-viewer.iconem.com/`),
`PORT` (3300), `CHROME_PATH` (a Chromium; the installed Chrome when unset),
`TV_SOFTWARE_GL=1` (no GPU), `TV_ALLOWED_HOSTS` (public host names accepted
in the Host header), `TV_PUBLIC_URL` (the public address, for the download
links of `export_geotiff`).

## Use it in a client

Claude Desktop (`claude_desktop_config.json`, then restart the app):

```json
{ "mcpServers": { "terrain-viewer": { "command": "node", "args": ["C:/Dev/Iconem/terrain-viewer/mcp/server.mjs", "--stdio"] } } }
```

Claude Code: `claude mcp add terrain-viewer -- node /absolute/path/to/mcp/server.mjs --stdio`

claude.ai and ChatGPT reach a connector by URL: they need the HTTP endpoint
on a public HTTPS address (`Dockerfile`, or for a test
`npx cloudflared tunnel --url http://localhost:3300 --http-host-header localhost`),
added as a custom connector.

## What shows in the conversation

`view.html` has two displays, with a button for each:

| Display | What it is | When it is the default |
|---|---|---|
| Interactive map | The app itself, embed layout. Run by the page (the app's script and stylesheets loaded from its address, which the resource declares), or framed where the host says the origin may be framed | Always, when the app can run |
| Exact picture | The `screenshot` tool, called by the page: a few seconds | The app's script is refused, or no map canvas after 12 s |

The page's own CSS names only its own elements (`#bar button`, `#wrap >
iframe`): the app runs in the same document, and an unlayered `button` rule
beats the app's layered Tailwind utilities. `appAssets()` in `server.mjs`
reads every stylesheet of the deployed `index.html`, the ones from other
hosts included (MapLibre, the geocoder, Google Fonts): without them the map
controls and the search box lose their layout.

Claude frames a website only for some connectors: never for a local server,
for a custom connector only after the user allows the origin and for a
limited set of organizations, for a directory connector only under a
Verified listing ([Embed a website in an MCP App](https://claude.com/docs/connectors/building/mcp-apps/embedded-sites)).
A refused frame paints white and nothing tells the page, hence the two other
displays. For Claude to frame the site under a remote connector the site
must also allow it (`ui.domain` on the resource, `frame-ancestors` for that
sandbox host and `https://claude.ai`); GitHub Pages sends no
`frame-ancestors` today, which allows everyone.

The page declares the hosts it reads (`connectDomains`, `resourceDomains`):
the app's address and every https host of the app's built-in lists (terrain
and raster libraries, built-in terrain and basemaps, dated imagery and its
catalogs), collected by `build.mjs` into `origins` of
`generated/library.json`, plus `APP_EXTRA_ORIGINS` in `server.mjs` for the
ones the scan cannot see. `elevation` and `export_geotiff` read tile
datasets only and refuse a COG, WMS, VRT or mesh with the reason.

## Files

| File | Role |
|---|---|
| `url.mjs` | `buildViewUrl`: a typed view description to a link. The mode table mirrors `skills/terrain-viewer/SKILL.md`. |
| `tools.mjs` | Geocoder, library, catalogs, headless screenshot. |
| `data-tools.mjs` | Elevation and profile (tiles decoded in a headless page), GeoTIFF writer, imagery dates, STAC search. |
| `server.mjs` | The MCP wiring, the instructions given to the model, the `ui://` resource, `/files/` for exported GeoTIFFs over HTTP. |
| `view.html` | The page the host renders. The MCP Apps client library is inlined at start (about 500 KB). |
| `app-lib.ts`, `build.mjs` | Bundle the app's own catalog, Wayback, Google Earth and STAC code for Node into `generated/` (not tracked), with `import.meta.env` empty so no key from `.env` can get in. |
| `test.mjs`, `host-test.mjs` | End-to-end test over stdio; a hand-written host for a visual check. |
| `render.mjs` | The renderer, the base block: the app in a headless browser, waited on until its maps have drawn (`withSettledPage`). Imported by `tools.mjs` and by `tile-server.mjs`; it knows neither. |
| `dem.mjs` | Elevation tiles read in Node (fetched, decoded by sharp, cached): the `elevation` and `export_geotiff` tools and the tile service's direct engine. No browser. |
| `direct.mjs` | The tile service's direct engine: hillshade (MapLibre's shader ported), colour relief, slope and contours computed from `dem.mjs` grids; `plan()` says when a request goes to the browser instead, and why. |
| `tile-server.mjs`, `tile-openapi.mjs` | The tile service: `/tiles/{z}/{x}/{y}.png`, `/render.png`, titiler's addresses for the same, `/openapi.json` and `/docs` (Scalar). 2048 px blocks cut into tiles, cached a week. `node tile-server.mjs`, port 3400. `node tile-openapi.mjs` rewrites the docs site's copy of the description. With `TV_RENDER_URL` set, `tools.mjs` asks this service for the pictures. |
| `Dockerfile`, `Dockerfile.dockerignore`, `docker-compose.yml` | Two images from one Dockerfile (targets `mcp`, the default, and `tiles`; Chromium included, software GL), what is sent to the build, and a stack for Portainer. Published to `ghcr.io/iconem/terrain-viewer-mcp` and `-tiles` by `.github/workflows/docker-publish.yml`. Built and run locally on 2026-11-20 and 21, not yet on a server. |

## Tested, and not

- `pnpm test`: the ten tools over stdio, against the live services; the
  GeoTIFF read back with geotiff.js, and checked with `gdalinfo`.
- Stand-in host in a real browser, frame sandboxed without an origin and a
  strict CSP: handshake, interactive 3D map, picture.
- Claude Desktop, local server (2026-11-19): a plain-language request made
  the model call `open_view` and `screenshot`; the picture display was seen
  by Jonathan. The framed app stays blank there (Claude's rule).
- A render went from about 25 s to about 8 s (the wait was on background
  metadata requests, not on tiles).
- Through a Cloudflare quick tunnel the tools answer over HTTPS.
- The Docker image (2026-11-20, Docker Desktop): `tools/list`, `elevation`
  and `screenshot` over HTTP; a slope view in 3D in 9 s with SwiftShader;
  the picture written to the volume as user `node`.
- The tile service (2026-11-21, locally and in its container): an imagery
  tile equals Esri's own tile of the same z/x/y (mean difference 1.7 of
  255) and joins its neighbour; first tile of a block 7 s with Chrome, 10 s
  in the container, neighbours from the cache; `/render.jpg?bbox=`. The MCP
  image answers `initialize` and `tools/list` over
  `docker run -i ... node server.mjs --stdio`.
- Claude with a custom connector (2026-11-21, Jonathan): the app runs in
  the view. Not tried: the same with the local stdio server, ChatGPT, the
  container on a server.
