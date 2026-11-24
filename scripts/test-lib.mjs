// Runs a lib/*.test.ts that imports app modules reading import.meta.env
// (Vite's), which tsx and node's type stripping leave undefined: the test is
// bundled for Node by esbuild with import.meta.env empty, as the tile
// service bundles the same code (tile-server/build.mjs), then run with
// node --test (forced to exit: some app modules keep a timer). Offline
// tests stub fetch themselves.
//
//   node scripts/test-lib.mjs lib/stac-dated.test.ts
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { basename } from "node:path"

const files = process.argv.slice(2)
if (!files.length) { console.error("usage: node scripts/test-lib.mjs lib/<name>.test.ts ..."); process.exit(2) }
// esbuild is not a direct dependency of the root: tsx carries it.
const require = createRequire(createRequire(import.meta.url).resolve("tsx/package.json"))
const { build } = require("esbuild")
mkdirSync(".cache/lib-tests", { recursive: true })
const outs = []
for (const f of files) {
  const outfile = `.cache/lib-tests/${basename(f).replace(/\.ts$/, ".mjs")}`
  await build({
    entryPoints: [f], outfile, bundle: true, platform: "node", format: "esm", target: "node20",
    tsconfig: "tsconfig.json", logLevel: "error", packages: "bundle",
    define: { "import.meta.env": "{}" },
    loader: { ".gz": "empty", ".png": "empty", ".jpg": "empty", ".svg": "empty", ".css": "empty", ".mdx": "empty", ".wasm": "empty" },
    // Vite's `?url` and `?raw` imports: nothing a test reads.
    plugins: [{ name: "vite-suffixes", setup(b) { b.onResolve({ filter: /\?(url|raw)$/ }, (a) => ({ path: a.path, namespace: "empty" })); b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "export default ''", loader: "js" })) } }],
  })
  outs.push(outfile)
}
const r = spawnSync(process.execPath, ["--test", "--test-force-exit", ...outs], { stdio: "inherit" })
process.exit(r.status ?? 1)
