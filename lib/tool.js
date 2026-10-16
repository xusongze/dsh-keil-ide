/**
 * dsh-keil-ide — the `keil_project` Tool (Node/host half).
 *
 * Registered on the host context so an Agent can create or link source files
 * into a Keil uvprojx project, build it, and flash it — without hand-editing
 * XML.
 *
 * The definition is hand-written plain JSON Schema: no DSH internal package is
 * imported, which keeps the plugin dependency-free and tolerant of DSH version
 * changes. Registration is best-effort — if the host publishes no `tools`
 * service the rest of the plugin is unaffected.
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { DSH_HOME, isFile, decodeOutput } from './util.js';
import { detectKeil, runUv4Blocking, parseBuildLog, exitMessage } from './keil.js';
import {
  loadProject, addFileToUvprojx, keilRelPath, fileTypeForName, repairProject,
  removeFileFromUvprojx, setFileTypeInUvprojx, findUvprojx, FILE_TYPE_LABELS,
} from './project.js';

export const TOOL_NAME = 'keil_project';

/**
 * Remembered project bindings, keyed by workspace so two sessions never fight.
 *
 * Shape on disk: `{ version: 2, workspaces: { "<cwdKey>": { project, at } } }`.
 * A legacy v1 file (`{ project, at }`) is still read, but only honoured when
 * that project actually lives inside the calling workspace.
 */
const PROJECT_HINT_FILE = path.join(DSH_HOME, 'dsh-ide-project.json');

/** Stable, case-insensitive key for a workspace path. */
export function workspaceKey(cwd) {
  if (!cwd) return null;
  try { return path.resolve(String(cwd)).replace(/[\\/]+$/, '').toLowerCase(); }
  catch { return String(cwd).replace(/[\\/]+$/, '').toLowerCase(); }
}

/** Is `child` inside `parent` (or the same path)? */
function isInside(parent, child) {
  if (!parent || !child) return false;
  try {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch { return false; }
}

function samePath(a, b) {
  return workspaceKey(a) === workspaceKey(b);
}

/**
 * Persist a binding. `cwd` is the owning workspace; without one the project's
 * own directory is used, so the IDE panel's "last opened" entry never leaks
 * into an unrelated workspace.
 */
export async function rememberProject(projectPath, cwd) {
  if (!projectPath) return;
  const key = workspaceKey(cwd) || workspaceKey(path.dirname(projectPath)) || 'global';
  try {
    const { workspaces } = await readStore();
    workspaces[key] = {
      project: projectPath,
      // keep the original (un-lowercased) path so it can be shown and browsed
      cwd: cwd || path.dirname(projectPath),
      at: new Date().toISOString(),
    };
    const kept = Object.entries(workspaces)
      .sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || '')))
      .slice(0, 40);
    await writeFile(
      PROJECT_HINT_FILE,
      JSON.stringify({ version: 2, workspaces: Object.fromEntries(kept) }, null, 2) + '\n',
      'utf8',
    );
  } catch { /* best effort: a read-only $DSH_HOME must not break the tool */ }
}

/** Every remembered workspace binding, newest first. */
export async function listWorkspaces(deps) {
  const store = await readStore(deps);
  return Object.entries(store.workspaces)
    .map(([key, value]) => ({
      key,
      cwd: value.cwd || key,
      project: value.project,
      at: value.at || '',
    }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Back-compat wrapper for the IDE panel route (keys by the project's own dir). */
export async function writeProjectHint(projectPath) {
  return rememberProject(projectPath, path.dirname(projectPath));
}

/** Read the store, overlaying the panel's in-memory map when the host offers one. */
async function readStore(deps) {
  const workspaces = {};
  let legacy = null;

  try {
    const parsed = JSON.parse(await readFile(PROJECT_HINT_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      if (parsed.workspaces && typeof parsed.workspaces === 'object') {
        for (const [key, value] of Object.entries(parsed.workspaces)) {
          if (value && typeof value.project === 'string' && value.project) {
            workspaces[key] = {
              project: value.project,
              cwd: typeof value.cwd === 'string' ? value.cwd : key,
              at: String(value.at || ''),
            };
          }
        }
      }
      // v1 shape: one global project, no workspace split
      if (typeof parsed.project === 'string' && parsed.project) legacy = parsed.project;
    }
  } catch { /* missing or corrupt: treat as empty */ }

  // The panel keeps its own map in memory; it is fresher than the file.
  try {
    const mem = deps && typeof deps.getPanelProjects === 'function' ? deps.getPanelProjects() : null;
    if (mem) {
      const entries = mem instanceof Map ? [...mem.entries()] : Object.entries(mem);
      for (const [key, value] of entries) {
        const project = typeof value === 'string' ? value : (value && value.project);
        if (typeof project === 'string' && project) {
          workspaces[key] = {
            project,
            cwd: (value && typeof value.cwd === 'string' && value.cwd) || key,
            at: String((value && value.at) || ''),
          };
        }
      }
    }
  } catch { /* ignore a hostile overlay */ }

  return { workspaces, legacy };
}

/** The workspace the calling session runs in, if the host exposed one. */
function workspaceCwd(exec) {
  try {
    const cwd = exec && exec.agent && exec.agent.session && exec.agent.session.header
      ? exec.agent.session.header.cwd
      : null;
    return typeof cwd === 'string' && cwd.trim() ? path.resolve(cwd) : null;
  } catch { return null; }
}

/** Binding recorded for exactly this workspace. */
function boundProject(store, key) {
  if (!key) return null;
  const entry = store.workspaces[key];
  return entry && typeof entry.project === 'string' ? entry.project : null;
}

/** Most recent remembered project that lives inside this workspace, other than its own binding. */
function projectInside(store, cwd, excludeKey) {
  if (!cwd) return null;
  const hits = Object.entries(store.workspaces)
    .filter(([key, value]) => key !== excludeKey && value && typeof value.project === 'string'
      && isInside(cwd, value.project))
    .sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || '')));
  return hits.length ? hits[0][1].project : null;
}

/**
 * Resolve the project a call should act on.
 *
 *   1. `explicit`                 the caller said exactly which project — always wins
 *   2. session workspace          exactly one `.uvprojx` in the session cwd
 *   3. workspace binding          remembered for this exact workspace
 *   4. panel / legacy hint        only when it belongs to this workspace
 *
 * Without a workspace context (a direct `executeTool` call in a unit test) the
 * chain degrades to the older "panel opened last" behaviour.
 *
 * @returns {{project:string|null, source:'explicit'|'workspace'|'panel'|'hint'|null,
 *   workspace:string|null, candidates?:string[], error?:string}}
 */
export async function resolveProject(deps, explicit, exec) {
  const cwd = workspaceCwd(exec);

  // Let the host remember which workspace each session actually runs in, so the
  // IDE panel can default to it even when the client cannot name its session.
  if (cwd && deps && typeof deps.noteSessionWorkspace === 'function') {
    try { deps.noteSessionWorkspace({ cwd, at: new Date().toISOString() }); } catch { /* ignore */ }
  }

  // 1) explicit path — the only deterministic entry point
  if (explicit && String(explicit).trim()) {
    const abs = path.resolve(String(explicit).trim());
    if (!(await isFile(abs))) {
      return { project: null, source: null, workspace: cwd, reason: 'explicit-missing', error: `工程文件不存在：${abs}` };
    }
    await rememberProject(abs, cwd);
    return { project: abs, source: 'explicit', workspace: cwd };
  }

  const store = await readStore(deps);
  const key = workspaceKey(cwd);

  if (cwd) {
    // 2) the session workspace is the primary binding
    const found = await findUvprojx(cwd, 4);
    if (found.length === 1) {
      await rememberProject(found[0], cwd);
      return { project: found[0], source: 'workspace', workspace: cwd };
    }
    if (found.length > 1) {
      const bound = boundProject(store, key);
      if (bound && found.some((f) => samePath(f, bound))) {
        return { project: bound, source: 'hint', workspace: cwd };
      }
      const chosen = projectInside(store, cwd, key);
      if (chosen && found.some((f) => samePath(f, chosen))) {
        return { project: chosen, source: 'panel', workspace: cwd };
      }
      return {
        project: null, source: null, workspace: cwd, candidates: found, reason: 'ambiguous',
        error: `本工作区发现 ${found.length} 个 Keil 工程，无法确定用哪个`,
      };
    }

    // 3) nothing to discover: fall back to a binding for this exact workspace
    const bound = boundProject(store, key);
    if (bound && (await isFile(bound))) {
      return { project: bound, source: 'hint', workspace: cwd };
    }

    // 4) a project opened elsewhere only counts when it sits inside this workspace
    const chosen = projectInside(store, cwd, key);
    if (chosen && (await isFile(chosen))) {
      return { project: chosen, source: 'panel', workspace: cwd };
    }
    if (store.legacy && isInside(cwd, store.legacy) && (await isFile(store.legacy))) {
      return { project: store.legacy, source: 'hint', workspace: cwd };
    }

    // Never silently act on a project from another workspace.
    return { project: null, source: null, workspace: cwd, reason: 'not-found', error: 'not-found' };
  }

  // No workspace context: degrade to the previous behaviour.
  const active = deps && typeof deps.getActiveProject === 'function' ? deps.getActiveProject() : null;
  if (active && (await isFile(active))) return { project: active, source: 'panel', workspace: null };

  const anyRemembered = Object.values(store.workspaces)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
  const fallback = (anyRemembered && anyRemembered.project) || store.legacy;
  if (fallback && (await isFile(fallback))) return { project: fallback, source: 'hint', workspace: null };

  return { project: null, source: null, workspace: null, error: 'not-found' };
}

const TOOL_DESCRIPTION = [
  '操作 Keil MDK (uvprojx) 嵌入式工程：查看工程、把源文件加入工程、移除、编译、烧录。',
  '典型场景：给 STM32 工程新增外设代码（GPIO、USART 串口、TIM 定时器、PWM、ADC、I2C、SPI、EXTI 中断、OLED 驱动），',
  '把文件挂进工程分组、编译、烧录/下载到芯片，或修「找不到头文件 gpio.h / C4065E / 编译不过」这类问题。',
  'action=add 会新建（或按 content 写入）一个源文件并把它挂进 Keil 工程分组——',
  '这是给 STM32 等 Keil 工程新增代码模块（如 GPIO 初始化）的正确方式，不要手工编辑 .uvprojx。',
  'action=link 只把磁盘上已有的文件挂进工程，不写文件。',
  'action=remove 是 add 的逆操作：只摘掉工程条目，默认不删磁盘文件（要删传 deleteFile:true）。',
  'action=repair 修复旧版本留下的问题：把文件类型按扩展名纠正（.h 必须是 5，写成 8 会让 UV4 去编译头文件并报 C4065E），并把工程用到的目录补进 include 路径。',
  'action=build/rebuild/clean/flash 分别对应 UV4 的 -b/-r/-c/-f。',
  '不传 project 时使用 IDE 面板里当前打开的工程。',
  'Keil MDK / STM32 (uvprojx) project work: inspect a project, add or link .c/.h files',
  '(GPIO, USART, TIM, PWM, ADC, I2C, SPI, EXTI, OLED), keep the C include path correct,',
  'build / rebuild / clean, and flash to the chip. Use action=add to create a module —',
  'never hand-edit the .uvprojx.',
].join('');

const ACTIONS = ['info', 'list', 'add', 'link', 'remove', 'repair', 'build', 'rebuild', 'clean', 'flash'];

/** UV4 flag → { verb } for the run actions. */
const RUN_ACTIONS = {
  '-b': { verb: '编译', diagnose: true },
  '-r': { verb: '重新编译', diagnose: true },
  '-c': { verb: '清理', diagnose: false },
  '-f': { verb: '烧录', diagnose: false },
};

/** Pick the requested target, else the project's first one. */
function pickTarget(project, name) {
  if (name) {
    const hit = project.targets.find((t) => t.name === name);
    if (hit) return hit;
  }
  return project.targets[0];
}

/** Keil-style relative directory of a project file (first path segment). */
function firstSegment(relPath) {
  const parts = String(relPath).replace(/^\.\\/, '').replace(/^\.\//, '').split(/[\\/]+/).filter(Boolean);
  return parts.length > 1 ? parts[0] : '';
}

/**
 * Choose the group for a file: (b) match the file's own directory against the
 * groups, and create a group named after that directory when none matches.
 */
export function chooseGroup(target, baseDir, fileAbs, explicit) {
  if (explicit && String(explicit).trim()) return String(explicit).trim();

  const rel = path.relative(baseDir, fileAbs);
  const seg = firstSegment(rel.split(path.sep).join('\\'));

  if (seg) {
    // 1) a group that already holds files from the same top-level directory
    for (const g of target.groups) {
      for (const f of g.files || []) {
        if (firstSegment(f.path).toLowerCase() === seg.toLowerCase()) return g.name;
      }
    }
    // 2) a group whose name matches that directory
    for (const g of target.groups) {
      if (String(g.name).toLowerCase() === seg.toLowerCase()) return g.name;
    }
    // 3) new group named after the directory
    return seg;
  }

  // Root-level file: reuse a group that already holds root-level files …
  for (const g of target.groups) {
    for (const f of g.files || []) {
      if (firstSegment(f.path) === '') return g.name;
    }
  }
  // … else prefer "User", else the first group, else create "User".
  const user = target.groups.find((g) => String(g.name).toLowerCase() === 'user');
  if (user) return user.name;
  if (target.groups.length > 0) return target.groups[0].name;
  return 'User';
}

/** A minimal skeleton so a freshly created file is not empty. */
function templateFor(file) {
  const name = path.basename(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.h') {
    const guard = name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
    return `#ifndef ${guard}\n#define ${guard}\n\n\n\n#endif\n`;
  }
  if (ext === '.c') return `/* ${name} */\n\n`;
  return '';
}

function actionInfo(project) {
  const lines = [`工程: ${project.path}`];
  const dbg = project.debuggerLabel || project.debuggerDll;
  if (dbg) lines.push(`调试器: ${dbg}`);
  lines.push(`Target 数: ${project.targets.length}`);
  for (const t of project.targets) {
    const files = t.groups.reduce((n, g) => n + (g.files || []).length, 0);
    lines.push(`- "${t.name}" · 芯片 ${t.device || '?'} · ${t.groups.length} 组 / ${files} 文件 · 输出 ${(t.outputDir || '') + (t.outputName || '')}`);
    // Include/Define come from Cads > VariousControls — the copies UV4 uses.
    lines.push(`  Include: ${t.includePath || '(空)'}`);
    lines.push(`  Define : ${t.define || '(空)'}`);
  }
  const groups = project.targets[0] ? project.targets[0].groups.map((g) => `${g.name}(${(g.files || []).length})`) : [];
  if (groups.length) lines.push('分组: ' + groups.join(', '));
  return {
    ok: true,
    message: lines.join('\n'),
    project: project.path,
    targets: project.targets.map((t) => ({
      name: t.name, device: t.device || '', includePath: t.includePath || '', define: t.define || '',
    })),
  };
}

function actionList(project, target) {
  const lines = [];
  const mismatched = [];
  for (const g of target.groups) {
    lines.push(`[${g.name}] ${(g.files || []).length} 个文件`);
    for (const f of g.files || []) {
      const want = fileTypeForName(f.name);
      const bad = f.type !== want;
      if (bad) mismatched.push({ file: f.path, from: f.type, to: want });
      const label = FILE_TYPE_LABELS[f.type] || '未知';
      lines.push(`  ${f.path}  [FileType ${f.type} ${label}${bad ? ` ⚠ 应为 ${want}` : ''}]`);
    }
  }
  if (mismatched.length) {
    lines.push('');
    lines.push(`⚠ ${mismatched.length} 个条目的 FileType 与扩展名不符，可用 action="repair" 修正：`);
    for (const m of mismatched) lines.push(`  ${m.file}: ${m.from} → ${m.to}`);
  }
  return {
    ok: true,
    message: lines.join('\n') || '(工程没有分组)',
    project: project.path,
    target: target.name,
    mismatchedFileTypes: mismatched,
  };
}

async function actionAdd(project, target, args, mayCreate) {
  const raw = String(args.file || '').trim();
  if (!raw) return { ok: false, message: 'add / link 需要 file 参数（相对工程目录或绝对路径）' };

  const fileAbs = /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/')
    ? path.resolve(raw)
    : path.resolve(project.baseDir, raw.replace(/\//g, path.sep));

  const existed = await isFile(fileAbs);
  const hadContent = typeof args.content === 'string' && args.content.length > 0;
  let contentWritten = false;
  if (hadContent) {
    await mkdir(path.dirname(fileAbs), { recursive: true });
    await writeFile(fileAbs, args.content, 'utf8');
    contentWritten = true;
  } else if (!existed) {
    if (!mayCreate) return { ok: false, message: `文件不存在：${fileAbs}` };
    await mkdir(path.dirname(fileAbs), { recursive: true });
    await writeFile(fileAbs, templateFor(fileAbs), 'utf8');
    contentWritten = true;
  }

  const rel = keilRelPath(project.baseDir, fileAbs);
  const wanted = fileTypeForName(fileAbs);
  const already = target.groups.some((g) => (g.files || []).some((f) => {
    const abs = path.resolve(project.baseDir, String(f.path).replace(/\\/g, path.sep));
    return abs.toLowerCase() === fileAbs.toLowerCase();
  }));

  if (already) {
    // The entry is there, but its FileType may be wrong (e.g. a `.h` recorded as
    // 8 by the pre-fix build). Self-heal it so re-running add is enough.
    const xml = decodeOutput(await readFile(project.path));
    const fixed = setFileTypeInUvprojx(xml, {
      targetName: target.name, filePath: rel, fileName: path.basename(fileAbs), fileType: wanted,
    });
    if (fixed.changed) await writeFile(project.path, fixed.xml, 'utf8');

    const lines = [];
    if (contentWritten) lines.push(`内容已写入 ${rel}`);
    else lines.push(`内容未改写（未提供 content）：${rel}`);
    lines.push(`工程条目已存在，未重复添加。`);
    if (fixed.changed) lines.push(`顺带修正 FileType：${fixed.from} → ${fixed.to}（${FILE_TYPE_LABELS[fixed.to] || '未知'}）`);
    return {
      ok: true,
      message: lines.join('\n'),
      file: fileAbs,
      relative: rel,
      created: false,
      contentWritten,
      entryExisted: true,
      fileTypeFixed: fixed.changed ? { from: fixed.from, to: fixed.to } : null,
    };
  }

  const groupName = chooseGroup(target, project.baseDir, fileAbs, args.group);
  const xml = decodeOutput(await readFile(project.path));
  const next = addFileToUvprojx(xml, {
    targetName: target.name,
    groupName,
    fileName: path.basename(fileAbs),
    filePath: rel,
    fileType: wanted,
  });
  await writeFile(project.path, next, 'utf8');

  return {
    ok: true,
    message: `已加入工程：${rel}\n分组「${groupName}」· Target「${target.name}」· ${existed ? '已有文件' : '新建文件'}`
      + (contentWritten ? (hadContent ? ' · 内容已写入' : ' · 已生成模板') : ''),
    file: fileAbs,
    relative: rel,
    group: groupName,
    target: target.name,
    created: !existed,
    contentWritten,
    entryExisted: false,
    fileTypeFixed: null,
  };
}

async function actionRemove(project, target, args) {
  const raw = String(args.file || '').trim();
  if (!raw) return { ok: false, message: 'remove 需要 file 参数（相对工程目录或绝对路径）' };

  const fileAbs = /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/')
    ? path.resolve(raw)
    : path.resolve(project.baseDir, raw.replace(/\//g, path.sep));
  const rel = keilRelPath(project.baseDir, fileAbs);

  const xml = decodeOutput(await readFile(project.path));
  const { xml: next, removed, includePathDropped } = removeFileFromUvprojx(xml, {
    targetName: target.name,
    filePath: rel,
    fileName: path.basename(fileAbs),
    groupName: args.group,
  });
  if (!removed) return { ok: false, message: `工程里没有这个条目：${rel}` };

  await writeFile(project.path, next, 'utf8');

  let fileDeleted = false;
  if (args.deleteFile === true) {
    if (await isFile(fileAbs)) { await rm(fileAbs, { force: true }); fileDeleted = true; }
  }

  const lines = [`已从工程移除：${removed.path}（分组「${removed.group}」，FileType ${removed.type}）`];
  if (includePathDropped) lines.push(`该目录已无其他文件引用，include 路径同步移除 .\\${includePathDropped}`);
  lines.push(fileDeleted ? '磁盘文件已删除。' : '磁盘文件保留（要删除请传 deleteFile: true）。');

  return {
    ok: true,
    message: lines.join('\n'),
    file: fileAbs,
    relative: rel,
    removed: { file: removed.path, group: removed.group, fileType: removed.type },
    includePathDropped: includePathDropped ? '.\\' + includePathDropped : null,
    fileDeleted,
  };
}

async function actionRepair(project, target) {
  const xml = decodeOutput(await readFile(project.path));
  const report = repairProject(xml, target.name);
  const { xml: next, fixedFileTypes, addedIncludePaths } = report;

  if (fixedFileTypes === 0 && addedIncludePaths === 0) {
    return {
      ok: true,
      message: `工程无需修复：已检查 ${report.checkedFiles} 个文件条目、${report.checkedDirs} 个目录，FileType 与 include 路径都正常。`,
      fixedFileTypes: 0,
      addedIncludePaths: 0,
      fixedTypes: [],
      includePathsAdded: [],
      checkedFiles: report.checkedFiles,
      checkedDirs: report.checkedDirs,
    };
  }

  await writeFile(project.path, next, 'utf8');
  const lines = [`已修复工程「${target.name}」（检查了 ${report.checkedFiles} 个文件条目、${report.checkedDirs} 个目录）：`];
  if (report.fixedTypes.length) {
    lines.push(`更正 FileType ${report.fixedTypes.length} 处：`);
    for (const f of report.fixedTypes) lines.push(`  ${f.file}: ${f.from} → ${f.to}`);
  }
  if (report.includePathsAdded.length) {
    lines.push(`补入 include 路径 ${report.includePathsAdded.length} 个：${report.includePathsAdded.join('; ')}`);
  }

  return {
    ok: true,
    message: lines.join('\n'),
    fixedFileTypes,
    addedIncludePaths,
    fixedTypes: report.fixedTypes,
    includePathsAdded: report.includePathsAdded,
    checkedFiles: report.checkedFiles,
    checkedDirs: report.checkedDirs,
  };
}

async function actionRun(project, target, action) {
  const spec = RUN_ACTIONS[action] || { verb: '构建', diagnose: false };
  const keil = await detectKeil();
  if (!keil.found) {
    return { ok: false, message: '未检测到 Keil MDK（UV4.exe）。请安装 Keil MDK，或在 IDE 面板设置 UV4 路径。' };
  }
  const slug = { '-b': 'build', '-r': 'rebuild', '-c': 'clean', '-f': 'flash' }[action] || 'run';
  const logFile = path.join(DSH_HOME, `dsh-ide-tool-${slug}-${Date.now()}.log`);
  const result = await runUv4Blocking({
    uv4: keil.uv4, action, project: project.path, target: target.name, logFile,
  });

  const ok = result.exitCode === 0;
  const lines = [`${spec.verb}${ok ? '成功' : '失败'}：${result.timedOut ? '超时' : exitMessage(result.exitCode)}`];

  let diagnostics;
  if (spec.diagnose) {
    diagnostics = parseBuildLog(result.output);
    lines.push(`错误 ${diagnostics.errors} · 警告 ${diagnostics.warnings}${diagnostics.programSize ? ' · ' + diagnostics.programSize : ''}`);
    for (const it of (diagnostics.issues || []).slice(0, 40)) {
      lines.push(`  ${it.file}(${it.line}): ${it.message}`);
    }
  } else {
    const tail = String(result.output || '').trim().split(/\r?\n/).slice(-12).join('\n');
    if (tail) lines.push(tail);
  }

  return {
    ok,
    message: lines.join('\n'),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    ...(diagnostics ? { errors: diagnostics.errors, warnings: diagnostics.warnings, issues: diagnostics.issues } : {}),
  };
}

/**
 * Strip anything that is not lossless JSON — notably `undefined`, which DSH's
 * tool-result validator rejects outright. Every result funnels through here.
 */
function lossless(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(lossless);
  const out = {};
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) continue;
    out[key] = lossless(value[key]);
  }
  return out;
}

/** Execute one tool call. Exported for tests. */
export async function executeTool(deps, args, exec) {
  try {
    return lossless(await runAction(deps, args || {}, exec));
  } catch (error) {
    return { ok: false, message: `工具执行异常：${(error && error.message) || error}` };
  }
}

/** Human-facing note about where the project came from. */
const SOURCE_LABELS = {
  explicit: '显式传入',
  workspace: '工作区自动发现',
  panel: 'IDE 面板（位于本工作区）',
  hint: '本工作区上次绑定',
};

async function runAction(deps, args, exec) {
  const action = String((args && args.action) || '').trim();
  if (!ACTIONS.includes(action)) {
    return { ok: false, message: `action 必须是 ${ACTIONS.join(' / ')} 之一（收到 "${action}"）` };
  }

  const resolved = await resolveProject(deps, args.project, exec);
  if (!resolved.project) {
    // An explicit path that does not exist is a caller mistake: say exactly that.
    if (resolved.reason === 'explicit-missing') {
      return { ok: false, message: resolved.error, workspace: resolved.workspace };
    }
    if (resolved.candidates && resolved.candidates.length) {
      return {
        ok: false,
        message: `没有可用的工程：${resolved.error}\n工作区：${resolved.workspace}\n候选：\n`
          + resolved.candidates.map((c) => '  ' + c).join('\n')
          + '\n请用 project 参数指定其中一个（绝对路径）。',
        workspace: resolved.workspace,
        candidates: resolved.candidates,
      };
    }
    const where = resolved.workspace ? `本工作区（${resolved.workspace}）未发现 Keil 工程` : '没有可用的工程';
    return {
      ok: false,
      message: `${where}。请传 project（.uvprojx 绝对路径），或把会话工作区设为工程所在目录。`,
      workspace: resolved.workspace,
    };
  }

  const projectPath = resolved.project;
  if (!(await isFile(projectPath))) {
    return { ok: false, message: `工程文件不存在：${projectPath}`, project: projectPath, projectSource: resolved.source };
  }

  let project;
  try {
    project = await loadProject(projectPath);
  } catch (error) {
    return { ok: false, message: `读取工程失败：${(error && error.message) || error}`, project: projectPath, projectSource: resolved.source };
  }
  if (!project.targets.length) {
    return { ok: false, message: `工程里没有 Target：${projectPath}`, project: projectPath, projectSource: resolved.source };
  }

  const target = pickTarget(project, args.target);
  if (!target) return { ok: false, message: `未找到 Target：${args.target}` };

  const stamp = { project: projectPath, projectSource: resolved.source };
  let result;
  switch (action) {
    case 'info': result = actionInfo(project); break;
    case 'list': result = actionList(project, target); break;
    case 'add': result = await actionAdd(project, target, args, true); break;
    case 'link': result = await actionAdd(project, target, args, false); break;
    case 'remove': result = await actionRemove(project, target, args); break;
    case 'repair': result = await actionRepair(project, target); break;
    case 'build': result = await actionRun(project, target, args.force === true ? '-r' : '-b'); break;
    case 'rebuild': result = await actionRun(project, target, '-r'); break;
    case 'clean': result = await actionRun(project, target, '-c'); break;
    case 'flash': result = await actionRun(project, target, '-f'); break;
    /* c8 ignore next */
    default: return { ok: false, message: `未支持的 action：${action}`, ...stamp };
  }

  const note = SOURCE_LABELS[resolved.source];
  const head = note
    ? `［工程：${path.basename(path.dirname(projectPath))} · 来源：${note}］\n`
    : '';
  return { ...result, ...stamp, message: head + result.message };
}

/** The hand-written registry definition (no DSH internal package needed). */
export function buildToolDefinition(deps) {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: 'info=工程概览(含 Include/Define)；list=分组与文件(带 FileType)；'
            + 'add=新建(或写入)文件并挂进工程；link=把已有文件挂进工程；'
            + 'remove=从工程移除条目(默认不删磁盘文件)；repair=修复文件类型与 include 路径；'
            + 'build=编译；rebuild=全量重编；clean=清理；flash=烧录',
        },
        project: { type: 'string', description: 'uvprojx 的绝对路径。省略时用 IDE 中当前打开的工程。' },
        group: { type: 'string', description: '目标分组名。省略时按文件所在目录自动匹配，没有就新建同名分组。' },
        target: { type: 'string', description: 'Keil Target 名。省略时用工程的第一个 Target。' },
        file: { type: 'string', description: '源文件路径：相对工程目录（如 Hardware/gpio.c）或绝对路径。add/link/remove 必填。' },
        content: { type: 'string', description: 'add 时写入文件的完整内容；省略则新建一个最小模板。' },
        deleteFile: { type: 'boolean', description: 'remove 时是否同时删除磁盘文件。默认 false（只摘工程条目）。' },
        force: { type: 'boolean', description: 'build 时传 true 等价于 rebuild（UV4 -r），强制全量重编而不是增量。' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(args, value) {
        return [{ type: 'text', text: String((value && value.message) || TOOL_NAME) }];
      },
    },
    // `exec` carries the calling agent, and therefore its session workspace.
    execute(args, exec) {
      return executeTool(deps, args || {}, exec);
    },
  };
}

/**
 * Register the tool on the host context. The `tools` service is a soft
 * dependency: absent, the plugin simply offers no tool.
 */
export function installTool(ctx, deps) {
  if (!ctx || typeof ctx.inject !== 'function') return;
  ctx.inject(['tools'], (scoped) => {
    const tools = (scoped && scoped.tools) || (typeof scoped.get === 'function' ? scoped.get('tools') : null);
    if (!tools || typeof tools.register !== 'function') return;
    scoped.effect(() => {
      const dispose = tools.register(buildToolDefinition(deps));
      return () => { try { dispose(); } catch { /* ignore */ } };
    }, 'dsh-ide: keil_project tool');
  });
}
