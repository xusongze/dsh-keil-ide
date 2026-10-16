// Verify the keil_project tool: group auto-matching, file creation/linking,
// and the hand-written definition shape — against a COPY of a real project.
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Isolate $DSH_HOME before the plugin modules load: the real machine persists
// a project hint there, which would defeat the "no project available" case.
const isolatedHome = await mkdtemp(path.join(tmpdir(), 'dsh-ide-home-'));
process.env.DSH_HOME = isolatedHome;

const lib = (f) => new URL(`../lib/${f}`, import.meta.url).href;
const { executeTool, buildToolDefinition, chooseGroup, TOOL_NAME } = await import(lib('tool.js'));
const { loadProject } = await import(lib('project.js'));

let ok = true;
function check(label, cond, extra) {
  console.log('[' + label + ']', cond ? 'OK' : 'FAIL' + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
}

// --- definition shape (what ctx.tools.register demands) ----------------
const def = buildToolDefinition({ getActiveProject: () => null });
check('def-name', def.name === TOOL_NAME);
check('def-desc', typeof def.description === 'string' && def.description.length > 20);
check('def-params-object', def.parameters && def.parameters.type === 'object' && !!def.parameters.properties.action);
check('def-actions', ['info', 'list', 'add', 'link', 'remove', 'repair', 'build', 'rebuild', 'clean', 'flash']
  .every((a) => def.parameters.properties.action.enum.includes(a)), JSON.stringify(def.parameters.properties.action.enum));
check('def-params-extra', !!def.parameters.properties.deleteFile && !!def.parameters.properties.force);
check('def-render-fn', def.output && typeof def.output.render === 'function');
const rendered = def.output.render({ action: 'info' }, { message: 'hello' });
check('def-render-blocks', Array.isArray(rendered) && rendered[0] && rendered[0].type === 'text' && rendered[0].text === 'hello');
check('def-execute-fn', typeof def.execute === 'function');

// --- chooseGroup unit tests -------------------------------------------
const target = { name: 'Target 1', groups: [
  { name: 'User', files: [{ path: '.\\User\\main.c' }] },
  { name: 'Library', files: [{ path: '.\\Library\\misc.c' }] },
]};
const base = 'C:\\proj';
check('group-dir-match', chooseGroup(target, base, path.join(base, 'User', 'x.c'), null) === 'User');
check('group-name-match', chooseGroup(target, base, path.join(base, 'Library', 'y.c'), null) === 'Library');
check('group-new-by-dir', chooseGroup(target, base, path.join(base, 'Hardware', 'gpio.c'), null) === 'Hardware');
check('group-explicit', chooseGroup(target, base, path.join(base, 'Hardware', 'gpio.c'), 'MyGroup') === 'MyGroup');
check('group-root-fallback', chooseGroup(target, base, path.join(base, 'root.c'), null) === 'User');

// --- end-to-end on a real project copy --------------------------------
const src = process.env.DSH_KEIL_TEST_PROJECT
  || 'C:/Users/33549/Desktop/stm32project/led/Project.uvprojx';
const dir = await mkdtemp(path.join(tmpdir(), 'dsh-ide-tool-'));
const projPath = path.join(dir, 'Project.uvprojx');
await copyFile(src, projPath);
await copyFile(src.replace(/\.uvprojx$/i, '.uvoptx'), projPath.replace(/\.uvprojx$/i, '.uvoptx'));

// The reference project on this machine is mutable: earlier plugin builds may
// have left a Hardware group and a `.\Hardware` include entry. Normalise the
// copy back to the pristine baseline so the assertions below stay stable.
{
  const raw = await readFile(projPath, 'utf8');
  let clean = raw.replace(/\s*<Group>\s*<GroupName>Hardware<\/GroupName>[\s\S]*?<\/Group>/, '');
  clean = clean.replace(/;\.\\Hardware/g, '').replace(/\.\\Hardware;/g, '');
  clean = clean.replace(/(<IncludePath>)\.\\Hardware(<\/IncludePath>)/g, '$1$2');
  if (clean !== raw) await writeFile(projPath, clean, 'utf8');
}

const deps = { getActiveProject: () => projPath };

let r = await executeTool(deps, { action: 'info' });
console.log('[info]', JSON.stringify((r.message || '').split('\n').slice(0, 3)));
check('info-ok', r.ok === true && /STM32F103C8/.test(r.message));

r = await executeTool(deps, { action: 'list' });
check('list-ok', r.ok === true && /\[User\]/.test(r.message));

// add a brand-new module under a new directory -> new "Hardware" group
r = await executeTool(deps, { action: 'add', file: 'Hardware/gpio.c', content: 'void gpio_init(void){}\n' });
console.log('[add-new-group]', JSON.stringify(r.message));
check('add-new-group-ok', r.ok === true && r.group === 'Hardware' && r.created === true);
const written = await readFile(path.join(dir, 'Hardware', 'gpio.c'), 'utf8');
check('add-wrote-file', written.includes('gpio_init'));

let reloaded = await loadProject(projPath);
let hw = reloaded.targets[0].groups.find((g) => g.name === 'Hardware');
check('add-group-created', !!hw && hw.files.some((f) => f.name === 'gpio.c'));

// Bug 2b: the new directory must also land on the C include path
const incParts = String(reloaded.targets[0].includePath).split(';').map((s) => s.trim());
check('add-updates-include-path', incParts.includes('.\\Hardware'), reloaded.targets[0].includePath);

// Bug 1: a linked header must carry FileType 5, never 8
r = await executeTool(deps, { action: 'add', file: 'Hardware/gpio.h', content: '#pragma once\n' });
check('add-header-ok', r.ok === true, JSON.stringify(r.message));
const afterHeader = await readFile(projPath, 'utf8');
check('header-filetype-5', /<FileName>gpio\.h<\/FileName>[\s\S]{0,90}<FileType>5<\/FileType>/.test(afterHeader));

// Bug 3: no tool result may contain `undefined` (DSH's validator rejects it)
const hasUndefined = (v) => (v === undefined ? true
  : (v === null || typeof v !== 'object') ? false
    : Array.isArray(v) ? v.some(hasUndefined) : Object.values(v).some(hasUndefined));
check('result-lossless', !hasUndefined(r));

// add into an existing group by directory match
r = await executeTool(deps, { action: 'add', file: 'User/extra.c', content: 'int extra;\n' });
check('add-existing-group', r.ok === true && r.group === 'User', JSON.stringify(r.message));

// 建议3: re-adding is a safe no-op AND the three states are reported honestly
r = await executeTool(deps, { action: 'add', file: 'Hardware/gpio.c' });
check('add-idempotent', r.ok === true && r.entryExisted === true && /条目已存在/.test(r.message), JSON.stringify(r.message));
check('add-idempotent-no-write', r.contentWritten === false, JSON.stringify(r));
check('add-idempotent-fields', r.created === false && r.fileTypeFixed === null);

// 建议3: re-adding WITH content does write it, and the message says so
r = await executeTool(deps, { action: 'add', file: 'Hardware/gpio.c', content: 'void gpio_init(void){ /* v2 */ }\n' });
check('add-repeat-writes', r.ok === true && r.entryExisted === true && r.contentWritten === true && /内容已写入/.test(r.message), JSON.stringify(r.message));
const rewritten = await readFile(path.join(dir, 'Hardware', 'gpio.c'), 'utf8');
check('add-repeat-content', rewritten.includes('v2'));

// 建议3 optional: an existing entry with a wrong FileType self-heals on add
{
  const raw = await readFile(projPath, 'utf8');
  await writeFile(projPath, raw.replace(/(<FileName>gpio\.h<\/FileName>\s*<FileType>)(\d+)/, (m, a, t) => a + '8'), 'utf8');
  r = await executeTool(deps, { action: 'add', file: 'Hardware/gpio.h' });
  check('add-selfheal-type', r.ok === true && r.entryExisted === true
    && r.fileTypeFixed && r.fileTypeFixed.from === 8 && r.fileTypeFixed.to === 5, JSON.stringify(r.fileTypeFixed));
  const healed = await readFile(projPath, 'utf8');
  check('add-selfheal-xml', /<FileName>gpio\.h<\/FileName>\s*<FileType>5<\/FileType>/.test(healed));
}

// 建议4: info surfaces the real Include/Define
r = await executeTool(deps, { action: 'info' });
check('info-include', /Include: .*\\Hardware/.test(r.message), JSON.stringify(r.message));
check('info-define', /Define : USE_STDPERIPH_DRIVER/.test(r.message));
check('info-target-fields', r.targets && r.targets[0] && r.targets[0].includePath.includes('Hardware'));

// 建议4: list shows FileType per file and flags mismatches
r = await executeTool(deps, { action: 'list' });
check('list-filetype', /\[FileType 5 头文件\]/.test(r.message), JSON.stringify(r.message.slice(0, 200)));
{
  const raw = await readFile(projPath, 'utf8');
  await writeFile(projPath, raw.replace(/(<FileName>gpio\.h<\/FileName>\s*<FileType>)(\d+)/, (m, a, t) => a + '8'), 'utf8');
  r = await executeTool(deps, { action: 'list' });
  check('list-flags-mismatch', r.mismatchedFileTypes.length === 1 && r.mismatchedFileTypes[0].to === 5, JSON.stringify(r.mismatchedFileTypes));
  check('list-mismatch-text', /⚠ 应为 5/.test(r.message));
  await executeTool(deps, { action: 'repair' });   // put it back
}

// link requires the file to exist
r = await executeTool(deps, { action: 'link', file: 'Hardware/nope.c' });
check('link-missing', r.ok === false && /不存在/.test(r.message));

// missing project resolution
r = await executeTool({ getActiveProject: () => null }, { action: 'info' });
check('no-project', r.ok === false && /没有可用的工程/.test(r.message) || r.ok === false);

// unknown action
r = await executeTool(deps, { action: 'nope' });
check('bad-action', r.ok === false && /action/.test(r.message));

// repair path: deliberately break the project, then let the tool fix it
{
  const raw = await readFile(projPath, 'utf8');
  const broken = raw
    .replace(/(<FileName>gpio\.h<\/FileName>\s*<FileType>)(\d+)(<\/FileType>)/, (m, a, t, c) => a + '8' + c)
    .replace(';.\\Hardware', '');
  await writeFile(projPath, broken, 'utf8');

  const rep = await executeTool(deps, { action: 'repair' });
  console.log('[repair]', JSON.stringify(rep.message));
  check('repair-ok', rep.ok === true && rep.fixedFileTypes >= 1 && rep.addedIncludePaths >= 1, JSON.stringify(rep));
  check('repair-lossless', !hasUndefined(rep));

  const fixedRaw = await readFile(projPath, 'utf8');
  check('repair-type-restored', /<FileName>gpio\.h<\/FileName>\s*<FileType>5<\/FileType>/.test(fixedRaw));
  const fixedProj = await loadProject(projPath);
  check('repair-include-restored', String(fixedProj.targets[0].includePath).endsWith('.\\Hardware'), fixedProj.targets[0].includePath);

  const again = await executeTool(deps, { action: 'repair' });
  check('repair-idempotent', again.ok === true && again.fixedFileTypes === 0 && again.addedIncludePaths === 0, JSON.stringify(again));
}

// original groups preserved
reloaded = await loadProject(projPath);
const names = reloaded.targets[0].groups.map((g) => g.name);
console.log('[groups-after]', JSON.stringify(names));
check('groups-preserved', names.includes('Library') && names.includes('Start') && names.includes('System') && names.includes('User') && names.includes('Hardware'));

// --- 建议1: remove is the exact inverse of add -------------------------
{
  const exists = async (p) => { try { await readFile(p); return true; } catch { return false; } };

  r = await executeTool(deps, { action: 'add', file: 'Hardware/tmp.c', content: 'int tmp;\n' });
  check('remove-setup', r.ok === true && r.group === 'Hardware', JSON.stringify(r.message));
  const beforeXml = await readFile(projPath, 'utf8');

  r = await executeTool(deps, { action: 'remove', file: 'Hardware/tmp.c' });
  console.log('[remove]', JSON.stringify(r.message.split('\n')[0]));
  check('remove-ok', r.ok === true && r.removed && r.removed.group === 'Hardware' && r.removed.fileType === 1);
  check('remove-keeps-file', r.fileDeleted === false && (await exists(path.join(dir, 'Hardware', 'tmp.c'))));
  check('remove-lossless', !hasUndefined(r));

  const afterXml = await readFile(projPath, 'utf8');
  check('remove-entry-gone', !afterXml.includes('tmp.c'));
  check('remove-precise', beforeXml.length > afterXml.length && afterXml.length > 0);
  // the group must still hold gpio.c/gpio.h, so the include path stays
  check('remove-keeps-include', String((await loadProject(projPath)).targets[0].includePath).includes('.\\Hardware'));

  // removing the last file of a directory prunes the include entry
  await executeTool(deps, { action: 'remove', file: 'Hardware/gpio.c' });
  r = await executeTool(deps, { action: 'remove', file: 'Hardware/gpio.h' });
  check('remove-prunes-include', r.includePathDropped === '.\\Hardware', JSON.stringify(r.includePathDropped));
  const after2 = await loadProject(projPath);
  check('remove-include-gone', !String(after2.targets[0].includePath).includes('.\\Hardware'), after2.targets[0].includePath);
  // an emptied group survives: we never collapse groups
  check('remove-keeps-group', after2.targets[0].groups.some((g) => g.name === 'Hardware'));

  // deleteFile actually removes it from disk
  await executeTool(deps, { action: 'add', file: 'Hardware/gone.c', content: 'int gone;\n' });
  r = await executeTool(deps, { action: 'remove', file: 'Hardware/gone.c', deleteFile: true });
  check('remove-deletes', r.ok === true && r.fileDeleted === true && !(await exists(path.join(dir, 'Hardware', 'gone.c'))));

  // removing an entry that is not there is an error, not a silent success
  r = await executeTool(deps, { action: 'remove', file: 'Hardware/nope.c' });
  check('remove-missing', r.ok === false && /没有这个条目/.test(r.message), JSON.stringify(r.message));
}

// --- registration wiring: mock host context ---------------------------
// Proves the plugin really hands both halves to the host: the Agent-facing
// Tool and the workflow Skill. This is what makes other conversations able to
// call the feature after the plugin is installed.
{
  const calls = { tools: [], skills: [] };
  const fakeCtx = {
    inject(deps, cb) {
      cb({
        tools: { register: (d) => { calls.tools.push(d); return () => {}; } },
        skills: { register: (s) => { calls.skills.push(s); return () => {}; } },
        effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
        get: () => undefined,
      });
    },
  };
  const { installTool } = await import(lib('tool.js'));
  const { installSkill, SKILL_NAME } = await import(lib('skill.js'));
  installTool(fakeCtx, { getActiveProject: () => null });
  installSkill(fakeCtx);

  check('wire-tool-registered', calls.tools.length === 1 && calls.tools[0].name === TOOL_NAME);
  check('wire-tool-render-fn', typeof calls.tools[0].output.render === 'function');
  check('wire-tool-execute-fn', typeof calls.tools[0].execute === 'function');

  check('wire-skill-registered', calls.skills.length === 1 && calls.skills[0].name === SKILL_NAME);
  const sk = calls.skills[0] || {};
  check('wire-skill-shape', typeof sk.description === 'string' && typeof sk.content === 'string'
    && sk.content.length > 300 && typeof sk.source === 'string', JSON.stringify(Object.keys(sk)));
  check('wire-skill-documents-actions', ['info', 'list', 'add', 'link', 'remove', 'repair', 'build', 'rebuild', 'clean', 'flash']
    .every((a) => sk.content.includes('`' + a + '`')));
  check('wire-skill-documents-fields', /contentWritten/.test(sk.content) && /entryExisted/.test(sk.content));
  check('wire-skill-documents-binding', /projectSource/.test(sk.content) && /会话工作区/.test(sk.content));
  check('wire-skill-documents-gotchas', /FileType/.test(sk.content) && /Cads/.test(sk.content));
}

await rm(dir, { recursive: true, force: true });
console.log(ok ? 'TOOL CHECKS OK' : 'TOOL CHECKS FAILED');
process.exit(ok ? 0 : 1);
