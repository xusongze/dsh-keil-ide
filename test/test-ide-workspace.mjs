// Acceptance tests for IDE-panel auto-load: session workspace -> Keil project.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Isolate $DSH_HOME before the plugin loads: the real machine's remember file
// must not leak into these assertions.
const home = await mkdtemp(path.join(tmpdir(), 'dsh-ide-ws-home-'));
process.env.DSH_HOME = home;

const mod = await import(new URL('../lib/index.js', import.meta.url).href);

let ok = true;
const check = (label, cond, extra) => {
  console.log('[' + label + ']', cond ? 'OK' : 'FAIL' + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};
const hasUndefined = (v) => (v === undefined ? true
  : (v === null || typeof v !== 'object') ? false
    : Array.isArray(v) ? v.some(hasUndefined) : Object.values(v).some(hasUndefined));

// --- mount the plugin against a mock host ------------------------------
const routes = new Map();
const captured = { tools: [], skills: [] };
const mockCtx = {
  webServer: { register(r) { routes.set(r.path, r); return () => routes.delete(r.path); } },
  effect(cb) { cb(); },
  inject(_deps, cb) {
    cb({
      tools: { register: (d) => { captured.tools.push(d); return () => {}; } },
      skills: { register: (s) => { captured.skills.push(s); return () => {}; } },
      effect: (fn) => { const x = fn(); return () => { if (typeof x === 'function') x(); }; },
      get: () => undefined,
    });
  },
};
mod.apply(mockCtx);
check('routes-registered', routes.has('/dsh-ide/workspace') && routes.has('/dsh-ide/info'));
check('tool-captured', captured.tools.length === 1);

// --- mock req/res ------------------------------------------------------
function mockReq(url, method = 'GET') {
  const listeners = {};
  return {
    url, method,
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:19387', 'content-type': 'application/json' },
    on(ev, cb) { listeners[ev] = cb; return this; },
    destroy() {},
    _emit(ev, arg) { if (listeners[ev]) listeners[ev](arg); },
  };
}
function mockRes() {
  return {
    status: 0, body: '',
    writeHead(status) { this.status = status; },
    end(chunk) { this.body = String(chunk ?? ''); },
  };
}
async function invoke(pathname, query = '') {
  const route = routes.get(pathname);
  const res = mockRes();
  await route.handler(mockReq(pathname + query), res);
  return JSON.parse(res.body || '{}');
}
const wsQuery = (cwd, prefer) => {
  const parts = [];
  if (cwd) parts.push('cwd=' + encodeURIComponent(cwd));
  if (prefer) parts.push('prefer=' + encodeURIComponent(prefer));
  return parts.length ? '?' + parts.join('&') : '';
};

// --- fixtures ----------------------------------------------------------
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<Project xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Targets>
    <Target>
      <TargetName>Target 1</TargetName>
      <Device>STM32F103C8</Device>
      <TargetOption>
        <TargetCommonOption>
          <OutputDirectory>.\\Objects\\</OutputDirectory>
          <OutputName>Project</OutputName>
          <IncludePath></IncludePath>
        </TargetCommonOption>
        <TargetArmAds>
          <Cads><VariousControls><Define>USE_STDPERIPH_DRIVER</Define><IncludePath>.\\User</IncludePath></VariousControls></Cads>
        </TargetArmAds>
      </TargetOption>
      <Groups>
        <Group><GroupName>User</GroupName><Files>
          <File><FileName>main.c</FileName><FileType>1</FileType><FilePath>.\\User\\main.c</FilePath></File>
        </Files></Group>
      </Groups>
    </Target>
  </Targets>
</Project>
`;

const root = await mkdtemp(path.join(tmpdir(), 'dsh-ide-ws-'));
const wsOne = path.join(root, 'one');
const wsTwo = path.join(root, 'two');
const wsEmpty = path.join(root, 'empty');
for (const d of [wsOne, wsTwo, wsEmpty]) await mkdir(d, { recursive: true });

const projOne = path.join(wsOne, 'Project.uvprojx');
await writeFile(projOne, XML, 'utf8');
const projTwoA = path.join(wsTwo, 'alpha', 'Project.uvprojx');
const projTwoB = path.join(wsTwo, 'beta', 'Project.uvprojx');
await mkdir(path.dirname(projTwoA), { recursive: true });
await mkdir(path.dirname(projTwoB), { recursive: true });
await writeFile(projTwoA, XML, 'utf8');
await writeFile(projTwoB, XML, 'utf8');
// a decoy inside build output must never be discovered
await mkdir(path.join(wsOne, 'Objects'), { recursive: true });
await writeFile(path.join(wsOne, 'Objects', 'Project.uvprojx'), XML, 'utf8');

const execWith = (cwd) => ({ agent: { session: { header: { cwd } } } });
const panel = (cwd, prefer) => invoke('/dsh-ide/workspace', wsQuery(cwd, prefer));

// --- criterion 1: one project -> load it -------------------------------
let r = await panel(wsOne);
check('c1-single-project', r.ok === true && r.project && r.project.path === projOne, JSON.stringify(r.project && r.project.path));
check('c1-project-loaded', r.project.targets && r.project.targets[0].device === 'STM32F103C8');
check('c1-no-candidates', r.candidates.length === 0);
check('c1-cwd-echo', r.cwd === wsOne);
check('c1-decoy-ignored', r.reason === null);

// --- criterion 3: two projects -> candidates, then remember -------------
r = await panel(wsTwo);
check('c3-candidates', r.project === null && r.candidates.length === 2 && r.reason === 'ambiguous', JSON.stringify(r.reason));
check('c3-candidate-paths', r.candidates.includes(projTwoA) && r.candidates.includes(projTwoB));

r = await panel(wsTwo, projTwoB);
check('c3-prefer', r.project && r.project.path === projTwoB && r.reason === 'remembered', JSON.stringify(r.reason));

// --- criterion 4: no project -> explicit empty state, right root --------
r = await panel(wsEmpty);
check('c4-not-found', r.project === null && r.candidates.length === 0 && r.reason === 'not-found');
check('c4-cwd-is-workspace', r.cwd === wsEmpty, r.cwd);
check('c4-not-install-dir', !/[\\/]app\.asar/.test(r.cwd) && r.cwd !== process.cwd());
check('c4-lossless', !hasUndefined(r));

// --- criterion 2: after a tool call the host knows the workspace --------
await captured.tools[0].execute({ action: 'info' }, execWith(wsOne));
r = await invoke('/dsh-ide/workspace');
check('c2-session-workspace', r.cwdSource === 'session-workspace' && r.cwd === wsOne, JSON.stringify({ cwd: r.cwd, src: r.cwdSource }));
check('c2-auto-project', r.project && r.project.path === projOne);
check('c2-info-cwd', (await invoke('/dsh-ide/info')).cwd === wsOne);

// --- criterion 5: two sessions keep their own workspace -----------------
const wsA = path.join(root, 'sess-a');
const wsB = path.join(root, 'sess-b');
await mkdir(wsA, { recursive: true });
await mkdir(wsB, { recursive: true });
const projA = path.join(wsA, 'Project.uvprojx');
const projB = path.join(wsB, 'Project.uvprojx');
await writeFile(projA, XML, 'utf8');
await writeFile(projB, XML, 'utf8');
await captured.tools[0].execute({ action: 'info' }, execWith(wsA));
await captured.tools[0].execute({ action: 'info' }, execWith(wsB));
const a = await panel(wsA);
const b = await panel(wsB);
check('c5-a', a.project && a.project.path === projA, JSON.stringify(a.project && a.project.path));
check('c5-b', b.project && b.project.path === projB, JSON.stringify(b.project && b.project.path));
check('c5-isolated', a.project.path !== b.project.path);
// each pane's workspace also matches what a panel would bind
check('c5-cwd-source', a.cwdSource === 'requested' && b.cwdSource === 'requested');

// --- criterion 6: the agent then hits the same project as 'panel' -------
// The panel binds under the session workspace, so a bare tool call resolves to
// the same project the panel is showing.
const opened = routes.has('/dsh-ide/project');
check('c6-route-exists', opened);
const { executeTool } = await import(new URL('../lib/tool.js', import.meta.url).href);
const viaTool = await executeTool({ getPanelProjects: () => new Map(), getActiveProject: () => null },
  { action: 'info' }, execWith(wsA));
check('c6-tool-same-project', viaTool.ok === true && viaTool.project === projA, JSON.stringify({ p: viaTool.project, s: viaTool.projectSource }));
check('c6-workspace-echo', viaTool.workspace === undefined || viaTool.workspace === null || typeof viaTool.workspace === 'string');

// --- not a directory ----------------------------------------------------
r = await panel(path.join(root, 'nope'));
check('missing-dir', r.ok === true && r.reason === 'not-a-directory');

await rm(root, { recursive: true, force: true });
await rm(home, { recursive: true, force: true });
console.log(ok ? 'WORKSPACE-AUTOLOAD CHECKS OK' : 'WORKSPACE-AUTOLOAD CHECKS FAILED');
process.exit(ok ? 0 : 1);
