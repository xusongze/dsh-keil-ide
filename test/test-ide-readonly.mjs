// Read-only feature: the on-disk attribute, the host guards, and the badges'
// data source. The badge itself is asserted through the payloads the client
// consumes (tree rows, /read, project files).
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const home = await mkdtemp(path.join(tmpdir(), 'dsh-ide-ro-home-'));
process.env.DSH_HOME = home;

const lib = (f) => new URL(`../lib/${f}`, import.meta.url).href;
const { isReadOnly, setReadOnly } = await import(lib('util.js'));
const { loadProject } = await import(lib('project.js'));
const mod = await import(lib('index.js'));

let ok = true;
const check = (label, cond, extra) => {
  console.log('[' + label + ']', cond ? 'OK' : 'FAIL' + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};

// --- mount routes -------------------------------------------------------
const routes = new Map();
mod.apply({
  webServer: { register(r) { routes.set(r.path, r); return () => routes.delete(r.path); } },
  effect(cb) { cb(); },
  inject(_d, cb) { cb({ tools: { register: () => () => {} }, skills: { register: () => () => {} }, effect: (fn) => { fn(); return () => {}; }, get: () => undefined }); },
});

function mockReq(url, method = 'GET') {
  const listeners = {};
  return {
    url, method,
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:19387', 'content-type': 'application/json' },
    on(ev, cb) { listeners[ev] = cb; return this; },
    destroy() {},
    _emit(ev, a) { if (listeners[ev]) listeners[ev](a); },
  };
}
function mockRes() {
  return { status: 0, body: '', writeHead(s) { this.status = s; }, end(c) { this.body = String(c ?? ''); } };
}
async function get(pathname, query = '') {
  const res = mockRes();
  await routes.get(pathname).handler(mockReq(pathname + query), res);
  return JSON.parse(res.body || '{}');
}
async function post(pathname, body) {
  const req = mockReq(pathname, 'POST');
  const res = mockRes();
  const p = routes.get(pathname).handler(req, res);
  req._emit('data', Buffer.from(JSON.stringify(body), 'utf8'));
  req._emit('end');
  await p;
  return JSON.parse(res.body || '{}');
}

// --- fixtures -----------------------------------------------------------
const root = await mkdtemp(path.join(tmpdir(), 'dsh-ide-ro-'));
const libDir = path.join(root, 'Library');
await mkdir(path.join(libDir, 'nested'), { recursive: true });
const aC = path.join(libDir, 'a.c');
const bH = path.join(libDir, 'b.h');
const deepC = path.join(libDir, 'nested', 'deep.c');
const userC = path.join(root, 'main.c');
for (const p of [aC, bH, deepC, userC]) await writeFile(p, 'int x;\n', 'utf8');

// --- attribute round-trip ----------------------------------------------
check('ro-default-writable', (await isReadOnly(userC)) === false);
await setReadOnly(userC, true);
check('ro-set', (await isReadOnly(userC)) === true);
check('ro-mode-bit', ((await stat(userC)).mode & 0o200) === 0);
await setReadOnly(userC, false);
check('ro-clear', (await isReadOnly(userC)) === false);
check('ro-missing-file', (await isReadOnly(path.join(root, 'nope.c'))) === false);

// --- /dsh-ide/list reports readOnly ------------------------------------
await setReadOnly(aC, true);
let r = await get('/dsh-ide/list', '?path=' + encodeURIComponent(libDir));
const rowA = (r.files || []).find((f) => f.name === 'a.c');
const rowB = (r.files || []).find((f) => f.name === 'b.h');
check('list-flag-true', rowA && rowA.readOnly === true, JSON.stringify(rowA));
check('list-flag-false', rowB && rowB.readOnly === false, JSON.stringify(rowB));
check('list-dirs-unaffected', (r.dirs || []).length === 1 && r.dirs[0].name === 'nested');

// --- /dsh-ide/read reports readOnly ------------------------------------
r = await get('/dsh-ide/read', '?path=' + encodeURIComponent(aC));
check('read-flag-true', r.ok === true && r.readOnly === true && r.content === 'int x;\n', JSON.stringify({ ro: r.readOnly }));
r = await get('/dsh-ide/read', '?path=' + encodeURIComponent(bH));
check('read-flag-false', r.ok === true && r.readOnly === false);

// --- /dsh-ide/write refuses a protected file ---------------------------
r = await post('/dsh-ide/write', { path: aC, content: 'int changed;\n' });
check('write-blocked', r.ok === false && r.readOnly === true && r.status !== 200, JSON.stringify(r));
check('write-blocked-status', (await readFile(aC, 'utf8')) === 'int x;\n');
r = await post('/dsh-ide/write', { path: aC, content: 'int forced;\n', force: true });
check('write-forced', r.ok === true && r.forced === true, JSON.stringify(r));
check('write-forced-applied', (await readFile(aC, 'utf8')) === 'int forced;\n');
check('write-forced-stays-protected', (await isReadOnly(aC)) === true, 'a forced write must not silently unlock the file');
r = await post('/dsh-ide/write', { path: bH, content: 'int free;\n' });
check('write-writable-ok', r.ok === true && (await readFile(bH, 'utf8')) === 'int free;\n');

// --- /dsh-ide/readonly: file, then directory (recursive) ---------------
r = await post('/dsh-ide/readonly', { path: bH, readOnly: true });
check('readonly-file', r.ok === true && r.readOnly === true && r.changed === 1, JSON.stringify(r));
check('readonly-file-applied', (await isReadOnly(bH)) === true);

r = await post('/dsh-ide/readonly', { path: libDir, readOnly: true });
check('readonly-dir', r.ok === true && r.changed >= 3, JSON.stringify(r));
check('readonly-dir-recursive', (await isReadOnly(deepC)) === true, 'nested file must be covered');
check('readonly-dir-covers-all', (await isReadOnly(aC)) && (await isReadOnly(bH)));
check('readonly-dir-skips-other', (await isReadOnly(userC)) === false, 'a file outside the directory must stay writable');

r = await post('/dsh-ide/readonly', { path: libDir, readOnly: false });
check('readonly-dir-clear', r.ok === true && (await isReadOnly(aC)) === false && (await isReadOnly(deepC)) === false);

r = await post('/dsh-ide/readonly', { path: path.join(root, 'missing'), readOnly: true });
check('readonly-missing', r.ok === false && /not found/.test(r.error || ''), JSON.stringify(r));

// --- a project marks its protected files -------------------------------
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<Project xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Targets>
    <Target>
      <TargetName>Target 1</TargetName>
      <Device>STM32F103C8</Device>
      <TargetOption>
        <TargetCommonOption><OutputDirectory>.\\Objects\\</OutputDirectory><OutputName>P</OutputName><IncludePath></IncludePath></TargetCommonOption>
        <TargetArmAds><Cads><VariousControls><Define>D</Define><IncludePath>.\\Library</IncludePath></VariousControls></Cads></TargetArmAds>
      </TargetOption>
      <Groups>
        <Group><GroupName>Library</GroupName><Files>
          <File><FileName>a.c</FileName><FileType>1</FileType><FilePath>.\\Library\\a.c</FilePath></File>
        </Files></Group>
        <Group><GroupName>User</GroupName><Files>
          <File><FileName>main.c</FileName><FileType>1</FileType><FilePath>.\\main.c</FilePath></File>
        </Files></Group>
      </Groups>
    </Target>
  </Targets>
</Project>
`;
const projPath = path.join(root, 'Project.uvprojx');
await writeFile(projPath, XML, 'utf8');
await setReadOnly(aC, true);

const project = await loadProject(projPath);
const files = project.targets[0].groups.flatMap((g) => g.files);
const fileA = files.find((f) => f.name === 'a.c');
const fileMain = files.find((f) => f.name === 'main.c');
check('project-flag-true', fileA && fileA.readOnly === true, JSON.stringify(fileA));
check('project-flag-false', fileMain && fileMain.readOnly === false, JSON.stringify(fileMain));
check('project-abs-kept', fileA && fileA.abs === aC);
check('project-lossless', !files.some((f) => f.readOnly === undefined));

await rm(root, { recursive: true, force: true });
await rm(home, { recursive: true, force: true });
console.log(ok ? 'READONLY CHECKS OK' : 'READONLY CHECKS FAILED');
process.exit(ok ? 0 : 1);
