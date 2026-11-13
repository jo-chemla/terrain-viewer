#!/usr/bin/env node
// The docs' screenshots (docs/public/screenshots, about 170 MB of 4K
// pictures and a few clips) live on the `docs-media` GitHub release of
// Iconem/terrain-viewer, not in the repository: every retake used to add
// its full weight to the history for good. The tracked file docs/media.lock
// names the archive this commit wants (content-addressed:
// screenshots-<sha256 prefix>.tar) and this script brings the folder in line
// with it.
//
//   node scripts/docs-media.mjs pull            download and unpack when the folder is not at the lock's version
//   node scripts/docs-media.mjs pull --strict   same, and fail the process when it cannot (builds)
//   node scripts/docs-media.mjs push            pack the folder, upload it to the release (gh), rewrite the lock
//   node scripts/docs-media.mjs status          say whether the folder matches the lock
//
// `pull` runs before the docs dev server, the docs build and the slide
// builds. After retaking or adding a screenshot: `pnpm docs:media:push`, then
// commit docs/media.lock with the pages that use the picture. Old archives
// stay on the release, so an older commit still builds.

import { createHash } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import { mkdir, readFile, rm, stat, writeFile, readdir } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createWriteStream } from "node:fs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PUBLIC = join(ROOT, "docs", "public")
const DIR = join(PUBLIC, "screenshots")
const LOCK = join(ROOT, "docs", "media.lock")
const STAMP = join(DIR, ".media-sha")
const CACHE = join(ROOT, ".cache", "docs-media")
const REPO = "Iconem/terrain-viewer"
const TAG = "docs-media"

const mode = process.argv[2] ?? "pull"
const strict = process.argv.includes("--strict")

const sha256 = (file) => new Promise((ok, ko) => {
  const h = createHash("sha256")
  createReadStream(file).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", ko)
})
const readLock = async () => (existsSync(LOCK) ? JSON.parse(await readFile(LOCK, "utf8")) : null)
const stamp = async () => (existsSync(STAMP) ? (await readFile(STAMP, "utf8")).trim() : null)
async function countFiles(dir) {
  let n = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += await countFiles(join(dir, e.name))
    else if (e.name !== ".media-sha") n++
  }
  return n
}
// Relative paths and a cwd: GNU tar (Git Bash) reads "C:\..." as a remote host.
const tar = (args, cwd) => execFileSync("tar", args, { cwd, stdio: ["ignore", "inherit", "inherit"] })

async function pull() {
  const lock = await readLock()
  if (!lock) { console.log("docs-media: no docs/media.lock, nothing to pull"); return }
  if ((await stamp()) === lock.sha256) { console.log(`docs-media: screenshots at ${lock.sha256.slice(0, 12)} (${lock.files} files), up to date`); return }
  await mkdir(CACHE, { recursive: true })
  const archive = join(CACHE, lock.asset)
  if (!existsSync(archive) || (await sha256(archive)) !== lock.sha256) {
    const url = `https://github.com/${REPO}/releases/download/${TAG}/${lock.asset}`
    console.log(`docs-media: downloading ${lock.asset} (${Math.round(lock.size / 1e6)} MB) from the ${TAG} release`)
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
    await pipeline(Readable.fromWeb(res.body), createWriteStream(archive))
    const got = await sha256(archive)
    if (got !== lock.sha256) { await rm(archive, { force: true }); throw new Error(`checksum mismatch for ${lock.asset}: ${got}`) }
  }
  // A clean folder when possible (a retake may have removed a picture); a
  // dev server watching the folder locks it on Windows, and then the archive
  // is unpacked over what is there.
  try { await rm(DIR, { recursive: true, force: true }) } catch { console.warn("docs-media: the folder is in use, unpacking over it") }
  tar(["-xf", join("..", "..", ".cache", "docs-media", lock.asset)], PUBLIC)
  await writeFile(STAMP, lock.sha256 + "\n")
  console.log(`docs-media: unpacked ${await countFiles(DIR)} files into docs/public/screenshots`)
}

async function push() {
  if (!existsSync(DIR)) throw new Error("docs/public/screenshots does not exist")
  await mkdir(CACHE, { recursive: true })
  const tmp = join(CACHE, "screenshots-new.tar")
  await rm(tmp, { force: true })
  tar(["-cf", join("..", "..", ".cache", "docs-media", "screenshots-new.tar"), "--exclude=.media-sha", "screenshots"], PUBLIC)
  const sha = await sha256(tmp)
  const lock = await readLock()
  if (lock?.sha256 === sha) { await writeFile(STAMP, sha + "\n"); console.log("docs-media: nothing changed since the lock"); return }
  const asset = `screenshots-${sha.slice(0, 12)}.tar`
  const archive = join(CACHE, asset)
  await rm(archive, { force: true })
  const { rename } = await import("node:fs/promises")
  await rename(tmp, archive)
  const gh = (args) => execFileSync("gh", args, { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" })
  try { gh(["release", "view", TAG, "-R", REPO, "--json", "tagName"]) } catch {
    gh(["release", "create", TAG, "-R", REPO, "--prerelease", "--title", "Docs media (screenshots)", "--notes", "The docs' screenshots, as content-addressed tar archives (screenshots-<sha256 prefix>.tar). docs/media.lock in the repository names the one a commit uses; scripts/docs-media.mjs pulls and pushes them. Older archives stay so older commits still build."])
  }
  gh(["release", "upload", TAG, archive, "-R", REPO, "--clobber"])
  const size = (await stat(archive)).size
  const files = await countFiles(DIR)
  await writeFile(LOCK, JSON.stringify({ release: TAG, asset, sha256: sha, size, files, pushed: new Date().toISOString().slice(0, 10) }, null, 2) + "\n")
  await writeFile(STAMP, sha + "\n")
  console.log(`docs-media: uploaded ${asset} (${Math.round(size / 1e6)} MB, ${files} files); commit docs/media.lock`)
}

async function status() {
  const lock = await readLock(), at = await stamp()
  console.log(lock ? `lock ${lock.asset} (${lock.files} files, ${Math.round(lock.size / 1e6)} MB, pushed ${lock.pushed})` : "no lock")
  console.log(at ? `folder at ${at.slice(0, 12)}${lock && at === lock.sha256 ? ", matches" : ", DIFFERS from the lock"}` : existsSync(DIR) ? "folder present, never stamped" : "folder missing")
}

try {
  if (mode === "pull") await pull()
  else if (mode === "push") await push()
  else if (mode === "status") await status()
  else throw new Error(`unknown mode "${mode}" (pull, push, status)`)
} catch (e) {
  if (mode === "pull" && !strict) {
    // A dev server without network should still start; the pictures are then
    // missing or stale, which the docs survive.
    console.warn(`docs-media: ${e.message} - continuing without the current screenshots`)
  } else {
    console.error(`docs-media: ${e.message}`)
    process.exit(1)
  }
}
