---
name: mcp-apps-plan
description: Terrain Viewer MCP server with an in-chat UI (MCP Apps); a prototype with one tool, open_view, is in mcp/ since 2026-11-19 and passes a local end-to-end test; not yet tried in Claude or ChatGPT, not deployed
type: project
---

# Terrain Viewer as an MCP App

The user wants a deeper integration in Claude and ChatGPT like Needle
Inspector (an OpenAI Apps SDK app). Both routes are an MCP server:

- **MCP Apps** (the first official MCP extension, live in Claude since
  2026-01-26; ChatGPT, VS Code, Goose, Postman also render it): a tool result
  points at a `ui://` resource that the host renders in a sandboxed iframe.
  Spec: github.com/modelcontextprotocol/ext-apps.
- **OpenAI Apps SDK**: ChatGPT now documents MCP Apps too, so one server.

## Prototype, 2026-11-19: `mcp/` (standalone pnpm root, see its README)

- `open_view` (lat, lng, zoom, viewMode, modes, terrainSource, terrainSourceB,
  split, place, free `params`) returns the link and `structuredContent
  { url, embedUrl, label }`. `mcp/url.mjs` holds the mode table, mirrored
  from `skills/terrain-viewer/SKILL.md`: change both together.
- The view (`mcp/view.html`) frames `embedUrl` (`sidebarCollapsed=true`) and
  has an "Open in the browser" button (`app.openLink`).
- SDK facts found the hard way (ext-apps 2.0.4): the server packages are the
  v2 split ones (`@modelcontextprotocol/server`, `/node`, `/client`), not
  `@modelcontextprotocol/sdk`. `registerAppTool` / `registerAppResource` come
  from `@modelcontextprotocol/ext-apps/server`. HTTP:
  `toNodeHandler(createMcpHandler(() => makeServer()))`. The sandbox blocks
  network scripts, so `server.mjs` inlines `ext-apps/app-with-deps` into the
  page (drops its export list, binds `App`); the page is about 500 KB.
- The nested frame needs `_meta.ui.csp.frameDomains: [app origin]` on the
  resource content item.
- The app is blank in a frame with no origin of its own (sandbox
  `allow-scripts` alone): it needs storage. Real hosts give the view an
  origin. If a host does not, the app would need a no-storage fallback.
- Tested: `pnpm test` (stdio: tool listed with its UI link, call, bad mode
  refused, page served with its CSP) and `node host-test.mjs` in a real
  browser (handshake, tool result, app framed on the Matterhorn in 3D).
- Not tested: Claude Desktop, claude.ai, ChatGPT. Whether each host honours
  `frameDomains` is the open question.

## Next

`datasets_covering` (lat/lng to library ids, Mapterhorn resolution),
`catalog_items` (bbox + catalog ids to ticks), `screenshot`; a public HTTPS
host for claude.ai and ChatGPT; registration with OpenAI.

**Why:** the skill only composes links; a server can run the lookups the
app already does in the browser and show the result in the chat.
**How to apply:** try it in Claude Desktop or Claude Code first (stdio, no
hosting), then a tunnel for claude.ai. See [[reminders]].
