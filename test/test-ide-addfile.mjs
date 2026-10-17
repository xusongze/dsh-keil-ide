// The panel's "add file" flow: /dsh-ide/project/add must create the file with
// the supplied content, register it in the project, and never overwrite a file
// that already exists.
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const home = await mkdtemp(path.join(tmpdir(), 'dsh-ide-add-home-'));
process.env.DSH_HOME = home;

const mod = await import(new URL('../lib/index.js', import.meta.url).href);
const { loadProject } = await import(new URL('../lib/project.js', import.meta.url).href);

let ok = true;
const check = (label, cond, extra) => {
  console.log('[' + label + ']', cond ? 'OK' : 'FAIL' + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};

const routes = new Map();
mod.apply({
  webServer: { register(r) { routes.set(r.path, r); return () => routes.delete(r.path); } },
  effect(cb) { cb(); },
  inject(_d, cb) { cb({ tools: { register: () => () => {} }, skills: { register: () => () => {} }, effect: (fn) => { fn(); return () => {}; }, get: () => undefined }); },
});
check('route-registered', routes.has('/dsh-ide/project/add'));

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
async function post(pathname, body) {
  const req = mockReq(pathname, 'POST');
  const res = mockRes();
  const p = routes.get(pathname).handler(req, res);
  req._emit('data', Buffer.from(JSON.stringify(body), 'utf8'));
  req._emit('end');
  await p;
  return JSON.parse(res.body || '{}');
}

// --- fixture: a minimal uvprojx with one empty group --------------------
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<Project xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Targets>
    <Target>
      <TargetName>Target 1</TargetName>
      <Device>STM32F103C8</Device>
      <TargetOption>
        <TargetCommonOption><OutputDirectory>.\\Objects\\</OutputDirectory><OutputName>P</OutputName><IncludePath></IncludePath></TargetCommonOption>
        <TargetArmAds><Cads><VariousControls><Define>D</Define><IncludePath>.\\Hardware</IncludePath></VariousControls></Cads></TargetArmAds>
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
const root = await mkdtemp(path.join(tmpdir(), 'dsh-ide-add-'));
await mkdir(path.join(root, 'User'), { recursive: true });
await writeFile(path.join(root, 'User', 'main.c'), 'int main(void){return 0;}\n', 'utf8');
const projPath = path.join(root, 'Project.uvprojx');
await writeFile(projPath, XML, 'utf8');

const hPath = path.join(root, 'Hardware', 'gpio.h');
const cPath = path.join(root, 'Hardware', 'gpio.c');

// --- create a header with supplied content ------------------------------
let r = await post('/dsh-ide/project/add', {
  project: projPath, group: 'Hardware', filePath: hPath,
  content: '#ifndef GPIO_H\n#define GPIO_H\nvoid gpio_init(void);\n#endif\n',
});
check('create-header-ok', r.ok === true && r.created === true, JSON.stringify(r));
check('create-header-rel', r.rel === '.\\Hardware\\gpio.h', r.rel);
const headerText = await readFile(hPath, 'utf8');
check('create-header-content', headerText.includes('void gpio_init(void);'), JSON.stringify(headerText));

// --- create the source file --------------------------------------------
r = await post('/dsh-ide/project/add', {
  project: projPath, group: 'Hardware', filePath: cPath,
  content: '#include "gpio.h"\nvoid gpio_init(void){}\n',
});
check('create-source-ok', r.ok === true && r.created === true);

// --- the group was created and both files are in it --------------------
let project = await loadProject(projPath);
let target = project.targets[0];
let hw = target.groups.find((g) => g.name === 'Hardware');
check('group-created', !!hw, JSON.stringify(target.groups.map((g) => g.name)));
check('group-files', hw && hw.files.length === 2, hw && JSON.stringify(hw.files.map((f) => f.name)));
check('header-type-5', hw && hw.files.find((f) => f.name === 'gpio.h').type === 5);
check('source-type-1', hw && hw.files.find((f) => f.name === 'gpio.c').type === 1);
check('include-path', target.includePath.includes('.\\Hardware'), target.includePath);

// --- adding again must NOT overwrite the file --------------------------
r = await post('/dsh-ide/project/add', {
  project: projPath, group: 'Hardware', filePath: cPath,
  content: 'THIS MUST NOT LAND\n',
});
check('re-add-no-overwrite', r.ok === true && r.created === false, JSON.stringify(r));
const sourceText = await readFile(cPath, 'utf8');
check('re-add-content-intact', sourceText.includes('gpio_init') && !sourceText.includes('MUST NOT LAND'), JSON.stringify(sourceText));

// --- a missing content falls back to a skeleton ------------------------
const barePath = path.join(root, 'Hardware', 'bare.h');
r = await post('/dsh-ide/project/add', { project: projPath, group: 'Hardware', filePath: barePath });
check('skeleton-ok', r.ok === true && r.created === true);
const bare = await readFile(barePath, 'utf8');
check('skeleton-header-guard', /^#ifndef BARE_H/.test(bare) && bare.includes('#endif'), JSON.stringify(bare));

await rm(root, { recursive: true, force: true });
await rm(home, { recursive: true, force: true });
console.log(ok ? 'ADD-FILE CHECKS OK' : 'ADD-FILE CHECKS FAILED');
process.exit(ok ? 0 : 1);
