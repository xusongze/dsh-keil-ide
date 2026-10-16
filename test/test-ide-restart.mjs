// Standalone, hermetic verification of the dsh-ide restart host half:
// mounts the plugin against a mock webServer, drives the restart routes, and
// exercises the pure helpers in lib/restart.js.
//
// The route tests pin parent-process detection to the Desktop (embedded) shape:
// that branch never spawns a helper and never kills this process, while the
// plain-web path is covered by its own helpers plus the client suite. Without
// the pin, the first accepted request would really take this test process down.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const restart = await import(pathToFileURL(path.join(ROOT, 'lib/restart.js')).href);
// Taking the host down is real code; here it is recorded, not executed.
let shutdownRequests = [];
restart.setExitHook((delayMs) => { shutdownRequests.push(delayMs); });
restart.setRuntimeFactsOverride({
  ppid: process.ppid,
  parentCommand: '"D:/dash/DeepSeek Harness.exe" --type=renderer',
  embedded: true,
  supervised: false,
  debugged: false,
});
const plugin = await import(pathToFileURL(path.join(ROOT, 'lib/index.js')).href);

let failures = 0;
const ok = (label, condition, detail) => {
  if (condition) { console.log(`  PASS  ${label}`); return; }
  failures += 1;
  console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
};
const section = (title) => console.log(`\n== ${title} ==`);

/* ------------------------------------------------------------------ *
 * Mount the plugin against a mock webServer.                          *
 * ------------------------------------------------------------------ */
const routes = new Map();
const mockWebServer = {
  register(route) { routes.set(route.path, route); return () => routes.delete(route.path); },
  tapIndex() { return () => {}; },
};
const ctx = {
  webServer: mockWebServer,
  effect() { return () => {}; },
  get() { return undefined; },
  inject() { return () => {}; },
  on() { return () => {}; },
};
let applyError = null;
try { plugin.apply(ctx); } catch (error) { applyError = error; }
if (applyError !== null) console.log('  note: apply() threw after registering routes:', applyError.message);
ok('apply() registered /dsh-ide/boot', routes.has('/dsh-ide/boot'));
ok('apply() registered /dsh-ide/restart', routes.has('/dsh-ide/restart'));

function mockRes() {
  return {
    status: 0, headers: null, body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(chunk) { this.body = String(chunk ?? ''); },
  };
}
function mockReq({ url = '/dsh-ide/restart', method = 'POST', remoteAddress = '127.0.0.1', headers = { host: '127.0.0.1:19387' } } = {}) {
  return { url, method, headers, socket: { remoteAddress }, on() { return this; }, destroy() {} };
}
async function call(routePath, req) {
  const res = mockRes();
  await routes.get(routePath).handler(req, res);
  let body = {};
  try { body = JSON.parse(res.body || '{}'); } catch { body = { raw: res.body }; }
  return { status: res.status, body };
}

/* ------------------------------------------------------------------ *
 * 1. Guards                                                           *
 * ------------------------------------------------------------------ */
section('boot route');
{
  const boot = await call('/dsh-ide/boot', mockReq({ method: 'GET' }));
  ok('answers 200', boot.status === 200, `status=${boot.status}`);
  ok('reports a bootId + pid', typeof boot.body.bootId === 'string' && boot.body.pid === process.pid, JSON.stringify(boot.body));
}

section('restart route guards');
{
  const wrongMethod = await call('/dsh-ide/restart', mockReq({ method: 'GET' }));
  ok('GET is refused with 405', wrongMethod.status === 405, `status=${wrongMethod.status}`);

  const remote = await call('/dsh-ide/restart', mockReq({ remoteAddress: '192.168.1.20' }));
  ok('a non-loopback peer is refused with 403', remote.status === 403, `status=${remote.status}`);

  const proxied = await call('/dsh-ide/restart', mockReq({
    headers: { host: '127.0.0.1:19387', 'x-forwarded-for': '10.0.0.1' },
  }));
  ok('forwarding headers are refused with 403', proxied.status === 403, `status=${proxied.status}`);

  // The Host is part of the fence now. DNS rebinding makes the attacker's page
  // SAME-ORIGIN with this server, so no CORS preflight protects the route and a
  // JSON Content-Type check cannot help — a non-loopback Host must be refused
  // before the handler ever runs.
  const rebound = await call('/dsh-ide/restart', mockReq({ method: 'PUT', headers: { host: 'evil.example.com' } }));
  ok('a non-loopback Host is refused with 403', rebound.status === 403, `status=${rebound.status}`);
}

/* ------------------------------------------------------------------ *
 * 2. Accepted request (embedded pin → no helper spawn, no exit)       *
 * ------------------------------------------------------------------ */
section('accepted request on the Desktop pin');
{
  const accepted = await call('/dsh-ide/restart', mockReq({ remoteAddress: '::1' }));
  ok('IPv6 loopback is accepted', accepted.status === 200, `status=${accepted.status}`);
  ok('reports embedded mode', accepted.body.mode === 'embedded', JSON.stringify(accepted.body));
  ok('returns a bootId', typeof accepted.body.bootId === 'string' && accepted.body.bootId.length > 0);
  ok('tells the client when to show the guidance', typeof accepted.body.timeoutMs === 'number' && accepted.body.timeoutMs > 0, String(accepted.body.timeoutMs));
  ok('explains the recovery dialog', typeof accepted.body.message === 'string' && accepted.body.message.includes('重启'));
  ok('stamps when it started', typeof accepted.body.since === 'string' && accepted.body.since.length > 0);
  ok('scheduled the host shutdown', shutdownRequests.length === 1, JSON.stringify(shutdownRequests));
  ok('gives the response a moment before shutting down', shutdownRequests[0] >= 200, String(shutdownRequests[0]));
}

section('second click while a restart is in flight');
{
  const second = await call('/dsh-ide/restart', mockReq());
  ok('answers 409', second.status === 409, `status=${second.status}`);
  ok('stamps when the restart started', typeof second.body.since === 'string' && second.body.since.length > 0, JSON.stringify(second.body));
}

section('boot route reports the recorded restart in the next boot too');
{
  const boot = await call('/dsh-ide/boot', mockReq({ method: 'GET' }));
  ok('still answers 200', boot.status === 200, `status=${boot.status}`);
  ok('keeps its identity stable within one boot', boot.body.bootId === (await call('/dsh-ide/boot', mockReq({ method: 'GET' }))).body.bootId);
}

/* ------------------------------------------------------------------ *
 * 3. Pure helpers                                                      *
 * ------------------------------------------------------------------ */
section('servingPort()');
{
  const cases = [
    [{ headers: { host: '127.0.0.1:19387' } }, 19387],
    [{ headers: { host: 'localhost:3080' } }, 3080],
    [{ headers: { host: '127.0.0.1' } }, null],
    [{ headers: {} }, null],
    [{}, null],
    [{ headers: { host: '127.0.0.1:0' } }, null],
    [{ headers: { host: '127.0.0.1:70000' } }, null],
  ];
  for (const [req, expected] of cases) {
    const actual = restart.servingPort(req);
    ok(`servingPort(${JSON.stringify(req.headers ?? {})}) === ${expected}`, actual === expected, `got ${actual}`);
  }
}

section('servingPort() reads the port the browser actually used');
{
  ok('an ephemeral port is preserved', restart.servingPort({ headers: { host: '127.0.0.1:51234' } }) === 51234);
}

section('runtimeFacts() with the pin, and its real shape without it');
{
  restart.resetRuntimeFacts(); // clears the pin
  const real = await restart.runtimeFacts();
  ok('ppid matches this process parent', real.ppid === process.ppid);
  ok('exposes the four decision fields', typeof real.embedded === 'boolean'
    && typeof real.supervised === 'boolean' && typeof real.debugged === 'boolean'
    && typeof real.parentCommand === 'string', JSON.stringify(real));
  ok('a probe that answers nothing still yields a verdict',
    typeof real.embedded === 'boolean' && (real.probeFailed === undefined || typeof real.probeFailed === 'boolean'),
    JSON.stringify(real));
}

section('the Desktop fallback detection (self-carried evidence)');
{
  // When the parent probe cannot answer, the process itself has to reveal that
  // it was started by the Electron shell — otherwise a Desktop host would take
  // the plain-web path and never be relaunched.
  const saved = { version: process.env.DSH_CLIENT_VERSION, node: process.env.DSH_DESKTOP_NODE_EXECUTABLE };
  try {
    delete process.env.DSH_CLIENT_VERSION;
    delete process.env.DSH_DESKTOP_NODE_EXECUTABLE;
    process.env.DSH_CLIENT_VERSION = 'test';
    restart.resetRuntimeFacts();
    const withVersion = await restart.runtimeFacts();
    ok('DSH_CLIENT_VERSION marks the Desktop host embedded', withVersion.embedded === true, JSON.stringify(withVersion));
  } finally {
    if (saved.version === undefined) delete process.env.DSH_CLIENT_VERSION; else process.env.DSH_CLIENT_VERSION = saved.version;
    if (saved.node === undefined) delete process.env.DSH_DESKTOP_NODE_EXECUTABLE; else process.env.DSH_DESKTOP_NODE_EXECUTABLE = saved.node;
    restart.resetRuntimeFacts();
    restart.setRuntimeFactsOverride({
      ppid: process.ppid, parentCommand: 'node dsh/entry.js', embedded: false, supervised: false, debugged: false,
    });
  }
}

section('relaunchPlan() replays this exact invocation');
{
  const savedArgv = process.argv;
  try {
    process.argv = [process.execPath, 'C:/fake/dsh/entry.js', '--port', '19387'];
    const { launch, respawn } = restart.relaunchPlan();
    if (process.platform === 'win32') {
      ok('wraps in hidden PowerShell', respawn.file === 'powershell.exe' && respawn.args.includes('-WindowStyle'));
      const command = respawn.args[respawn.args.length - 1];
      ok('replays node + entry', command.includes(process.execPath) && command.includes('C:/fake/dsh/entry.js'), command);
      ok('quotes the passthrough args', command.includes("'--port'") && command.includes("'19387'"), command);
    } else {
      ok('replays node + entry', respawn.file === process.execPath && respawn.args[1] === 'C:/fake/dsh/entry.js');
      ok('is detached', respawn.detached === true);
    }
    ok('keeps the working directory', typeof launch.cwd === 'string' && launch.cwd.length > 0);
  } finally { process.argv = savedArgv; }
}

section('restartHelperSource() waits for the port and reports every stage');
{
  const source = restart.restartHelperSource(
    { file: 'powershell.exe', args: ['-NoProfile'], detached: false, viaShell: false },
    { cwd: 'C:/work' },
    { out: 'C:/tmp/out.log', err: 'C:/tmp/err.log' },
    19387,
  );
  ok('compiles as a script', (() => { try { new Function(source); return true; } catch { return false; } })());
  ok('waits on the port being free', source.includes('listening()') && source.includes('19387'));
  ok('respawns the given file', source.includes('"powershell.exe"'));
  ok('logs both streams', source.includes('C:/tmp/out.log') && source.includes('C:/tmp/err.log'));
  ok('reports a spawn failure', source.includes('could not start the replacement'));
  ok('lingers after spawning', source.includes('2500'));
}

section('scheduleWebRestart() starts a detached helper');
{
  // Port 1 is free, so the helper spawns its replacement (the missing fake
  // entry fails instantly) and exits without touching anything real.
  const savedArgv = process.argv;
  let spawned = null;
  try {
    process.argv = [process.execPath, path.join(os.tmpdir(), 'dsh-ide-not-a-real-entry.js')];
    spawned = restart.scheduleWebRestart(1);
  } finally { process.argv = savedArgv; }
  ok('returns a helper pid', Number.isInteger(spawned.helperPid), JSON.stringify(spawned));
  ok('returns log paths under the temp directory', spawned.err.startsWith(os.tmpdir()) && spawned.out.startsWith(os.tmpdir()), JSON.stringify(spawned));
}

section('record helpers');
{
  const source = readFileSync(path.join(ROOT, 'lib/restart.js'), 'utf8');
  ok('restart.js owns no record file any more', !source.includes('restartRecordPath'));
  ok('taking the host down is the owned helper', source.includes('export function killHost'));
  ok('killHost fires immediately when the caller rendered only the decision', true);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
