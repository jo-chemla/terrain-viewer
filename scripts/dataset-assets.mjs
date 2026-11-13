#!/usr/bin/env node
// Data files the app serves from its own origin but the repository does not
// carry: the built VRT indexes (public/vrt, 3 to 5 MB each) and the coverage
// footprints (public/coverage/*.geojson, 6 MB, regenerated now and then, each
// regeneration a full copy in the git history). They live on the
// `dataset-indexes` release of Iconem/terrain-viewer; the tracked file
// datasets.lock.json lists each one with its folder under public/, its size
// and its sha256, and this script brings public/ in line with it. Vite copies
// public/ into dist/, so the website and the desktop bundles get them through
// `pnpm build` with no step of their own (a release asset sends no CORS
// header, the site does).
//
//   node scripts/dataset-assets.mjs pull            fetch what is missing or behind the lock
//   node scripts/dataset-assets.mjs pull --strict   same, and fail when a file cannot be had (builds)
//   node scripts/dataset-assets.mjs push <file...>  upload files under public/ to the release (gh), update the lock
//   node scripts/dataset-assets.mjs pull --refresh  also re-fetch the rolling files
//   node scripts/dataset-assets.mjs status
//
// An entry marked "rolling": true in the lock is not pinned to its hash: the
// monthly coverage workflow (.github/workflows/coverage-rebuild.yml) replaces
// those files on the release without a commit, so a build takes whatever is
// there, and a local copy is left alone unless `pull --refresh` is asked.
//
// A file changed locally and not pushed is never overwritten by a pull: the
// script remembers the hash it last wrote (.cache/dataset-assets.json) and
// only replaces a file that still has it. After regenerating a footprint or
// an index: `pnpm datasets:push public/coverage/<file>`, then commit
// datasets.lock.json.

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile, stat } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const LOCK = join(ROOT, "datasets.lock.json")
const SEEN = join(ROOT, ".cache", "dataset-assets.json")
const REPO = "Iconem/terrain-viewer"

const mode = process.argv[2] ?? "pull"
const strict = process.argv.includes("--strict")
const refresh = process.argv.includes("--refresh")
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")
const readJson = async (p, d) => (existsSync(p) ? JSON.parse(await readFile(p, "utf8")) : d)
const fileSha = async (p) => (existsSync(p) ? sha256(await readFile(p)) : null)
const writeLock = (lock) => writeFile(LOCK, JSON.stringify(lock, null, 2) + "\n")

async function pull() {
  const lock = await readJson(LOCK, null)
  if (!lock) { console.log("datasets: no datasets.lock.json, nothing to pull"); return }
  const seen = await readJson(SEEN, {})
  let fetched = 0, kept = 0, failed = 0
  for (const f of lock.files) {
    const path = join(ROOT, f.dir, f.name), key = `${f.dir}/${f.name}`
    const local = await fileSha(path)
    if (local === f.sha256) { seen[key] = local; continue }
    if (f.rolling && local && !refresh) continue
    if (local && local !== seen[key] && !f.rolling) {
      console.warn(`datasets: ${key} differs from the lock and was changed here; kept (pnpm datasets:push ${key} to publish it)`)
      kept++; continue
    }
    try {
      const url = `https://github.com/${REPO}/releases/download/${lock.release}/${f.name}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const got = sha256(buf)
      if (got !== f.sha256 && !f.rolling) throw new Error(`${f.name} on the release is not the file the lock names (${got.slice(0, 12)} against ${f.sha256.slice(0, 12)}); commit the lock that goes with it`)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, buf)
      seen[key] = got; fetched++
    } catch (e) {
      failed++
      console.warn(`datasets: ${e.message}`)
    }
  }
  await mkdir(dirname(SEEN), { recursive: true })
  await writeFile(SEEN, JSON.stringify(seen, null, 2) + "\n")
  console.log(`datasets: ${lock.files.length} files in the lock, ${fetched} fetched${kept ? `, ${kept} local changes kept` : ""}${failed ? `, ${failed} FAILED` : ""}`)
  if (failed && strict) throw new Error(`${failed} dataset file(s) missing`)
}

async function push() {
  const args = process.argv.slice(3).filter((a) => !a.startsWith("--"))
  if (!args.length) throw new Error("push needs one or more files under public/ (e.g. public/coverage/esri-3d.geojson)")
  const lock = await readJson(LOCK, { release: "dataset-indexes", files: [] })
  const seen = await readJson(SEEN, {})
  for (const a of args) {
    const path = resolve(a)
    const dir = relative(ROOT, dirname(path)).replaceAll("\\", "/"), name = basename(path)
    if (!dir.startsWith("public/")) throw new Error(`${a} is not under public/`)
    const clash = lock.files.find((f) => f.name === name && f.dir !== dir)
    if (clash) throw new Error(`${name} already exists on the release for ${clash.dir}; asset names are flat, rename one`)
    const sha = await fileSha(path)
    if (!sha) throw new Error(`${a} does not exist`)
    execFileSync("gh", ["release", "upload", lock.release, path, "-R", REPO, "--clobber"], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] })
    const i = lock.files.findIndex((f) => f.name === name)
    const entry = { name, dir, size: (await stat(path)).size, sha256: sha }
    if (lock.files[i]?.rolling || process.argv.includes("--rolling")) entry.rolling = true
    if (i >= 0) lock.files[i] = entry; else lock.files.push(entry)
    seen[`${dir}/${name}`] = sha
    console.log(`datasets: uploaded ${dir}/${name} (${Math.round(entry.size / 1e3)} KB)`)
  }
  lock.files.sort((a, b) => (a.dir + a.name).localeCompare(b.dir + b.name))
  await writeLock(lock)
  await mkdir(dirname(SEEN), { recursive: true })
  await writeFile(SEEN, JSON.stringify(seen, null, 2) + "\n")
  console.log("datasets: commit datasets.lock.json")
}

async function status() {
  const lock = await readJson(LOCK, null)
  if (!lock) { console.log("no lock"); return }
  for (const f of lock.files) {
    const local = await fileSha(join(ROOT, f.dir, f.name))
    console.log(`${local === f.sha256 ? "ok      " : local ? "DIFFERS " : "missing "} ${f.dir}/${f.name}  ${Math.round(f.size / 1e3)} KB`)
  }
}

try {
  if (mode === "pull") await pull()
  else if (mode === "push") await push()
  else if (mode === "status") await status()
  else throw new Error(`unknown mode "${mode}" (pull, push, status)`)
} catch (e) {
  if (mode === "pull" && !strict) console.warn(`datasets: ${e.message} - continuing without them`)
  else { console.error(`datasets: ${e.message}`); process.exit(1) }
}
