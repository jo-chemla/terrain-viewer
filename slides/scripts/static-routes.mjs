// Static hosting (GitHub Pages) has no rewrite to the single-page app: a deep
// link like <base>/s/historical would 404. The app's own index.html goes to
// every route the app has (the assets are absolute, under the build's base):
// each deck, its presenter window (s/<deck>/presenter, synced to the
// audience window over a BroadcastChannel, no server), the themes and the
// assets pages.
import { readdirSync, existsSync, mkdirSync, copyFileSync } from "node:fs"
import { join, dirname } from "node:path"
const root = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
const dist = process.argv[2] ?? join(root, "dist")
const decks = readdirSync(join(root, "slides")).filter((d) => existsSync(join(root, "slides", d, "index.tsx")))
const routes = [...decks.flatMap((d) => [join("s", d), join("s", d, "presenter")]), "themes", "assets"]
for (const route of routes) {
  mkdirSync(join(dist, route), { recursive: true })
  copyFileSync(join(dist, "index.html"), join(dist, route, "index.html"))
}
console.log(`index.html copied to ${routes.length} routes (${decks.length} decks, their presenter windows, themes, assets)`)
