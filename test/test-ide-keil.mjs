// Verify the Keil tier: uvprojx parsing, file insertion, build-log parsing,
// and Keil detection — against a COPY of a real project (never the original).
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const lib = (f) => new URL(`../lib/${f}`, import.meta.url).href;
const { loadProject, parseProject, addFileToUvprojx, keilRelPath } = await import(lib('project.js'));
const { parseBuildLog, detectKeil } = await import(lib('keil.js'));
const { decodeOutput } = await import(lib('util.js'));

let ok = true;
function check(label, cond, extra) {
  console.log('[' + label + ']', cond ? 'OK' : 'FAIL' + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
}

// --- 1. detect Keil ----------------------------------------------------
const keil = await detectKeil();
console.log('[keil-detect]', JSON.stringify({ found: keil.found, uv4: keil.uv4, version: keil.version }));
check('keil-detect', keil.found === true && /UV4\.exe$/i.test(keil.uv4 || ''));

// --- 2. load + parse a real project (copy) -----------------------------
const src = process.env.DSH_KEIL_TEST_PROJECT
  || 'C:/Users/33549/Desktop/stm32project/led/Project.uvprojx';
const dir = await mkdtemp(path.join(tmpdir(), 'dsh-ide-keil-'));
const proj = path.join(dir, 'Project.uvprojx');
await copyFile(src, proj);
// copy the .uvoptx sidecar too (holds the debugger/flash config)
await copyFile(src.replace(/\.uvprojx$/i, '.uvoptx'), proj.replace(/\.uvprojx$/i, '.uvoptx'));
// The reference project on this machine is mutable: earlier plugin builds may
// have left a Hardware group and a `.\Hardware` include entry. Normalise the
// copy back to the pristine baseline so the assertions below stay stable.
{
  const raw = decodeOutput(await readFile(proj));
  let clean = raw.replace(/\s*<Group>\s*<GroupName>Hardware<\/GroupName>[\s\S]*?<\/Group>/, '');
  clean = clean.replace(/;\.\\Hardware/g, '').replace(/\.\\Hardware;/g, '');
  clean = clean.replace(/(<IncludePath>)\.\\Hardware(<\/IncludePath>)/g, '$1$2');
  if (clean !== raw) await writeFile(proj, clean, 'utf8');
}

const loaded = await loadProject(proj);
console.log('[project-load]', JSON.stringify({
  targets: loaded.targets.map((t) => ({ name: t.name, device: t.device, vendor: t.vendor, groups: t.groups.length })),
  debuggerDll: loaded.debuggerDll,
}));
check('project-targets', loaded.targets.length >= 1);
check('project-device', loaded.targets[0].device === 'STM32F103C8');
check('project-debugger', /STLink|ST-Link/i.test(loaded.debuggerDll || ''), 'dll=' + loaded.debuggerDll);
const t0 = loaded.targets[0];
const groupNames = t0.groups.map((g) => g.name);
console.log('[project-groups]', JSON.stringify(groupNames));
check('project-groups', groupNames.includes('User') && groupNames.includes('Library'));
const userGroup = t0.groups.find((g) => g.name === 'User');
const userFileCount = userGroup ? userGroup.files.length : 0;
check('project-user-files', userFileCount >= 1, 'count=' + userFileCount);
const mainFile = userGroup && userGroup.files.find((f) => f.name === 'main.c');
check('project-main-file', !!mainFile && /main\.c$/i.test(mainFile.path));

// --- 3. build-log parsing ---------------------------------------------
const log = [
  "Rebuild target 'Target 1'",
  'compiling main.c...',
  '..\\User\\main.c(42): error: #20: identifier "foo" is undefined',
  '..\\User\\main.c(55,3): warning: #1-D: last line of file ends without a newline',
  'linking...',
  'Program Size: Code=1234 RO-data=567 RW-data=89 ZI-data=100',
  '".\\Objects\\Project.axf" - 1 Error(s), 1 Warning(s).',
].join('\n');
const parsed = parseBuildLog(log);
console.log('[log-parse]', JSON.stringify(parsed));
check('log-errors', parsed.errors === 1 && parsed.warnings === 1, JSON.stringify(parsed));
check('log-issues', parsed.issues.length === 2 && parsed.issues[0].line === 42 && parsed.issues[0].kind === 'error');
check('log-size', parsed.programSize.startsWith('Code='), parsed.programSize);

// --- 4. add a file to the User group -----------------------------------
const xml0 = decodeOutput(await readFile(proj));
const rel = keilRelPath(dir, path.join(dir, 'User', 'newmod.c'));
const added = addFileToUvprojx(xml0, {
  targetName: 'Target 1', groupName: 'User', fileName: 'newmod.c', filePath: rel, fileType: 1,
});
await writeFile(proj, added, 'utf8');
const reloaded = await loadProject(proj);
const userAfter = reloaded.targets[0].groups.find((g) => g.name === 'User');
const addedOk = !!userAfter && userAfter.files.some((f) => f.name === 'newmod.c' && f.path === rel);
const originalOk = reloaded.targets[0].groups.some((g) => g.name === 'Library' && g.files.length > 0);
console.log('[add-file]', JSON.stringify({ rel, addedOk, userFiles: userAfter ? userAfter.files.length : 0 }));
check('add-file-insert', addedOk);
check('add-file-preserve', originalOk && reloaded.targets.length === 1);
check('add-file-wellformed', added.includes('<FileType>1</FileType>') && added.includes('<GroupName>User</GroupName>'));

// --- 5. add to a brand-new group ---------------------------------------
const xml1 = decodeOutput(await readFile(proj));
const added2 = addFileToUvprojx(xml1, {
  targetName: 'Target 1', groupName: 'MyNewGroup', fileName: 'a.c', filePath: '.\\MyNewGroup\\a.c', fileType: 1,
});
// re-parse directly from string
const targets2 = parseProject(added2);
const newGroup = targets2[0].groups.find((g) => g.name === 'MyNewGroup');
console.log('[add-group]', JSON.stringify(newGroup ? { files: newGroup.files.map((f) => f.name) } : null));
check('add-group-create', !!newGroup && newGroup.files.some((f) => f.name === 'a.c'));

// --- 6. file type mapping (Bug 1: .h must be 5, not 8) -----------------
const { fileTypeForName, FILE_TYPE_LABELS } = await import(lib('project.js'));
check('filetype-c', fileTypeForName('x.c') === 1);
check('filetype-asm', fileTypeForName('x.s') === 2 && fileTypeForName('x.asm') === 2);
check('filetype-h', fileTypeForName('x.h') === 5 && fileTypeForName('x.hpp') === 5, 'got ' + fileTypeForName('x.h'));
check('filetype-cpp', fileTypeForName('x.cpp') === 8, 'got ' + fileTypeForName('x.cpp'));
check('filetype-labels', FILE_TYPE_LABELS[5] === '头文件' && FILE_TYPE_LABELS[8] === 'C++ 源文件');

// --- 7. include path is read from Cads/VariousControls (Bug 2a) --------
const beforeInc = await loadProject(proj);
console.log('[includePath-read]', JSON.stringify(beforeInc.targets[0].includePath));
check('include-path-read', beforeInc.targets[0].includePath === '.\\Start;.\\User;.\\Library;.\\System', beforeInc.targets[0].includePath);
check('define-read', beforeInc.targets[0].define === 'USE_STDPERIPH_DRIVER', beforeInc.targets[0].define);

// --- 8. add keeps the C include path in sync (Bug 2b) ------------------
const xmlPre = decodeOutput(await readFile(proj));
const withC = addFileToUvprojx(xmlPre, {
  targetName: 'Target 1', groupName: 'Hardware', fileName: 'gpio.c', filePath: '.\\Hardware\\gpio.c', fileType: 1,
});
const withH = addFileToUvprojx(withC, {
  targetName: 'Target 1', groupName: 'Hardware', fileName: 'gpio.h', filePath: '.\\Hardware\\gpio.h', fileType: 5,
});
await writeFile(proj, withH, 'utf8');

const afterInc = await loadProject(proj);
console.log('[includePath-after]', JSON.stringify(afterInc.targets[0].includePath));
check('include-path-added', afterInc.targets[0].includePath === '.\\Start;.\\User;.\\Library;.\\System;.\\Hardware', afterInc.targets[0].includePath);

const rawAfter = decodeOutput(await readFile(proj));
const allInc = [...rawAfter.matchAll(/<IncludePath>([\s\S]*?)<\/IncludePath>/g)].map((m) => m[1]);
console.log('[all-include-paths]', JSON.stringify(allInc));
check('include-path-scoped', allInc.length === 3 && allInc[0] === '' && allInc[1].endsWith('.\\Hardware') && allInc[2] === '', JSON.stringify(allInc));

// adding a root-level file must not invent an include path
const rootAdd = addFileToUvprojx(rawAfter, { targetName: 'Target 1', groupName: 'User', fileName: 'root.c', filePath: '.\\root.c', fileType: 1 });
const rootInc = [...rootAdd.matchAll(/<IncludePath>([\s\S]*?)<\/IncludePath>/g)].map((m) => m[1]);
check('include-path-root-skip', rootInc[1] === '.\\Start;.\\User;.\\Library;.\\System;.\\Hardware', rootInc[1]);

// the added header must carry FileType 5 in the XML
check('added-h-type-5', /<FileName>gpio\.h<\/FileName>[\s\S]{0,80}<FileType>5<\/FileType>/.test(rawAfter));

// --- 9. results must be lossless JSON (Bug 3) --------------------------
const hasUndefined = (v) => (v === undefined ? true
  : (v === null || typeof v !== 'object') ? false
    : Array.isArray(v) ? v.some(hasUndefined) : Object.values(v).some(hasUndefined));
check('log-lossless', !hasUndefined(parsed), 'undefined leaked into the result');
const noCol = parseBuildLog('..\\User\\a.c(7): error: #20: boom');
check('log-no-undefined-key', !Object.prototype.hasOwnProperty.call(noCol.issues[0], 'col'), JSON.stringify(noCol.issues[0]));
const withCol = parseBuildLog('..\\User\\a.c(7,12): error: #20: boom');
check('log-keeps-col', withCol.issues[0].col === 12);

// --- 10. repairProject fixes a project left broken by the pre-fix build --
const { repairProject } = await import(lib('project.js'));
const brokenXml = rawAfter
  .replace(/(<FileName>gpio\.h<\/FileName>\s*<FileType>)(\d+)(<\/FileType>)/, (m, a, t, c) => a + '8' + c)
  .replace(';.\\Hardware', '');
const rep = repairProject(brokenXml, 'Target 1');
console.log('[repair]', JSON.stringify({ fixed: rep.fixedFileTypes, inc: rep.addedIncludePaths }));
check('repair-fixes-type', rep.fixedFileTypes >= 1 && /<FileName>gpio\.h<\/FileName>\s*<FileType>5<\/FileType>/.test(rep.xml));
check('repair-adds-include', rep.addedIncludePaths >= 1);
check('repair-include-value', parseProject(rep.xml)[0].includePath.endsWith('.\\Hardware'), parseProject(rep.xml)[0].includePath);
const rep2 = repairProject(rep.xml, 'Target 1');
check('repair-idempotent', rep2.fixedFileTypes === 0 && rep2.addedIncludePaths === 0, JSON.stringify(rep2));

await rm(dir, { recursive: true, force: true });
console.log(ok ? 'KEIL CHECKS OK' : 'KEIL CHECKS FAILED');
process.exit(ok ? 0 : 1);
