---
name: mcp-apps-plan
description: Roadmap note (2026-10-08): a Terrain Viewer MCP server with an in-chat UI (MCP Apps, the same server also serves ChatGPT's Apps SDK), not built yet; the skill stays the teaching layer
type: project
---

# Terrain Viewer as an MCP App (not built, noted 2026-10-08)

The user wants a deeper integration in Claude and ChatGPT like Needle
Inspector (an OpenAI Apps SDK app). Both routes are an MCP server:

- **MCP Apps** (the first official MCP extension, live in Claude since
  2026-01-26; VS Code, Goose, ChatGPT following): a tool result points at a
  `ui://` resource that the host renders in a sandboxed iframe. SDK:
  `@modelcontextprotocol/ext-apps` next to `@modelcontextprotocol/sdk`.
  Spec: github.com/modelcontextprotocol/ext-apps. Frameworks seen but not
  vetted: mcp-use (React views for ChatGPT and Claude), chapplin, MCP Apps
  Kit, FastMCP. None has the adoption to prefer over the official SDK yet.
- **OpenAI Apps SDK**: the same shape (MCP server + widget), so one server
  with two manifests.

Plan when asked: a small server with tools `open_view` (place, modes, dates
→ an app URL from the skill's rules), `datasets_covering` (lat/lng → library
ids, Mapterhorn resolution), `catalog_items` (bbox + catalog ids → ticks),
`screenshot`; the widget is the app in an iframe (every setting is in the
URL; `sidebarCollapsed=true` for embeds). About two days for both hosts.

**Why:** the skill only composes links; a server can run the lookups the
app already does in the browser and show the result in the chat.
**How to apply:** start with Claude (testable in Claude Code / claude.ai),
then register the same server with OpenAI. See [[reminders]].
