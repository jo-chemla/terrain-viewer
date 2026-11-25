"""The plugins as zips QGIS installs (Plugins > Manage and Install Plugins >
Install from ZIP):
  python make_zip.py                 -> dist/terrain_viewer-<version>.zip and dist/send2map_app-<version>.zip
  python make_zip.py send2map_app    -> only that one
  python make_zip.py --bundled [windows-x64 macos-arm64 macos-x64 linux-x64]
      -> dist/terrain_viewer-<version>-<platform>.zip: Terrain Viewer with the
         tile service inside (terrain_viewer/server/: Node, the service and its
         production node_modules with that platform's sharp binaries), so it
         works with no service running. Any platform builds from any host:
         Node comes from nodejs.org (checked against its SHASUMS256.txt) and
         pnpm installs another platform's sharp binaries through
         supportedArchitectures. Needs the root install and tile-server's
         (`pnpm install` in both): tile-server/build.mjs bundles the app's
         code into tile-server/generated/ first. Built by
         .github/workflows/qgis-plugins.yml for the releases.
  python make_zip.py --server-dir <platform> <folder>
      -> that folder holds the same tile service alone (bin/node, server.mjs,
         node_modules...): what the desktop app ships (desktop/ci-bundle.sh,
         desktop/gen-config.mjs) and starts from its settings.
The tile service shipped this way has no browser engine: playwright-core is
left out and it runs with TV_NO_BROWSER=1, so 3D, tilted, rotated or split
views answer 501 (QGIS asks for flat, north-up tiles only)."""
import configparser
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile

here = os.path.dirname(os.path.abspath(__file__))
repo = os.path.dirname(here)
tile_server = os.path.join(repo, "tile-server")
PLUGINS = ["terrain_viewer", "send2map_app"]
SKIP_DIRS = {"__pycache__", "logos-hd"}  # logos-hd: the icons' sources, not used by the plugin

# The Node shipped in the bundled zips: an LTS, the one the service is tested with.
NODE_VERSION = "22.22.3"
# platform label -> (nodejs.org archive suffix, pnpm os, pnpm cpu)
TARGETS = {
    "windows-x64": ("win-x64.zip", "win32", "x64"),
    "macos-arm64": ("darwin-arm64.tar.gz", "darwin", "arm64"),
    "macos-x64": ("darwin-x64.tar.gz", "darwin", "x64"),
    "linux-x64": ("linux-x64.tar.gz", "linux", "x64"),
}
# The service's files that run (the tests, the engine comparison and the
# build step stay out).
NOT_SHIPPED = {"test.mjs", "proxy-test.mjs", "compare-engines.mjs", "build.mjs"}
# Production dependencies left out: playwright-core drives Chrome or Edge for
# the browser engine (3D, tilted, split views), which a nadir 2D client such
# as QGIS never asks for. render.mjs answers 501 without it.
NOT_SHIPPED_MODULES = ("playwright-core",)


def version_of(name):
    meta = configparser.ConfigParser(interpolation=None)
    meta.read(os.path.join(here, name, "metadata.txt"), encoding="utf-8")
    return meta["general"]["version"]


def add_tree(z, src, arcroot):
    for root, dirs, files in os.walk(src):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for f in sorted(files):
            if f.endswith((".pyc", ".pyo")):
                continue
            path = os.path.join(root, f)
            arc = os.path.join(arcroot, os.path.relpath(path, src)).replace(os.sep, "/")
            info = zipfile.ZipInfo.from_file(path, arc)
            info.compress_type = zipfile.ZIP_DEFLATED
            # Executable bits for unzip tools that keep them (QGIS's installer
            # does not: the plugin sets them again before starting Node).
            if arc.endswith(("/bin/node", "/bin/node.exe")) or f.endswith((".node", ".dylib", ".so")) or ".so." in f:
                info.external_attr = (0o100755 << 16)
            else:
                info.external_attr = (0o100644 << 16)
            with open(path, "rb") as fh:
                z.writestr(info, fh.read())


def build(name):
    os.makedirs(os.path.join(here, "dist"), exist_ok=True)
    out = os.path.join(here, "dist", f"{name}-{version_of(name)}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        add_tree(z, os.path.join(here, name), name)
    return out


# -- the bundled variant ------------------------------------------------------

def run(cmd, cwd):
    exe = shutil.which(cmd[0])
    if not exe:
        sys.exit(f"{cmd[0]} not found on PATH")
    print("  $", " ".join(cmd), f"(in {os.path.relpath(cwd, repo)})")
    subprocess.run([exe, *cmd[1:]], cwd=cwd, check=True)


def fetch(url, dest):
    if not os.path.exists(dest):
        print("  downloading", url)
        tmp = dest + ".part"
        with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f)
        os.replace(tmp, dest)
    return dest


def node_binary(target, cache):
    """The Node executable of a platform, from nodejs.org, checked by hash."""
    suffix = TARGETS[target][0]
    base = f"https://nodejs.org/dist/v{NODE_VERSION}"
    archive = f"node-v{NODE_VERSION}-{suffix}"
    sums = open(fetch(f"{base}/SHASUMS256.txt", os.path.join(cache, f"node-v{NODE_VERSION}-SHASUMS256.txt")), encoding="utf-8").read()
    want = next((line.split()[0] for line in sums.splitlines() if line.endswith("  " + archive)), None)
    path = fetch(f"{base}/{archive}", os.path.join(cache, archive))
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if got != want:
        os.remove(path)
        sys.exit(f"{archive}: sha256 {got}, nodejs.org says {want}")
    top = archive[: -len(".zip")] if archive.endswith(".zip") else archive[: -len(".tar.gz")]
    if archive.endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            return {"node.exe": z.read(f"{top}/node.exe"), "LICENSE": z.read(f"{top}/LICENSE")}
    with tarfile.open(path, "r:gz") as t:
        return {"node": t.extractfile(f"{top}/bin/node").read(), "LICENSE": t.extractfile(f"{top}/LICENSE").read()}


def node_modules(target, stage):
    """tile-server's production dependencies for a platform, flat (no
    symlinks: a zip keeps none), with that platform's sharp binaries."""
    _, os_name, cpu = TARGETS[target]
    for f in ("package.json", "pnpm-lock.yaml"):
        shutil.copy(os.path.join(tile_server, f), stage)
    with open(os.path.join(stage, "pnpm-workspace.yaml"), "w", encoding="utf-8") as f:
        f.write("packages: []\n"
                f"supportedArchitectures:\n  os: [{os_name}]\n  cpu: [{cpu}]\n" + ("  libc: [glibc]\n" if os_name == "linux" else "") +
                "nodeLinker: hoisted\n")
    # --ignore-scripts: sharp's install script only checks its prebuilt binary,
    # which may be another platform's here.
    run(["pnpm", "install", "--prod", "--frozen-lockfile", "--ignore-scripts", "--config.node-linker=hoisted",
         "--config.confirmModulesPurge=false"], stage)
    nm = os.path.join(stage, "node_modules")
    for junk in (".bin", ".pnpm", ".modules.yaml", ".pnpm-workspace-state-v1.json", ".package-lock.json", *NOT_SHIPPED_MODULES):
        p = os.path.join(nm, junk)
        if os.path.isdir(p):
            shutil.rmtree(p)
        elif os.path.exists(p):
            os.remove(p)
    # Source maps and type declarations: never read at run time (about 11 MB).
    for root, _, files in os.walk(nm):
        for f in files:
            if f.endswith((".map", ".d.ts", ".d.mts", ".d.cts")):
                os.remove(os.path.join(root, f))
    os.remove(os.path.join(stage, "pnpm-workspace.yaml"))
    os.remove(os.path.join(stage, "pnpm-lock.yaml"))
    img = os.path.join(nm, "@img")
    if os_name == "linux":
        # nodejs.org's Linux Node is a glibc build: the musl binaries pnpm
        # adds anyway (supportedArchitectures' libc is not applied from
        # another host) would never load.
        for d in os.listdir(img):
            if "linuxmusl" in d:
                shutil.rmtree(os.path.join(img, d))
    have = sorted(os.listdir(img)) if os.path.isdir(img) else []
    want = f"sharp-{os_name}-{cpu}"
    if want not in have:
        sys.exit(f"{target}: {want} not installed (have {have})")
    return have


def commit():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=repo, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"


def stage_server(target, server):
    """The tile service for a platform in the folder `server` (emptied
    first): bin/node, the service's files, generated/, node_modules,
    bundle.json. Returns bundle.json's content."""
    if target not in TARGETS:
        sys.exit(f"unknown platform {target}: one of {', '.join(TARGETS)}")
    generated = os.path.join(tile_server, "generated")
    if not os.path.exists(os.path.join(generated, "app-render.mjs")):
        run(["node", "build.mjs"], tile_server)
    cache = os.path.join(here, "dist", ".cache")
    os.makedirs(cache, exist_ok=True)
    if os.path.exists(server):
        shutil.rmtree(server)
    os.makedirs(os.path.join(server, "bin"))
    print(target, "->", server)
    img = node_modules(target, server)
    for f in sorted(os.listdir(tile_server)):
        if f.endswith(".mjs") and f not in NOT_SHIPPED:
            shutil.copy(os.path.join(tile_server, f), server)
    # The build's own outputs only (a test picture may lie there).
    shutil.copytree(generated, os.path.join(server, "generated"), ignore=shutil.ignore_patterns("test-*"))
    for name, data in node_binary(target, cache).items():
        dest = os.path.join(server, "bin", name if name != "LICENSE" else "NODE-LICENSE")
        with open(dest, "wb") as f:
            f.write(data)
        if name == "node":
            os.chmod(dest, 0o755)
    info = {"platform": target, "node": NODE_VERSION, "sharp": img, "browser": False, "commit": commit(),
            "built": time.strftime("%Y-%m-%d", time.gmtime())}
    with open(os.path.join(server, "bundle.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2)
    size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(server) for f in fs)
    count = sum(len(fs) for _, _, fs in os.walk(server))
    print(f"  {count} files, {size / 1e6:.1f} MB unpacked")
    return info


def build_bundled(target):
    dist = os.path.join(here, "dist")
    server = os.path.join(dist, ".stage", target, "server")
    stage_server(target, server)
    out = os.path.join(dist, f"terrain_viewer-{version_of('terrain_viewer')}-{target}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        add_tree(z, os.path.join(here, "terrain_viewer"), "terrain_viewer")
        add_tree(z, server, "terrain_viewer/server")
    print(out, f"{os.path.getsize(out) / 1e6:.1f} MB")
    return out


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--server-dir"]:
        if len(args) != 3:
            sys.exit("usage: make_zip.py --server-dir <platform> <folder>")
        stage_server(args[1], os.path.abspath(args[2]))
    elif args[:1] == ["--bundled"]:
        for t in args[1:] or list(TARGETS):
            build_bundled(t)
    else:
        for name in args or PLUGINS:
            print(build(name))
