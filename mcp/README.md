# Terrain Viewer MCP server

Lets an assistant (Claude, ChatGPT, any MCP client) answer "show me the
relief of this place" in plain language: it finds the place, picks the data
and the modes, and shows the view in the conversation.

| Tool | What it does |
|---|---|
| `open_view` | A place and modes to a Terrain Viewer link, shown in the conversation by hosts that support [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) |
| `geocode` | A place name to coordinates (OpenStreetMap Nominatim) |
| `datasets_covering` | The library's terrain datasets covering a point, finest first, and the catalogs of dated imagery that have something there |
| `catalog_items` | Dated imagery and old maps for an area, from the catalogs the app's timeline reads; each item has an `imageryUrl` that `open_view` shows |
| `screenshot` | A picture of a view, rendered in a headless Chrome, for the model to look at |

A standalone pnpm root, like `video/`: it is not part of the root install,
but its build step reads the app's code, so the root install must exist.

```bash
pnpm install             # at the repository root, once
cd mcp && pnpm install
pnpm test                # builds, then runs every tool over stdio (network; NO_SCREENSHOT=1 skips the picture)
pnpm start               # Streamable HTTP on http://localhost:3300/mcp
node server.mjs --stdio  # stdio, for a desktop client (run `pnpm build` first)
pnpm host                # a stand-in host on http://localhost:3301/ (HOST_FRAMES=allow|deny)
```

Environment: `TV_BASE_URL` (default `https://terrain-viewer.iconem.com/`),
`PORT` (3300), `CHROME_PATH` (a Chromium for `screenshot`; the installed
Chrome when unset), `TV_ALLOWED_HOSTS` (public host names accepted in the
Host header).

## Use it in a client

Claude Desktop (`claude_desktop_config.json`, then restart the app):

```json
{ "mcpServers": { "terrain-viewer": { "command": "node", "args": ["C:/Dev/Iconem/terrain-viewer/mcp/server.mjs", "--stdio"] } } }
```

Claude Code: `claude mcp add terrain-viewer -- node /absolute/path/to/mcp/server.mjs --stdio`

claude.ai and ChatGPT reach a connector by URL: they need the HTTP endpoint
on a public HTTPS address (`Dockerfile`, or a tunnel for a test), added as a
custom connector.

## What shows in the conversation

The view tries to frame the live app. Whether a host allows that:

| Host and connector | Live app in the chat |
|---|---|
| Claude, local server (Claude Desktop config) | Never: Claude blocks framed sites for local servers |
| Claude, custom connector by URL | Only after the user allows the origin, for a limited set of organizations |
| Claude, directory connector | Only under a Verified listing that allows the origin |
| Other hosts | Depends on the host |

Source: [Embed a website in an MCP App](https://claude.com/docs/connectors/building/mcp-apps/embedded-sites).
So the view shows the live app only when the host says the origin is allowed
(`getHostCapabilities().sandbox.csp.frameDomains`). Otherwise it asks the
server for a picture (`screenshot`) and shows that, with "Open in the
browser" for the live view. When the host says nothing, it shows the picture
and a "Try the live view" button.

For Claude to frame the site under a remote connector, the site must also
allow it: set `ui.domain` on the resource and send `frame-ancestors` for
that sandbox host and `https://claude.ai`. GitHub Pages sends no
`frame-ancestors` today, which allows everyone.

## Files

| File | Role |
|---|---|
| `url.mjs` | `buildViewUrl`: a typed view description to a link. The mode table mirrors `skills/terrain-viewer/SKILL.md`. |
| `tools.mjs` | The lookups: geocoder, library, catalogs, headless screenshot. |
| `server.mjs` | The MCP wiring, the instructions given to the model, the `ui://` resource. |
| `view.html` | The page the host renders. The MCP Apps client library is inlined at start, since the sandbox blocks network scripts. |
| `app-lib.ts`, `build.mjs` | Bundle the app's own catalog code for Node into `generated/` (not tracked), with `import.meta.env` empty so no key from `.env` can get in. |
| `test.mjs`, `host-test.mjs` | End-to-end test over stdio; a hand-written host for a visual check. |
| `Dockerfile` | For a public host. Not built or run yet. |

## Tested, and not

- `pnpm test`: all five tools over stdio, against the live services.
- Stand-in host in a real browser: handshake, live frame, picture fallback.
- Claude Desktop (2026-11-19, local server): from a plain-language request
  the model called `open_view` and `screenshot`; the view rendered with its
  label and button; the framed app stayed blank, which is Claude's rule for
  local servers and the reason for the picture fallback. The fallback itself
  was not seen in Claude Desktop yet.
- The picture fallback in Claude Desktop: seen by Jonathan on 2026-11-19.
  A render went from about 25 s to about 8 s the same day (the wait was on
  background metadata requests, not on tiles).
- Through a temporary public address (a Cloudflare quick tunnel,
  `npx cloudflared tunnel --url http://localhost:3300 --http-host-header localhost`):
  the five tools answer over HTTPS.
- Not tried: claude.ai and ChatGPT as a custom connector, the Dockerfile.
