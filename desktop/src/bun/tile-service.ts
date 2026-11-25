// The local tile service: the Terrain Viewer tile service (tile-server/)
// shipped inside the app, started on this computer for the QGIS plugin and
// other XYZ clients. Settings > Desktop: local tile service turns it on and
// off and sets its port (3400 by default); off by default. The setting is
// kept here, in <state dir>/tile-service.json, so a service left on starts
// again with the app.
//
// How it runs: the build puts the service in Resources/app/tile-service/
// (Node, server.mjs, its node_modules with this platform's sharp: the same
// folder as the QGIS plugin's bundled zips, made by
// `qgis-plugin/make_zip.py --server-dir`, see ci-bundle.sh and
// gen-config.mjs), and this module starts that Node on it as a child
// process. Not in the main process itself: the cottontail runtime loads
// sharp but drew a slope tile in 57 s where Node takes 5 (measured
// 2026-11-25), and a crash there would take the window with it.
//
// The child listens on 127.0.0.1 only (no firewall prompt, nothing on the
// network), has no browser engine (TV_NO_BROWSER: flat, north-up tiles; a 3D
// or tilted view is a 501), reads no .env but the EARTHDATA_TOKEN line of
// <state dir>/tile-service.env (see start()), and stops by itself when its
// standard input closes (TV_EXIT_WITH_STDIN), i.e. when the app goes, even
// after a crash.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULT_PORT = 3400;
type State = "stopped" | "starting" | "running" | "stopping" | "error";
export interface TileServiceStatus {
  available: boolean;
  enabled: boolean;
  port: number;
  state: State;
  url?: string;
  message?: string;
  pid?: number;
  log?: string;
}

export function createTileService(opts: { stateDir: string; serverDir?: string; report: (s: TileServiceStatus) => void; log?: (...parts: unknown[]) => void }) {
  const serverDir = opts.serverDir ?? join(dirname(process.execPath), "..", "Resources", "app", "tile-service");
  const node = join(serverDir, "bin", process.platform === "win32" ? "node.exe" : "node");
  const available = existsSync(node) && existsSync(join(serverDir, "server.mjs"));
  const settingsPath = join(opts.stateDir, "tile-service.json");
  const logPath = join(opts.stateDir, "tile-service.log");
  /** EARTHDATA_TOKEN=<token>, when the app's environment has none. */
  const envFilePath = join(opts.stateDir, "tile-service.env");
  const say = opts.log ?? ((...parts: unknown[]) => console.log("[tile-service]", ...parts));

  let settings = { enabled: false, port: DEFAULT_PORT };
  try {
    const saved = JSON.parse(readFileSync(settingsPath, "utf8"));
    settings = { enabled: saved.enabled === true, port: validPort(saved.port) ? saved.port : DEFAULT_PORT };
  } catch { /* first launch: off */ }
  let state: State = "stopped";
  let message: string | undefined;
  let child: ChildProcess | null = null;
  let stopping = false;
  // Bumped by every start and stop, so a start still waiting for /health
  // knows it was overtaken.
  let generation = 0;

  const status = (): TileServiceStatus => ({
    available,
    enabled: settings.enabled,
    port: settings.port,
    state,
    url: state === "running" ? `http://localhost:${settings.port}` : undefined,
    message,
    pid: state === "running" || state === "starting" ? child?.pid : undefined,
    log: logPath,
  });
  const set = (next: State, msg?: string) => {
    state = next;
    message = msg;
    say(next, msg ?? "");
    opts.report(status());
  };
  const save = () => {
    try { mkdirSync(opts.stateDir, { recursive: true }); writeFileSync(settingsPath, JSON.stringify(settings)); } catch (e) { say("could not save the setting", String(e)); }
  };
  const writeLog = (chunk: unknown) => { try { appendFileSync(logPath, String(chunk)); } catch { /* a log */ } };
  const logTail = () => { try { return readFileSync(logPath, "utf8").slice(-400).trim(); } catch { return ""; } };

  async function health(port: number, timeoutMs: number): Promise<{ ok: boolean; tileService: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
      const body = await res.text();
      return { ok: res.ok, tileService: res.ok && body.includes('"direct"') };
    } catch {
      return { ok: false, tileService: false };
    } finally {
      clearTimeout(timer);
    }
  }

  async function start() {
    if (!available) { set("error", "This build has no tile service (Resources/app/tile-service is missing)."); return; }
    if (child) return;
    const gen = ++generation;
    const port = settings.port;
    set("starting");
    // Something already answers on the port: another tile service (one
    // started by hand, or another copy of the app), or another program.
    const there = await health(port, 1500);
    if (gen !== generation) return;
    if (there.ok || there.tileService) {
      set("error", there.tileService
        ? `Port ${port} is already served by another Terrain Viewer tile service (started outside this app). QGIS can use it as it is, or pick another port here.`
        : `Port ${port} is taken by another program: pick another port.`);
      return;
    }
    if (process.platform !== "win32") {
      // A copy or an unpacked archive may have dropped the executable bit.
      try { if (!(statSync(node).mode & 0o100)) chmodSync(node, 0o755); } catch { /* tried */ }
    }
    try { mkdirSync(opts.stateDir, { recursive: true }); writeFileSync(logPath, `${new Date().toISOString()} starting on 127.0.0.1:${port}\n`); } catch { /* a log */ }
    // The app's environment, EARTHDATA_TOKEN included (G-LiHT's protected
    // files through /proxy/earthdata). Without it in the environment, the
    // service reads EARTHDATA_TOKEN=<token> from tile-service.env in the
    // state dir, next to tile-service.json: that one key only, read at each
    // request, so a token written there works without a restart. The token
    // stays in this child: never in the page, a status or a tile address.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !["PORT", "NODE_OPTIONS", "TV_ENV_FILE"].includes(k)) env[k] = v;
    Object.assign(env, {
      PORT: String(port),
      TV_HOST: "127.0.0.1",
      TV_EXIT_WITH_STDIN: "1",
      TV_NO_BROWSER: "1",
      TV_ENV_FILE: envFilePath,
    });
    let proc: ChildProcess;
    try {
      proc = spawn(node, ["server.mjs"], { cwd: serverDir, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      set("error", `Could not start Node: ${String(e)}`);
      return;
    }
    child = proc;
    stopping = false;
    proc.stdout?.on("data", writeLog);
    proc.stderr?.on("data", writeLog);
    proc.on("error", (e) => writeLog(`spawn error: ${String(e)}\n`));
    proc.on("exit", (code, signal) => {
      if (child === proc) child = null;
      writeLog(`${new Date().toISOString()} exited (code ${code}, signal ${signal})\n`);
      if (stopping || gen !== generation) return; // stop() reports it
      set("error", `The tile service exited (code ${code ?? signal}). ${logTail().split("\n").slice(-3).join(" ")}`.trim());
    });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      if (gen !== generation || child !== proc) return;
      if ((await health(port, 2000)).tileService) {
        if (gen === generation && child === proc) set("running");
        return;
      }
    }
    if (gen === generation && child === proc) {
      stopNow();
      set("error", `No answer on port ${port} within 60 s. ${logTail()}`);
    }
  }

  function stopNow() {
    const proc = child;
    generation++;
    if (!proc) return;
    stopping = true;
    try { proc.stdin?.end(); } catch { /* gone */ }
    // The service stops when its input closes; if it does not, it is killed.
    setTimeout(() => { if (proc.exitCode === null && proc.signalCode === null) { try { proc.kill(); } catch { /* gone */ } } }, 3000);
  }

  async function stop() {
    if (!child) { set("stopped"); return; }
    set("stopping");
    const proc = child;
    stopNow();
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && proc.exitCode === null && proc.signalCode === null) await new Promise((r) => setTimeout(r, 100));
    if (child === proc) child = null;
    set("stopped");
  }

  return {
    status,
    /** At launch: start when it was left on. */
    init() {
      opts.report(status());
      if (settings.enabled) void start();
    },
    /** From the page: on, off, another port. */
    async update(next: { enabled?: unknown; port?: unknown }) {
      const wasEnabled = settings.enabled, wasPort = settings.port;
      if (typeof next.enabled === "boolean") settings.enabled = next.enabled;
      if (validPort(next.port)) settings.port = next.port as number;
      save();
      if (!settings.enabled) { if (wasEnabled || child) await stop(); else opts.report(status()); return; }
      if (child && settings.port !== wasPort) await stop();
      if (!child) await start();
      else opts.report(status());
    },
    /** When the app quits. */
    shutdown() { stopNow(); },
  };
}

function validPort(p: unknown): boolean {
  return typeof p === "number" && Number.isInteger(p) && p >= 1024 && p <= 65535;
}
