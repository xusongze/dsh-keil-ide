/**
 * dsh-keil-ide — Host restart support.
 *
 * Two runtimes, two honest answers:
 *
 *  - Plain `dsh web` / `dsh` CLI: this process IS the harness. A detached
 *    helper outlives it, waits for the web port to be released, then respawns
 *    the exact same invocation — a real one-click restart.
 *
 *  - The official Desktop app: this host is a CHILD of the Electron shell
 *    (`DeepSeek Harness.exe` -> `node .../dsh-desktop-host/lib/index.js`).
 *    Neither the shell nor DSH exposes a restart channel to plugins:
 *    `app.relaunch()` lives in the shell's own main process, the child IPC
 *    contract has no restart message, and the renderer has no such IPC. So a
 *    plugin cannot relaunch the app by itself — and killing the host without
 *    that relaunch would only leave a headless app behind.
 *
 *    What this module does instead is exit the host deliberately: the shell
 *    treats a stopped host as a fatal failure and offers its recovery dialog,
 *    whose default button is "重启" (restart). One click there brings the app
 *    back with the freshly loaded plugin.
 */
import { spawn, execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** How long the replacement gets to bind its port before the helper gives up waiting. */
const PORT_WAIT_MS = 30000;
/** Child of a restarted host: linger briefly so Windows does not take it down with the helper. */
const LINGER_MS = 2500;

/* ==================================================================== *
 * Runtime detection                                                     *
 * ==================================================================== */

let cachedParent = null;
/** Test hook: pins detection instead of probing a real parent process. */
let parentOverride;

/** @internal test hook — production callers use `runtimeFacts()` only. */
export function setRuntimeFactsOverride(value) {
  parentOverride = value;
  cachedParent = null;
}

/**
 * Command line of a process, or '' when it cannot be read. Windows has no
 * /proc, so PowerShell is asked for the one field — a best-effort probe whose
 * failure must never change the restart decision on its own.
 */
function processCommandLine(pid) {
  if (process.platform !== 'win32') return Promise.resolve('');
  return new Promise((resolve) => {
    const script = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}").CommandLine`;
    let child;
    try {
      child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true, timeout: 2500, maxBuffer: 256 * 1024,
      }, (error, stdout) => resolve(error ? '' : String(stdout || '').trim()));
    } catch {
      resolve('');
      return;
    }
    child.on('error', () => resolve(''));
  });
}

/**
 * Whether this process was started by the Electron shell, judged from what the
 * process itself carries. This matters because the parent probe above can time
 * out: an empty answer must not read as "plain web host", or the Desktop app
 * would be left headless with no replacement.
 */
function selfLooksEmbedded() {
  const where = process.argv[1] || '';
  if (/dsh-desktop-host/iu.test(where)) return true;
  if (process.env.DSH_CLIENT_VERSION || process.env.DSH_DESKTOP_NODE_EXECUTABLE) return true;
  // The Electron shell hands the host its own executable through PATH.
  const pathValue = process.env.PATH || '';
  return /DeepSeek Harness/iu.test(pathValue);
}

/**
 * Facts about the process that launched this host. `embedded` is the only
 * field the restart paths branch on.
 */
export async function runtimeFacts() {
  if (parentOverride !== undefined) return parentOverride;
  if (cachedParent === null) {
    const command = await processCommandLine(process.ppid);
    // The shell spawns `node .../dsh-desktop-host/lib/index.js <runtimeDir> …`.
    const fromParent = /dsh-desktop-host/iu.test(command) || /DeepSeek Harness\.exe/iu.test(command);
    cachedParent = {
      ppid: process.ppid,
      parentCommand: command,
      embedded: fromParent || selfLooksEmbedded(),
      // A supervisor owns restarts; killing the host under one is a service outage.
      supervised: Boolean(process.env.INVOCATION_ID || process.env.JOURNAL_STREAM || process.env.PM_ID),
      debugged: process.execArgv.some((arg) => /^--inspect|^--debug/u.test(arg))
        || /--inspect|--debug/u.test(process.env.NODE_OPTIONS || ''),
    };
    if (command === '') cachedParent.probeFailed = true;
  }
  return cachedParent;
}

/** Warm the probe so the first click does not wait on PowerShell. */
export function prefetchRuntimeFacts() {
  runtimeFacts().catch(() => {});
}

/* ==================================================================== *
 * Taking the host down                                                 *
 * ==================================================================== */

let exitHook;

/** @internal test hook — lets a suite drive the restart without dying. */
export function setExitHook(hook) {
  exitHook = hook;
}

/**
 * Stop this host for real. SIGTERM first, then a hard exit as a backstop: the
 * shutdown path is the one place a plugin must not hang, because the process
 * that would report the hang is the process being replaced.
 */
export function killHost(delayMs) {
  if (typeof exitHook === 'function') { exitHook(delayMs); return; }
  const timer = setTimeout(() => {
    try { process.kill(process.pid, 'SIGTERM'); } catch { /* already gone */ }
    setTimeout(() => process.exit(0), 700);
  }, delayMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

/** Drop the cached probe (used by the tests). */
export function resetRuntimeFacts() {
  cachedParent = null;
  if (parentOverride !== undefined) parentOverride = undefined;
}

/* ==================================================================== *
 * Web-mode relaunch                                                     *
 * ==================================================================== */

/**
 * Source of the detached helper that outlives this host and starts the
 * replacement once the port is free.
 *
 * Waiting on the port instead of a fixed delay is what makes the difference
 * between a restart that works and one that dies on EADDRINUSE, and every
 * stage is logged to a file because the process that would have reported a
 * failure is the one that just exited.
 */
export function restartHelperSource(respawn, launch, logs, port) {
  return [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "const net = require('node:net')",
    `const file = ${JSON.stringify(respawn.file)}`,
    `const args = ${JSON.stringify(respawn.args)}`,
    `const cwd = ${JSON.stringify(launch.cwd)}`,
    `const detached = ${JSON.stringify(respawn.detached)}`,
    `const viaShell = ${JSON.stringify(respawn.viaShell)}`,
    `const logOut = ${JSON.stringify(logs.out)}`,
    `const logErr = ${JSON.stringify(logs.err)}`,
    `const port = ${JSON.stringify(port)}`,
    "const sleep = (ms) => new Promise((r) => setTimeout(r, ms))",
    "const note = (line) => { try { fs.appendFileSync(logErr, `[dsh-ide] ${line}\\n`) } catch {} }",
    'process.on("uncaughtException", (error) => note("helper crashed: " + (error && error.stack ? error.stack : error)))',
    'process.on("unhandledRejection", (error) => note("helper rejection: " + (error && error.stack ? error.stack : error)))',
    // Connectivity, not binding: binding to test would itself hold the port at
    // the exact moment the replacement needs it.
    'const listening = () => new Promise((resolve) => {',
    '  const probe = net.connect({ host: "127.0.0.1", port })',
    '  let settled = false',
    '  const done = (value) => { if (settled) return; settled = true; probe.destroy(); resolve(value) }',
    '  probe.on("connect", () => done(true))',
    '  probe.on("error", () => done(false))',
    '  setTimeout(() => done(false), 500)',
    '})',
    'const main = async () => {',
    '  note(`helper up (pid ${process.pid}) for port ${port}`)',
    `  const until = Date.now() + ${PORT_WAIT_MS}`,
    '  while (Date.now() < until && await listening()) await sleep(250)',
    '  if (await listening()) note(`port ${port} still in use after the wait; starting anyway`)',
    // A released socket can sit in TIME_WAIT for a moment on Windows.
    '  await sleep(300)',
    '  note(`port ${port} is free; starting the replacement`)',
    '  let child',
    '  try {',
    '    const out = fs.openSync(logOut, "a")',
    '    const err = fs.openSync(logErr, "a")',
    '    child = spawn(file, args, { cwd, detached, stdio: ["ignore", out, err], env: process.env, shell: viaShell, windowsHide: true })',
    '  } catch (error) {',
    '    note("could not start the replacement: " + (error && error.message ? error.message : error))',
    '    return',
    '  }',
    // spawn reports a missing executable asynchronously; without this listener
    // that failure is exactly as silent as the bug this helper exists to avoid.
    '  child.on("error", (error) => note("could not start the replacement: " + (error && error.message ? error.message : error)))',
    '  note(`replacement started (pid ${child.pid})`)',
    '  child.unref()',
    // Outliving the spawn matters on Windows: a helper that exits the instant
    // it has spawned can take a child in its process group with it.
    `  await sleep(${LINGER_MS})`,
    '  note("helper done")',
    '}',
    'main()',
  ].join('\n');
}

/** The invocation a restart must replay, plus its PowerShell wrapping on Windows. */
export function relaunchPlan() {
  const entry = process.argv[1];
  const passthrough = process.argv.slice(2);
  if (process.platform !== 'win32') {
    return { launch: { cwd: process.cwd() }, respawn: { file: process.execPath, args: [entry, ...passthrough], detached: true, viaShell: false } };
  }
  // A detached spawn maps to DETACHED_PROCESS on Windows: no console at all,
  // which makes console children of the new host flash their own windows.
  // Hidden PowerShell gives the host a console its children inherit silently.
  const quote = (part) => `'${String(part).replace(/'/g, "''")}'`;
  return {
    launch: { cwd: process.cwd() },
    respawn: {
      file: 'powershell.exe',
      args: ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ['&', quote(process.execPath), quote(entry), ...passthrough.map(quote)].join(' ')],
      detached: false,
      viaShell: false,
    },
  };
}

/**
 * Start the detached helper that will bring a fresh host up, then leave this
 * one to shut down. Returns the log paths so the caller can report them.
 */
export function scheduleWebRestart(port) {
  const { launch, respawn } = relaunchPlan();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logs = {
    out: path.join(tmpdir(), `dsh-ide-restart-${stamp}.out.log`),
    err: path.join(tmpdir(), `dsh-ide-restart-${stamp}.err.log`),
  };
  const helper = spawn(process.execPath, ['-e', restartHelperSource(respawn, launch, logs, port)], {
    detached: true, stdio: 'ignore', env: process.env, windowsHide: true,
  });
  helper.on('error', () => { /* reported through the response's `logs.err` */ });
  helper.unref();
  return { helperPid: helper.pid, ...logs };
}

/* ==================================================================== *
 * Port of the request that asked for the restart                        *
 * ==================================================================== */

/** The port the browser actually reached us on; the replacement must take it over. */
export function servingPort(req) {
  const host = req && req.headers ? req.headers.host : undefined;
  if (typeof host !== 'string') return null;
  const match = /:(\d{1,5})$/u.exec(host);
  if (match === null) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}
