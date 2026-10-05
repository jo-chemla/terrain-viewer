// The decks as a static site, and optionally as PDFs, in one step:
//   node scripts/publish.mjs [--base /docs/slides/] [--out <dir>] [--pdf] [--serve]
// 1. `open-slide build` for the sub-path the site is served from (open-slide's
//    `base`, SLIDES_BASE in open-slide.config.ts);
// 2. the built site copied to --out, with an index.html on every route of the
//    app (static-routes.mjs: decks, presenter windows, themes, assets);
// 3. --pdf: --out served under --base by a small static server (as GitHub
//    Pages serves it), every deck printed to <out>/pdf/<deck>.pdf;
// 4. --serve: keep serving it, to try the static site as it will be online.
// What stays dev-only: the inspector, comments and inline edits, which write
// the slide sources back through the dev server.
import { spawnSync, spawn } from "node:child_process"
import { createServer } from "node:http"
import { cpSync, rmSync, existsSync, statSync, readFileSync } from "node:fs"
import { join, dirname, extname, resolve } from "node:path"

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback }
const base = (arg("--base", "/docs/slides/").replace(/\/?$/, "/")).replace(/^\/?/, "/")
const out = resolve(arg("--out", join(root, "..", ".cache", "slides-site")))
const wantPdf = process.argv.includes("--pdf")
const serve = process.argv.includes("--serve")
const port = Number(arg("--port", "4180"))

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run("node", ["scripts/sync-assets.mjs"])
run("npx", ["open-slide", "build"], { SLIDES_BASE: base })
rmSync(out, { recursive: true, force: true })
cpSync(join(root, "dist"), out, { recursive: true })
run("node", ["scripts/static-routes.mjs", out])
console.log(`static site: ${out} (served under ${base})`)

if (!wantPdf && !serve) process.exit(0)

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".pdf": "application/pdf" }
// Like GitHub Pages: files as they are, a directory's index.html, else 404.
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname)
  if (!path.startsWith(base)) { res.writeHead(404).end(); return }
  let file = join(out, path.slice(base.length))
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html")
  if (!existsSync(file)) { res.writeHead(404).end(); return }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file))
})
await new Promise((ok) => server.listen(port, ok))
const url = `http://localhost:${port}${base}`
console.log(`serving ${url}`)

// Asynchronous: the export's page loads are answered by this same process.
if (wantPdf) {
  const code = await new Promise((ok) => spawn("node", ["scripts/export-pdf.mjs", url.replace(/\/$/, ""), join(out, "pdf")], { cwd: root, stdio: "inherit" }).on("exit", ok))
  if (code !== 0) { server.close(); process.exit(code ?? 1) }
}
if (serve) console.log("Ctrl+C to stop")
else server.close()
