/**
 * dsh-keil-ide — Keil uvprojx / uvoptx project parsing and editing.
 *
 * uvprojx is plain XML. We parse the specific tags we need (device, output,
 * include/define, groups and files) and edit files by targeted text insertion
 * — which preserves every other byte of Keil's formatting, unlike a full
 * re-serialisation.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeOutput, isReadOnly } from './util.js';

/** First match of `<tag>…</tag>`. */
function tagText(xml, tag) {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return m ? m[1] : '';
}

/** Every `<tag>…</tag>` block's inner text. */
function tagBlocks(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/**
 * Every `<tag>…</tag>` block with its offsets, so a caller can excise one block
 * by absolute position without re-serialising the document.
 * `innerAbs` is the offset of the inner text within the scanned string.
 */
function scanBlocks(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    out.push({
      inner: m[1],
      blockStart: m.index,
      blockEnd: re.lastIndex,
      innerAbs: m.index + tag.length + 2,
    });
  }
  return out;
}

/** Normalise a Keil path for comparison: `.\User\main.c` → `user\main.c`. */
function normKeilPath(p) {
  return String(p).replace(/\//g, '\\').replace(/^\.\\/, '').toLowerCase();
}

/** First block whose nested <nameTag> equals `name`. */
function findNamedBlock(xml, blockTag, nameTag, name) {
  const re = new RegExp(`<${blockTag}>([\\s\\S]*?)<\\/${blockTag}>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    if (tagText(m[1], nameTag) === name) {
      return {
        inner: m[1],
        start: m.index,
        end: re.lastIndex,
        innerAbs: m.index + blockTag.length + 2,
      };
    }
  }
  return null;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** First `<tag>…</tag>` block, with its inner text and absolute inner offset. */
function findBlock(xml, tag) {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  if (!m) return null;
  return { inner: m[1], start: m.index, innerAbs: m.index + tag.length + 2 };
}

/**
 * Read the C compiler's `<IncludePath>` / `<Define>` — the ones UV4 actually uses.
 *
 * A uvprojx carries `<IncludePath>` three times: an EMPTY one directly under
 * `<TargetOption>` (not the real one), the C one under
 * `TargetArmAds > Cads > VariousControls`, and a separate assembly one under
 * `<Aads>`. Only the Cads copy is effective, so it is always addressed
 * structurally rather than by "first tag wins".
 */
function readCControls(targetInner, tag) {
  const cads = findBlock(targetInner, 'Cads');
  if (!cads) return '';
  const vc = findBlock(cads.inner, 'VariousControls');
  if (!vc) return '';
  return tagText(vc.inner, tag);
}

/** Absolute [valueStart, valueEnd) of the Cads `<IncludePath>` text. */
function findCIncludePath(targetInner) {
  const cads = findBlock(targetInner, 'Cads');
  if (!cads) return null;
  const vc = findBlock(cads.inner, 'VariousControls');
  if (!vc) return null;
  const m = /<IncludePath>([\s\S]*?)<\/IncludePath>/.exec(vc.inner);
  if (!m) return null;
  const valueStart = cads.innerAbs + vc.innerAbs + m.index + '<IncludePath>'.length;
  return { value: m[1], valueStart, valueEnd: valueStart + m[1].length };
}

/** Top-level project directory of a Keil relative path: `.\Hardware\gpio.c` → `Hardware`. */
function topDirOfKeilPath(relPath) {
  const parts = String(relPath).replace(/^\.\\/, '').replace(/^\.\//, '').split(/[\\/]+/).filter(Boolean);
  const dirs = parts.slice(0, -1);
  return dirs.length ? dirs[0] : '';
}

/**
 * Append a file's top-level directory to the C include path, unless it is
 * already listed. Without this, `#include "gpio.h"` fails with
 * `#5: cannot open source input file` even though the file is in the project.
 * The existing value is kept verbatim; only the new entry is appended.
 */
function ensureIncludePath(xml, targetName, keilFilePath) {
  return ensureIncludePathSeg(xml, targetName, topDirOfKeilPath(keilFilePath));
}

/** Append `.\<seg>` to the C include path unless it is already listed. */
function ensureIncludePathSeg(xml, targetName, seg) {
  if (!seg) return xml;
  const entry = '.\\' + seg;

  const target = findNamedBlock(xml, 'Target', 'TargetName', targetName);
  if (!target) return xml;
  const range = findCIncludePath(target.inner);
  if (!range) return xml;

  const parts = String(range.value).split(';').map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => p.replace(/\//g, '\\').toLowerCase() === entry.toLowerCase())) return xml;

  const trimmed = String(range.value).replace(/\s+$/, '');
  const merged = trimmed === '' ? entry : trimmed + (/;$/.test(trimmed) ? '' : ';') + entry;

  const absStart = target.innerAbs + range.valueStart;
  const absEnd = target.innerAbs + range.valueEnd;
  return xml.slice(0, absStart) + merged + xml.slice(absEnd);
}

/**
 * Repair a project that an older build of this plugin (or a hand edit) left in
 * a non-building state:
 *
 *  - every file's `<FileType>` is re-derived from its extension — a `.h` written
 *    as 8 makes UV4 try to COMPILE the header and fail with
 *    `C4065E: type of input file '…h' unknown`;
 *  - every top-level directory that holds project files is present on the C
 *    include path — a missing entry breaks `#include "gpio.h"` with
 *    `#5: cannot open source input file`.
 *
 * Purely additive: no group, file or ordering is touched.
 *
 * The report carries both counts (for a one-line summary) and the details, so
 * a caller can state exactly what was checked and what changed.
 * @returns {{xml:string, fixedFileTypes:number, addedIncludePaths:number,
 *   fixedTypes:Array<{file:string,from:number,to:number}>,
 *   includePathsAdded:string[], checkedFiles:number, checkedDirs:number}}
 */
export function repairProject(xml, targetName) {
  let next = xml;
  let fixedFileTypes = 0;
  const fixedTypes = [];

  // 1) FileType per <File>, scoped to the selected target only.
  {
    const target = findNamedBlock(next, 'Target', 'TargetName', targetName);
    if (!target) throw new Error('未找到目标: ' + targetName);
    const fileRe = /(<File>[\s\S]*?<FileName>([^<]*)<\/FileName>\s*<FileType>)(\d+)(<\/FileType>)/g;
    const fixed = target.inner.replace(fileRe, (all, head, name, type, tail) => {
      const want = fileTypeForName(name);
      if (Number(type) === want) return all;
      fixedFileTypes += 1;
      fixedTypes.push({ file: name, from: Number(type), to: want });
      return head + String(want) + tail;
    });
    next = next.slice(0, target.innerAbs) + fixed + next.slice(target.innerAbs + target.inner.length);
  }

  // 2) include path covers every top-level directory used by the project.
  let addedIncludePaths = 0;
  const includePathsAdded = [];
  let checkedDirs = 0;
  {
    const target = findNamedBlock(next, 'Target', 'TargetName', targetName);
    const segs = [];
    for (const group of tagBlocks(tagText(target.inner, 'Groups'), 'Group')) {
      for (const fb of tagBlocks(tagText(group, 'Files'), 'File')) {
        const seg = topDirOfKeilPath(tagText(fb, 'FilePath'));
        if (seg && !segs.some((s) => s.toLowerCase() === seg.toLowerCase())) segs.push(seg);
      }
    }
    checkedDirs = segs.length;
    for (const seg of segs) {
      const before = next;
      next = ensureIncludePathSeg(next, targetName, seg);
      if (next !== before) {
        addedIncludePaths += 1;
        includePathsAdded.push('.\\' + seg);
      }
    }
  }

  return {
    xml: next,
    fixedFileTypes,
    addedIncludePaths,
    fixedTypes,
    includePathsAdded,
    checkedFiles: (xml.match(/<File>/g) || []).length,
    checkedDirs,
  };
}

export const FILE_TYPE_LABELS = {
  1: 'C 源文件',
  2: '汇编文件',
  3: '目标文件',
  4: '文本文件',
  5: '头文件',
  8: 'C++ 源文件',
};

/**
 * Keil FileType for a filename extension.
 *
 * Verified against a real STM32 project: every existing `.h` entry carries
 * FileType **5**. Writing 8 for a header makes UV4 try to COMPILE it and fail
 * with `C4065E: type of input file '…h' unknown` (8 is the C++ source type).
 */
export function fileTypeForName(name) {
  const ext = path.extname(String(name)).toLowerCase();
  switch (ext) {
    case '.c': return 1;
    case '.s': case '.asm': case '.sx': return 2;
    case '.cpp': case '.cc': case '.cxx': case '.c++': return 8;
    case '.h': case '.hpp': case '.hh': case '.hxx': case '.inc': return 5;
    default: return 4;
  }
}

/** Parse a uvprojx XML document into its targets. */
export function parseProject(xml) {
  const targets = [];
  for (const block of tagBlocks(xml, 'Target')) {
    const target = {
      name: tagText(block, 'TargetName'),
      device: tagText(block, 'Device'),
      vendor: tagText(block, 'Vendor'),
      cpu: tagText(block, 'Cpu'),
      outputDir: tagText(block, 'OutputDirectory'),
      outputName: tagText(block, 'OutputName'),
      createHex: tagText(block, 'CreateHexFile'),
      define: readCControls(block, 'Define'),
      includePath: readCControls(block, 'IncludePath'),
      groups: [],
    };
    const groupsBlock = tagText(block, 'Groups');
    for (const gb of tagBlocks(groupsBlock, 'Group')) {
      const group = { name: tagText(gb, 'GroupName'), files: [] };
      const filesBlock = tagText(gb, 'Files');
      for (const fb of tagBlocks(filesBlock, 'File')) {
        group.files.push({
          name: tagText(fb, 'FileName'),
          type: Number(tagText(fb, 'FileType') || '1') || 1,
          path: tagText(fb, 'FilePath'),
        });
      }
      target.groups.push(group);
    }
    targets.push(target);
  }
  return targets;
}

/** Parse a uvoptx for the debugger DLL (pMon). */
export function parseOptions(xml) {
  return { debuggerDll: tagText(xml, 'pMon') };
}

/** Directories that never hold the project to bind to (build output, tooling). */
const SKIP_DIRS = new Set([
  'objects', 'listings', 'rte', 'debugconfig', 'node_modules',
  'build', 'bin', 'output', 'out', 'temp', 'tmp',
]);

/** Recursively collect .uvprojx paths under a directory, bounded by depth. */
export async function findUvprojx(dir, maxDepth = 5) {
  const results = [];
  async function walk(d, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const lower = e.name.toLowerCase();
      if (SKIP_DIRS.has(lower)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile() && lower.endsWith('.uvprojx')) results.push(full);
    }
  }
  await walk(dir, 0);
  return results;
}

/** Load a project: uvprojx targets + the uvoptx debugger DLL. */
export async function loadProject(uvprojxPath) {
  const xml = decodeOutput(await readFile(uvprojxPath));
  const targets = parseProject(xml);
  const baseDir = path.dirname(uvprojxPath);
  let debuggerDll = '';
  try {
    const optx = uvprojxPath.replace(/\.uvprojx$/i, '.uvoptx');
    debuggerDll = parseOptions(decodeOutput(await readFile(optx))).debuggerDll;
  } catch { /* no uvoptx */ }
  // Resolve every file's project-relative path to an absolute path the client
  // can open directly, and record whether the file is protected on disk so the
  // tree can mark it before the user tries to edit library code.
  await Promise.all(targets.flatMap((target) => target.groups.flatMap((group) => group.files.map(async (file) => {
    file.abs = resolveProjectFile(baseDir, file.path);
    file.readOnly = await isReadOnly(file.abs);
  }))));
  return { path: uvprojxPath, baseDir, targets, debuggerDll };
}

/** Resolve a project-relative Keil path (.\User\main.c) to an absolute path. */
export function resolveProjectFile(baseDir, relPath) {
  return path.resolve(baseDir, String(relPath).replace(/\\/g, path.sep));
}

/** Produce a Keil-style relative path (.\User\main.c) from an absolute path. */
export function keilRelPath(baseDir, absPath) {
  const rel = path.relative(baseDir, absPath).split(path.sep).join('\\');
  return rel.startsWith('.') ? rel : '.\\' + rel;
}

function fileIndent(targetInner) {
  const m = /(\r?\n)([ \t]*)<File>/.exec(targetInner);
  return m ? m[2] : '              ';
}
function groupIndent(targetInner) {
  const m = /(\r?\n)([ \t]*)<Group>/.exec(targetInner);
  if (m) return m[2];
  const g = /(\r?\n)([ \t]*)<Groups>/.exec(targetInner);
  return g ? g[2] + '  ' : '      ';
}

/**
 * Add a file to a group (creating the group if it does not exist) by targeted
 * text insertion. Returns the new XML text.
 */
export function addFileToUvprojx(xml, opts) {
  const { targetName, groupName, fileName, filePath, fileType } = opts;
  const EOL = xml.includes('\r\n') ? '\r\n' : '\n';
  const target = findNamedBlock(xml, 'Target', 'TargetName', targetName);
  if (!target) throw new Error('未找到目标: ' + targetName);

  const indent = fileIndent(target.inner);
  const newFileBlock = [
    `${indent}<File>`,
    `${indent}  <FileName>${escapeXml(fileName)}</FileName>`,
    `${indent}  <FileType>${fileType ?? 1}</FileType>`,
    `${indent}  <FilePath>${escapeXml(filePath)}</FilePath>`,
    `${indent}</File>`,
  ].join(EOL);

  let next;
  const group = findNamedBlock(target.inner, 'Group', 'GroupName', groupName);
  if (group) {
    const filesClose = group.inner.lastIndexOf('</Files>');
    if (filesClose === -1) throw new Error('分组没有 <Files>: ' + groupName);
    const nl = group.inner.lastIndexOf('\n', filesClose - 1);
    const abs = target.innerAbs + group.innerAbs + (nl === -1 ? filesClose : nl + 1);
    next = xml.slice(0, abs) + newFileBlock + EOL + xml.slice(abs);
  } else {
    // Group does not exist: create it before </Groups>.
    const groupsClose = target.inner.lastIndexOf('</Groups>');
    if (groupsClose === -1) throw new Error('目标没有 <Groups>');
    const gIndent = groupIndent(target.inner);
    const newGroupBlock = [
      `${gIndent}<Group>`,
      `${gIndent}  <GroupName>${escapeXml(groupName)}</GroupName>`,
      `${gIndent}  <Files>`,
      `${gIndent}    <File>`,
      `${gIndent}      <FileName>${escapeXml(fileName)}</FileName>`,
      `${gIndent}      <FileType>${fileType ?? 1}</FileType>`,
      `${gIndent}      <FilePath>${escapeXml(filePath)}</FilePath>`,
      `${gIndent}    </File>`,
      `${gIndent}  </Files>`,
      `${gIndent}</Group>`,
    ].join(EOL);
    const nl = target.inner.lastIndexOf('\n', groupsClose - 1);
    const abs = target.innerAbs + (nl === -1 ? groupsClose : nl + 1);
    next = xml.slice(0, abs) + newGroupBlock + EOL + xml.slice(abs);
  }

  // A file in a new directory needs that directory on the C include path,
  // otherwise `#include "gpio.h"` fails with `#5: cannot open source input file`.
  return ensureIncludePath(next, targetName, filePath);
}

/**
 * Locate one `<File>` entry. Matching prefers the Keil-relative path and falls
 * back to the bare file name. Returns absolute offsets so the block can be
 * excised or patched in place, plus the group that holds it.
 */
function findFileEntry(xml, opts) {
  const { targetName, filePath, fileName, groupName } = opts;
  const target = findNamedBlock(xml, 'Target', 'TargetName', targetName);
  if (!target) throw new Error('未找到目标: ' + targetName);
  const wantPath = filePath ? normKeilPath(filePath) : '';
  const wantName = fileName ? String(fileName) : '';
  if (!wantPath && !wantName) return null;

  for (const group of scanBlocks(target.inner, 'Group')) {
    const gName = tagText(group.inner, 'GroupName');
    if (groupName && gName !== groupName) continue;
    const files = findBlock(group.inner, 'Files');
    if (!files) continue;
    for (const file of scanBlocks(files.inner, 'File')) {
      const name = tagText(file.inner, 'FileName');
      const path = tagText(file.inner, 'FilePath');
      const hit = wantPath ? normKeilPath(path) === wantPath : name === wantName;
      if (!hit) continue;
      const base = target.innerAbs + group.innerAbs + files.innerAbs;
      return {
        group: gName,
        name,
        path,
        type: Number(tagText(file.inner, 'FileType') || '1') || 1,
        blockStart: base + file.blockStart,
        blockEnd: base + file.blockEnd,
        innerBase: base + file.innerAbs,
        fileInner: file.inner,
      };
    }
  }
  return null;
}

/** Remove `.\<seg>` from the C include path if present. */
function dropIncludePathSeg(xml, targetName, seg) {
  const target = findNamedBlock(xml, 'Target', 'TargetName', targetName);
  if (!target) return xml;
  const range = findCIncludePath(target.inner);
  if (!range) return xml;
  const entry = '.\\' + seg;
  const parts = String(range.value).split(';').map((s) => s.trim()).filter(Boolean);
  const kept = parts.filter((p) => p.replace(/\//g, '\\').toLowerCase() !== entry.toLowerCase());
  if (kept.length === parts.length) return xml;
  const absStart = target.innerAbs + range.valueStart;
  const absEnd = target.innerAbs + range.valueEnd;
  return xml.slice(0, absStart) + kept.join(';') + xml.slice(absEnd);
}

/** Does any remaining project file live in this top-level directory? */
function anyFileInDir(xml, targetName, seg) {
  const target = findNamedBlock(xml, 'Target', 'TargetName', targetName);
  if (!target) return false;
  const want = seg.toLowerCase();
  for (const group of scanBlocks(target.inner, 'Group')) {
    const files = findBlock(group.inner, 'Files');
    if (!files) continue;
    for (const file of scanBlocks(files.inner, 'File')) {
      if (topDirOfKeilPath(tagText(file.inner, 'FilePath')).toLowerCase() === want) return true;
    }
  }
  return false;
}

/**
 * Remove one `<File>` entry from a target — the exact inverse of
 * {@link addFileToUvprojx}. The disk file is never touched here.
 *
 * The removed block's own indentation and the EOL before it are swallowed too,
 * so no blank line is left behind and every other byte stays put. When the
 * entry was the last one in its top-level directory, the matching `.\Dir` is
 * dropped from the C include path (symmetric with the add-side maintenance).
 *
 * The group itself is kept even when it becomes empty — collapsing groups is
 * deliberately not part of this operation.
 *
 * @returns {{xml:string, removed:{group:string,name:string,path:string,type:number}|null, includePathDropped:string|null}}
 */
export function removeFileFromUvprojx(xml, opts) {
  const entry = findFileEntry(xml, opts);
  if (!entry) return { xml, removed: null, includePathDropped: null };

  // swallow the indentation + EOL that preceded the block
  let start = entry.blockStart;
  while (start > 0 && (xml[start - 1] === ' ' || xml[start - 1] === '\t')) start -= 1;
  if (start > 0 && xml[start - 1] === '\n') {
    start -= 1;
    if (start > 0 && xml[start - 1] === '\r') start -= 1;
  }

  let next = xml.slice(0, start) + xml.slice(entry.blockEnd);

  const seg = topDirOfKeilPath(entry.path);
  let includePathDropped = null;
  if (seg && !anyFileInDir(next, opts.targetName, seg)) {
    const pruned = dropIncludePathSeg(next, opts.targetName, seg);
    if (pruned !== next) { includePathDropped = seg; next = pruned; }
  }

  return {
    xml: next,
    removed: { group: entry.group, name: entry.name, path: entry.path, type: entry.type },
    includePathDropped,
  };
}

/**
 * Correct one existing entry's `<FileType>` in place.
 * @returns {{xml:string, changed:boolean, from:number|null, to:number}}
 */
export function setFileTypeInUvprojx(xml, opts) {
  const entry = findFileEntry(xml, opts);
  const want = opts.fileType;
  if (!entry) return { xml, changed: false, from: null, to: want };
  const m = /<FileType>(\d+)<\/FileType>/.exec(entry.fileInner);
  if (!m) return { xml, changed: false, from: null, to: want };
  const from = Number(m[1]);
  if (from === want) return { xml, changed: false, from, to: want };
  const at = entry.innerBase + m.index;
  return {
    xml: xml.slice(0, at) + `<FileType>${want}</FileType>` + xml.slice(at + m[0].length),
    changed: true,
    from,
    to: want,
  };
}
