// A stand-in host, to look at the view without Claude or ChatGPT:
//
//   node host-test.mjs      then open http://localhost:3301/
//
// It calls open_view on the real server (over stdio), reads the view page,
// puts it in a sandboxed iframe with the content security policy the
// resource asks for, and speaks the MCP Apps handshake by hand: answer
// ui/initialize, then send the tool result once the view says it is ready.
// A real host does more (a sandbox proxy on another origin, which is why
// allow-same-origin is safe there and only tolerable here); this only shows
// that the page connects, receives the result and frames the app.
import http from "node:http"
import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"

// HOST_VIEW=exact: a view the in-chat map draws by itself; otherwise one that needs the app's modes.
const args = process.env.HOST_VIEW === "exact"
  ? { lat: 45.9763, lng: 7.6586, zoom: 12.5, viewMode: "3d", modes: ["hillshade", "basemap"], place: "Matterhorn" }
  : { lat: 45.9763, lng: 7.6586, zoom: 12.5, viewMode: "3d", modes: ["hillshade", "slope"], place: "Matterhorn" }

const client = new Client({ name: "tv-host-test", version: "0.0.0" })
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["server.mjs", "--stdio"], env: process.env }))
const result = await client.callTool({ name: "open_view", arguments: args })
const page = (await client.readResource({ uri: "ui://terrain-viewer/view.html" })).contents[0]
// HOST_FRAMES=allow | deny | (unset: the host says nothing), to see the three cases.
const sandbox = process.env.HOST_FRAMES === "allow" ? { csp: { frameDomains: page._meta.ui.csp.frameDomains } } : process.env.HOST_FRAMES === "deny" ? { csp: { frameDomains: [] } } : undefined

const frames = page._meta.ui.csp.frameDomains.join(" ")
const tiles = (page._meta.ui.csp.connectDomains ?? []).join(" ")
// A guess at a strict host: inline scripts, workers from a blob, requests and
// images only to the declared hosts.
const csp = `default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob: ${tiles}; connect-src ${tiles}; frame-src ${process.env.HOST_FRAMES === "allow" ? frames : "'none'"}`

const host = `<!doctype html><meta charset="utf-8"><title>MCP Apps host test</title>
<body style="font:14px system-ui;max-width:860px;margin:24px auto">
<p><b>open_view</b> ${JSON.stringify(args).replace(/</g, "&lt;")}</p>
<pre id="log" style="font-size:11px;white-space:pre-wrap;opacity:.7"></pre>
<iframe id="view" sandbox="allow-scripts" src="/view" style="width:100%;height:580px;border:0"></iframe>
<script>
const result = ${JSON.stringify({ content: result.content, structuredContent: result.structuredContent })};
const frame = document.getElementById("view"), log = document.getElementById("log");
const say = (t) => { log.textContent += t + "\\n" };
const send = (m) => frame.contentWindow.postMessage({ jsonrpc: "2.0", ...m }, "*");
window.addEventListener("message", (e) => {
  if (e.source !== frame.contentWindow) return;
  const m = e.data; if (!m || m.jsonrpc !== "2.0") return;
  say("view -> host: " + (m.method || "response " + m.id));
  if (m.method === "ui/initialize") send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, hostInfo: { name: "host-test", version: "0" }, hostCapabilities: { openLinks: {}, serverTools: {}, sandbox: ${JSON.stringify(sandbox)} }, hostContext: { theme: "light", displayMode: "inline" } } });
  else if (m.method === "ui/notifications/initialized") { send({ method: "ui/notifications/tool-input", params: { arguments: ${JSON.stringify(args)} } }); send({ method: "ui/notifications/tool-result", params: result }); say("host -> view: tool-result"); }
  else if (m.method === "tools/call") { say("view -> server: " + m.params.name); fetch("/call", { method: "POST", body: JSON.stringify(m.params) }).then((r) => r.json()).then((r) => send({ id: m.id, result: r })) }
  else if (m.method === "ui/open-link") { say("open-link " + m.params.url); send({ id: m.id, result: {} }); }
  else if (m.id !== undefined && m.method) send({ id: m.id, result: {} });
});
</script>`

const port = Number(process.env.PORT || 3301)
http.createServer(async (req, res) => {
  if (req.url === "/call") {
    let body = ""; for await (const c of req) body += c
    const r = await client.callTool(JSON.parse(body), { timeout: 90000 }).catch((e) => ({ isError: true, content: [{ type: "text", text: String(e.message) }] }))
    res.writeHead(200, { "content-type": "application/json" }); return void res.end(JSON.stringify(r))
  }
  if (req.url === "/view") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp }); return void res.end(page.text) }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(host)
}).listen(port, () => console.log(`host test on http://localhost:${port}/`))
