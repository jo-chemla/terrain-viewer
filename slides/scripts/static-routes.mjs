// Static hosting (GitHub Pages) has no rewrite to the single-page app: a deep
// link like <base>/s/historical would 404. The app's own index.html goes to
// s/<deck>/index.html for every deck (the assets are absolute, under the
// build's base), so each deck's address works on its own.
import { readdirSync, existsSync, mkdirSync, copyFileSync } from "node:fs"
import { join, dirname } from "node:path"
const root = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
const dist = process.argv[2] ?? join(root, "dist")
const decks = readdirSync(join(root, "slides")).filter((d) => existsSync(join(root, "slides", d, "index.tsx")))
for (const deck of decks) {
  mkdirSync(join(dist, "s", deck), { recursive: true })
  copyFileSync(join(dist, "index.html"), join(dist, "s", deck, "index.html"))
}
console.log(`index.html copied for ${decks.length} decks: ${decks.join(", ")}`)
