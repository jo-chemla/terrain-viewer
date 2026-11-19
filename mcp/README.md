# Terrain Viewer MCP server (prototype)

An MCP server with one tool, `open_view`. Given a place (latitude, longitude)
and a list of modes, it returns the Terrain Viewer link and, in a host that
supports [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) (Claude,
ChatGPT, VS Code), shows the app itself in the conversation.

A standalone pnpm root, like `video/`: it is not part of the root install.

```bash
cd mcp
pnpm install
pnpm test                # link builder, tool call and view page, over stdio
node server.mjs          # Streamable HTTP on http://localhost:3300/mcp
node server.mjs --stdio  # stdio, for a desktop client
node host-test.mjs       # a stand-in host on http://localhost:3301/ to look at the view
```

`TV_BASE_URL` points the links at another deployment (default
`https://terrain-viewer.iconem.com/`); `PORT` changes the port.

## Try it in a client

Claude Code, from this folder:

```bash
claude mcp add terrain-viewer -- node /absolute/path/to/mcp/server.mjs --stdio
```

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "terrain-viewer": { "command": "node", "args": ["/absolute/path/to/mcp/server.mjs", "--stdio"] } } }
```

claude.ai and ChatGPT need the HTTP endpoint on a public HTTPS address
(a tunnel for a test, a small host later), added as a custom connector.

## Files

| File | Role |
|---|---|
| `url.mjs` | `buildViewUrl`: a typed view description to a link. The mode table mirrors `skills/terrain-viewer/SKILL.md`. |
| `server.mjs` | The server: `open_view` and the `ui://terrain-viewer/view.html` resource. |
| `view.html` | The page the host renders: it frames the app and offers "Open in the browser". The MCP Apps client library is inlined at start, since the sandbox blocks network scripts. |
| `test.mjs` | End-to-end check over stdio. |
| `host-test.mjs` | A hand-written host for a visual check. |

## What is known

- The view's only network need is the frame: the resource declares
  `csp.frameDomains` with the app's origin. A host that refuses nested frames
  shows the link and the "Open in the browser" button only.
- The app stays blank in a frame without an origin of its own
  (`sandbox="allow-scripts"` alone): it needs storage. Real hosts give the
  view an origin; the stand-in host does too.
- The view page weighs about 500 KB, nearly all of it the inlined library.

## Not built yet

`datasets_covering` (which library datasets cover a point), `catalog_items`
(dated imagery for a bbox), `screenshot`, a public HTTPS deployment, and the
registration with OpenAI.
