// Acceptance tests for binding the SESSION WORKSPACE to the Keil project.
// Covers the seven scenarios in the design note.
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Isolate $DSH_HOME before the plugin modules load, so the machine's real
// remembered bindings cannot leak into these assertions.
const home = await mkdtemp(path.join(tmpdir(), 'dsh-ide-bind-home-'));
process.env.DSH_HOME = home;

const lib = (f) => new URL(`../lib/${f}`, import.meta.url).href;
const { executeTool, resolveProject, workspaceKey, listWorkspaces } = await import(lib('tool.js'));
const { findUvprojx } = await import(lib('project.js'));

let ok = true;
const check = (label, cond, extra) => {
  console.log('[' + label + ']', cond ? 'OK' : 'FAIL' + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};
const hasUndefined = (v) => (v === undefined ? true
  : (v === null || typeof v !== 'object') ? false
    : Array.isArray(v) ? v.some(hasUndefined) : Object.values(v).some(hasUndefined));

const STORE = path.join(home, 'dsh-ide-project.json');
const writeStore = (obj) => writeFile(STORE, JSON.stringify(obj, null, 2), 'utf8');
const clearStore = () => rm(STORE, { force: true });

const XML = (target = 'Target 1') => `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<Project xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Targets>
    <Target>
      <TargetName>${target}</TargetName>
      <Device>STM32F103C8</Device>
      <TargetOption>
        <TargetCommonOption>
          <OutputDirectory>.\\Objects\\</OutputDirectory>
          <OutputName>Project</OutputName>
          <CreateHexFile>0</CreateHexFile>
          <IncludePath></IncludePath>
        </TargetCommonOption>
        <TargetArmAds>
          <Cads>
            <VariousControls>
              <Define>USE_STDPERIPH_DRIVER</Define>
              <IncludePath>.\\User</IncludePath>
            </VariousControls>
          </Cads>
          <Aads><VariousControls><IncludePath></IncludePath></VariousControls></Aads>
        </TargetArmAds>
      </TargetOption>
      <Groups>
        <Group>
          <GroupName>User</GroupName>
          <Files>
            <File>
              <FileName>main.c</FileName>
              <FileType>1</FileType>
              <FilePath>.\\User\\main.c</FilePath>
            </File>
          </Files>
        </Group>
      </Groups>
    </Target>
  </Targets>
</Project>
`;

const root = await mkdtemp(path.join(tmpdir(), 'dsh-ide-bind-'));
const wsA = path.join(root, 'ws-a');
const wsB = path.join(root, 'ws-b');
const wsMulti = path.join(root, 'ws-multi');
const wsEmpty = path.join(root, 'ws-empty');

for (const d of [wsA, wsB, wsMulti, wsEmpty]) await mkdir(d, { recursive: true });
const projA = path.join(wsA, 'Project.uvprojx');
const projB = path.join(wsB, 'Project.uvprojx');
const projM1 = path.join(wsMulti, 'one', 'Project.uvprojx');
const projM2 = path.join(wsMulti, 'two', 'Project.uvprojx');
await mkdir(path.dirname(projM1), { recursive: true });
await mkdir(path.dirname(projM2), { recursive: true });
for (const p of [projA, projB, projM1, projM2]) await writeFile(p, XML(), 'utf8');

// a stray copy under a build-output directory must never be discovered
await mkdir(path.join(wsA, 'Objects'), { recursive: true });
await writeFile(path.join(wsA, 'Objects', 'Project.uvprojx'), XML(), 'utf8');

const execWith = (cwd) => ({ agent: { session: { header: { cwd } } } });
const noPanel = { getPanelProjects: () => new Map(), getActiveProject: () => null };

// --- workspaceKey normalisation ---------------------------------------
check('key-case-insensitive', workspaceKey('C:\\Foo\\Bar') === workspaceKey('c:/foo/bar/'), workspaceKey('C:\\Foo\\Bar'));
check('key-null', workspaceKey(null) === null && workspaceKey('') === null);

// --- findUvprojx skips build output -----------------------------------
const foundA = await findUvprojx(wsA, 4);
check('discover-skips-objects', foundA.length === 1 && path.dirname(foundA[0]) === wsA, JSON.stringify(foundA));

// --- 场景1: workspace == project dir, panel never opened ---------------
await clearStore();
let r = await executeTool(noPanel, { action: 'info' }, execWith(wsA));
check('s1-source-workspace', r.ok === true && r.projectSource === 'workspace', JSON.stringify(r.projectSource || r.message));
check('s1-project', r.project === projA, r.project);
check('s1-message-head', /来源：工作区自动发现/.test(r.message) && r.message.split('\n')[0].includes('ws-a'), JSON.stringify(r.message.split('\n')[0]));
check('s1-source-label', r.projectSource in { explicit: 1, workspace: 1, panel: 1, hint: 1 });

// --- 场景2: two projects in the workspace ------------------------------
await clearStore();
r = await executeTool(noPanel, { action: 'info' }, execWith(wsMulti));
check('s2-ambiguous', r.ok === false && Array.isArray(r.candidates) && r.candidates.length === 2, JSON.stringify(r.candidates));
check('s2-message', /无法确定用哪个/.test(r.message) && /候选/.test(r.message), JSON.stringify(r.message.split('\n')[0]));
check('s2-no-guess', r.project === undefined || r.project === null);

// choosing one explicitly resolves it, and the choice sticks for that workspace
r = await executeTool(noPanel, { action: 'info', project: projM2 }, execWith(wsMulti));
check('s2-explicit-resolves', r.ok === true && r.projectSource === 'explicit' && r.project === projM2);
r = await executeTool(noPanel, { action: 'info' }, execWith(wsMulti));
check('s2-binding-sticks', r.ok === true && r.project === projM2 && r.projectSource === 'hint', JSON.stringify(r.projectSource));

// --- 场景3: workspace has NO project; panel opened another -------------
await clearStore();
const panelElsewhere = new Map([[workspaceKey(path.dirname(projA)), { project: projA, at: '2026-01-01T00:00:00Z' }]]);
r = await executeTool(
  { getPanelProjects: () => panelElsewhere, getActiveProject: () => projA },
  { action: 'info' },
  execWith(wsEmpty),
);
check('s3-refuses-foreign', r.ok === false, JSON.stringify(r.message));
check('s3-message', /本工作区（.*ws-empty）未发现 Keil 工程/.test(r.message), JSON.stringify(r.message));
check('s3-no-silent', r.project === undefined || r.project === null);
check('s3-reports-cwd', r.workspace === wsEmpty, r.workspace);

// --- 场景4: two sessions, workspaces A and B; panel opened A -----------
await clearStore();
const panelA = new Map([[workspaceKey(path.dirname(projA)), { project: projA, at: '2026-01-01T00:00:00Z' }]]);
const depsShared = { getPanelProjects: () => panelA, getActiveProject: () => projA };
const a = await executeTool(depsShared, { action: 'info' }, execWith(wsA));
const b = await executeTool(depsShared, { action: 'info' }, execWith(wsB));
check('s4-a-targets-a', a.ok === true && a.project === projA, a.project);
check('s4-b-targets-b', b.ok === true && b.project === projB, b.project);
check('s4-b-not-hijacked', b.project !== projA);

// --- 场景5: explicit always wins ---------------------------------------
await clearStore();
r = await executeTool(depsShared, { action: 'info', project: projB }, execWith(wsA));
check('s5-explicit-wins', r.ok === true && r.project === projB && r.projectSource === 'explicit', JSON.stringify(r.projectSource));
r = await executeTool(noPanel, { action: 'info', project: path.join(root, 'nope.uvprojx') }, execWith(wsA));
check('s5-explicit-missing', r.ok === false && /工程文件不存在/.test(r.message));

// --- 场景6: the bound project is moved away ---------------------------
await clearStore();
// (a) a workspace with nothing discoverable uses its own binding
r = await executeTool(noPanel, { action: 'info', project: projA }, execWith(wsEmpty));
check('s6-bound', r.ok === true && r.project === projA && r.projectSource === 'explicit');
r = await executeTool(noPanel, { action: 'info' }, execWith(wsEmpty));
check('s6-uses-binding', r.ok === true && r.project === projA && r.projectSource === 'hint', JSON.stringify({ p: r.project, s: r.projectSource }));

// (b) that binding going stale degrades to a clear message, not a hard error
await rm(projA, { force: true });
r = await executeTool(noPanel, { action: 'info' }, execWith(wsEmpty));
check('s6-graceful', r.ok === false && /未发现 Keil 工程/.test(r.message), JSON.stringify(r.message.split('\n')[0]));
check('s6-not-hard-error', !/读取工程失败|ENOENT/.test(r.message));
await writeFile(projA, XML(), 'utf8');

// (c) inside a workspace that still has a project, discovery takes over again
r = await executeTool(noPanel, { action: 'info', project: projM2 }, execWith(wsMulti));
check('s6-multi-bound', r.ok === true && r.projectSource === 'explicit');
await rm(projM2, { force: true });
r = await executeTool(noPanel, { action: 'info' }, execWith(wsMulti));
check('s6-recovers', r.ok === true && r.project === projM1 && r.projectSource === 'workspace', JSON.stringify({ p: r.project, s: r.projectSource }));
await writeFile(projM2, XML(), 'utf8');

// --- 场景7: legacy v1 store + no exec ----------------------------------
await writeStore({ project: projA, at: '2026-01-01T00:00:00Z' });
r = await executeTool(noPanel, { action: 'info' }, execWith(wsEmpty));
check('s7-legacy-not-blind', r.ok === false && /未发现 Keil 工程/.test(r.message), JSON.stringify(r.message.split('\n')[0]));
await writeStore({ project: projB, at: '2026-01-01T00:00:00Z' });
r = await executeTool(noPanel, { action: 'info' }, execWith(wsA));
check('s7-legacy-no-crash', r.ok === true && r.projectSource === 'workspace', JSON.stringify(r.projectSource));
await writeFile(STORE, '{ not json at all', 'utf8');
r = await executeTool(noPanel, { action: 'info' }, execWith(wsA));
check('s7-corrupt-store', r.ok === true && r.project === projA, JSON.stringify(r.message.split('\n')[0]));

// --- degraded path: no exec at all -------------------------------------
await clearStore();
r = await executeTool({ getPanelProjects: () => new Map(), getActiveProject: () => projB }, { action: 'info' });
check('degraded-panel', r.ok === true && r.project === projB && r.projectSource === 'panel', JSON.stringify(r.projectSource));

// --- every result stays lossless ---------------------------------------
check('binding-lossless', !hasUndefined(r));
const rr = await resolveProject(noPanel, null, execWith(wsA));
check('resolve-shape', rr && rr.project === projA && rr.workspace === wsA && rr.source === 'workspace');
check('resolve-lossless', !hasUndefined(rr));

// --- the store is workspace-scoped on disk -----------------------------
await clearStore();
await executeTool(noPanel, { action: 'info' }, execWith(wsA));
await executeTool(noPanel, { action: 'info' }, execWith(wsB));
const stored = JSON.parse(await readFile(STORE, 'utf8'));
check('store-v2', stored.version === 2 && Object.keys(stored.workspaces).length === 2, JSON.stringify(Object.keys(stored.workspaces || {})));
check('store-keys', !!stored.workspaces[workspaceKey(wsA)] && !!stored.workspaces[workspaceKey(wsB)]);

// --- listWorkspaces (what the IDE panel uses to pick its root) ----------
const listed = await listWorkspaces(noPanel);
check('list-workspaces', listed.length === 2, JSON.stringify(listed.map((w) => w.cwd)));
check('list-workspaces-cwd', listed.some((w) => w.cwd === wsA) && listed.some((w) => w.cwd === wsB), JSON.stringify(listed));
check('list-workspaces-project', listed.every((w) => typeof w.project === 'string' && w.project.endsWith('.uvprojx')));
check('list-workspaces-newest-first', listed[0].at >= listed[1].at, JSON.stringify(listed.map((w) => w.at)));
check('list-workspaces-lossless', !hasUndefined(listed));

await rm(root, { recursive: true, force: true });
await rm(home, { recursive: true, force: true });
console.log(ok ? 'BINDING CHECKS OK' : 'BINDING CHECKS FAILED');
process.exit(ok ? 0 : 1);
