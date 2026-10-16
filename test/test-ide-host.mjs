// Standalone verification of the dsh-keil-ide host half: mounts the plugin
// against a mock webServer, then exercises each route handler with mock
// request/response objects.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

const mod = await import(new URL('../lib/index.js', import.meta.url).href);

// Mock webServer that captures registered routes.
const routes = new Map();
const mockWebServer = {
  register(route) {
    routes.set(route.path, route);
    return () => { routes.delete(route.path); };
  },
};

const disposers = [];
const mockCtx = {
  webServer: mockWebServer,
  effect(cb) { disposers.push(cb); },
};

const dispose = mod.apply(mockCtx);
console.log('registered routes:', [...routes.keys()].join(', '));

// Build mock req/res.
function mockReq(url, method = 'GET', body = undefined) {
  const listeners = {};
  const req = {
    url,
    method,
    // The route fence requires a loopback peer, a loopback Host and a JSON body.
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:19387', 'content-type': 'application/json' },
    on(ev, cb) { listeners[ev] = cb; return this; },
    destroy() {},
    _emit(ev, arg) { if (listeners[ev]) listeners[ev](arg); },
  };
  return req;
}
function mockRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(chunk) { this.body = String(chunk ?? ''); },
  };
}
async function invoke(route, req) {
  const res = mockRes();
  await route.handler(req, res);
  return { status: res.status, body: JSON.parse(res.body || '{}') };
}
// Feed a body to the readBody helper.
function feedBody(req, text) {
  const buf = Buffer.from(text, 'utf8');
  req._emit('data', buf);
  req._emit('end');
}
// Invoke a POST handler whose body is read via readBody: start the handler
// (which registers body listeners synchronously), then feed the body.
async function invokePost(route, bodyObj) {
  const req = mockReq(route.path, 'POST');
  const res = mockRes();
  const p = route.handler(req, res);
  feedBody(req, JSON.stringify(bodyObj));
  await p;
  return { status: res.status, body: JSON.parse(res.body || '{}') };
}

// --- prepare a temp workspace with a .c and .h file ---
const dir = await mkdtemp(path.join(tmpdir(), 'dsh-ide-test-'));
await writeFile(path.join(dir, 'main.c'), 'int main(void){ return 0; }\n');
await writeFile(path.join(dir, 'util.h'), '#pragma once\n');
console.log('temp dir:', dir);

// info
let r = await invoke(routes.get('/dsh-ide/info'), mockReq('/dsh-ide/info'));
console.log('[info] status', r.status, 'cwd', r.body.cwd);

// list
r = await invoke(routes.get('/dsh-ide/list'), mockReq('/dsh-ide/list?path=' + encodeURIComponent(dir)));
console.log('[list] status', r.status, 'dirs', r.body.dirs, 'files', r.body.files.map(f => f.name));

// read
r = await invoke(routes.get('/dsh-ide/read'), mockReq('/dsh-ide/read?path=' + encodeURIComponent(path.join(dir, 'main.c'))));
console.log('[read] status', r.status, 'content', JSON.stringify(r.body.content));

// read a GBK-encoded source file (legacy zh-CN project layout): the Chinese
// comment must survive as text, not as replacement characters.
{
  const gbkComment = Buffer.from([0x2f, 0x2f, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0xd7, 0xa2, 0xca, 0xcd, 0x0a]); // "// 中文注释\n"
  await writeFile(path.join(dir, 'gbk.c'), gbkComment);
  r = await invoke(routes.get('/dsh-ide/read'), mockReq('/dsh-ide/read?path=' + encodeURIComponent(path.join(dir, 'gbk.c'))));
  const got = r.body.content;
  const want = '// 中文注释\n';
  console.log('[read-gbk] status', r.status, 'content', JSON.stringify(got), got === want ? 'OK' : 'MISMATCH (expected ' + JSON.stringify(want) + ')');
}

// write
{
  const wr = await invokePost(routes.get('/dsh-ide/write'), { path: path.join(dir, 'main.c'), content: 'int main(void){ return 7; }\n' });
  console.log('[write] status', wr.status, 'body', JSON.stringify(wr.body));
}
r = await invoke(routes.get('/dsh-ide/read'), mockReq('/dsh-ide/read?path=' + encodeURIComponent(path.join(dir, 'main.c'))));
console.log('[read-after-write]', JSON.stringify(r.body.content));

// compile (echo command, no real compiler needed)
{
  const cr = await invokePost(routes.get('/dsh-ide/compile'), { file: path.join(dir, 'main.c'), command: 'echo compiling {name}' });
  console.log('[compile] status', cr.status, 'command', cr.body.command, 'exit', cr.body.exitCode, 'stdout', JSON.stringify((cr.body.stdout || '').trim()));
}

// default gcc command expansion
{
  const cr = await invokePost(routes.get('/dsh-ide/compile'), { file: path.join(dir, 'main.c') });
  console.log('[compile-default] command', cr.body.command, 'exit', cr.body.exitCode, 'stderr-first-line', String(cr.body.stderr).split('\n')[0]);
}

// error path: missing path
r = await invoke(routes.get('/dsh-ide/read'), mockReq('/dsh-ide/read?path='));
console.log('[read-missing] status', r.status, 'error', r.body.error);

// caret state mirror: POST then GET, and confirm the Agent-readable file exists.
{
  const target = path.join(dir, 'main.c');
  const wr = await invokePost(routes.get('/dsh-ide/state'), { file: target, line: 42, col: 7, selStart: 40, selEnd: 44 });
  console.log('[state-post] status', wr.status, 'ok', wr.body.ok);
  const rd = await invoke(routes.get('/dsh-ide/state'), mockReq('/dsh-ide/state'));
  const st = rd.body.state || {};
  const good = st.file === target && st.line === 42 && st.col === 7 && st.selStart === 40 && st.selEnd === 44;
  console.log('[state-get]', good ? 'OK' : 'MISMATCH', JSON.stringify({ file: st.file === target ? '<target>' : st.file, line: st.line, col: st.col, sel: [st.selStart, st.selEnd] }));
  if (!good) process.exitCode = 1;

  const statePath = path.join(process.env.DSH_HOME || path.join(homedir(), '.dsh'), 'dsh-ide-state.json');
  const onDisk = await readFile(statePath, 'utf8').then((t) => JSON.parse(t)).catch(() => null);
  console.log('[state-file]', onDisk && onDisk.line === 42 ? 'OK' : 'MISSING', statePath);
  if (!onDisk || onDisk.line !== 42) process.exitCode = 1;
}

// cleanup
dispose();
console.log('routes after dispose:', routes.size);
await rm(dir, { recursive: true, force: true });
console.log('ALL CHECKS DONE');
