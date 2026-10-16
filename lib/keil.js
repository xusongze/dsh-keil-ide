/**
 * dsh-keil-ide — Keil MDK integration.
 *
 * Detects a Keil install, drives UV4.exe for build/flash, maps its exit codes,
 * and parses its build log into file:line diagnostics. Keil is Windows-only,
 * so every entry degrades gracefully elsewhere.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execCapture, decodeOutput, errText } from './util.js';

const UV4_COMMON_PATHS = [
  'C:\\Keil_v5\\UV4\\UV4.exe',
  'D:\\Keil_v5\\UV4\\UV4.exe',
  'D:\\Keil5\\UV4\\UV4.exe',
  'C:\\Keil\\UV4\\UV4.exe',
  'D:\\Keil\\UV4\\UV4.exe',
  'C:\\Program Files\\Keil_v5\\UV4\\UV4.exe',
  'C:\\Program Files (x86)\\Keil_v5\\UV4\\UV4.exe',
];

const REG_KEYS = [
  'HKLM\\SOFTWARE\\WOW6432Node\\Keil\\Products\\MDK',
  'HKLM\\SOFTWARE\\Keil\\Products\\MDK',
  'HKCU\\SOFTWARE\\Keil\\Products\\MDK',
];

export const UV4_EXIT = {
  0: '成功（无错误、无警告）',
  1: '有警告',
  2: '有错误',
  3: '致命错误',
  11: '无法打开工程',
  12: '器件错误',
  13: '写入错误',
  15: '读取错误',
  20: '许可证错误',
};
export const exitMessage = (code) => UV4_EXIT[code] || `退出码 ${code}`;

/**
 * Locate UV4.exe. Registry first, then common install paths.
 * @param {string} [overridePath] - a user-configured path to UV4.exe.
 */
export async function detectKeil(overridePath) {
  const candidates = [];
  let version = '';

  if (overridePath && overridePath.trim()) {
    candidates.push(path.resolve(overridePath.trim()));
  }

  if (process.platform === 'win32') {
    for (const key of REG_KEYS) {
      const r = await execCapture(`reg query "${key}"`);
      const pathMatch = /Path\s+REG_SZ\s+(.+)/i.exec(r.stdout);
      if (pathMatch) {
        const root = path.dirname(pathMatch[1].trim());
        candidates.push(path.join(root, 'UV4', 'UV4.exe'));
      }
      const verMatch = /Version\s+REG_SZ\s+(.+)/i.exec(r.stdout);
      if (verMatch && !version) version = verMatch[1].trim();
    }
  }

  candidates.push(...UV4_COMMON_PATHS);

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate.toLowerCase())) continue;
    seen.add(candidate.toLowerCase());
    if (existsSync(candidate)) {
      return {
        found: true,
        uv4: candidate,
        root: path.dirname(path.dirname(candidate)),
        version,
        platform: 'win32',
      };
    }
  }
  return { found: false, version, tried: [...seen] };
}

/** Map a uvoptx <pMon> DLL path to a human-readable debugger name. */
export function debuggerLabel(dll) {
  const d = String(dll || '').toLowerCase();
  if (d.includes('stlink') || d.includes('st-link') || d.includes('ablstcm')) return 'ST-Link';
  if (d.includes('jlink') || d.includes('segger') || d.includes('j-trace')) return 'J-Link';
  if (d.includes('cmsis') || d.includes('agdi') || d.includes('dap')) return 'CMSIS-DAP';
  if (d.includes('ul2') || d.includes('ulink')) return 'ULINK';
  if (d.includes('pext') || d.includes('pemicro')) return 'P&E Multilink';
  if (!d) return '';
  return dll;
}

/**
 * Drive UV4.exe and stream its log into a job.
 * action: '-b' build, '-r' rebuild, '-c' clean, '-f' flash.
 */
export function runUv4Job(job, opts) {
  const args = [opts.action, opts.project, '-j0', '-o', opts.logFile];
  if (opts.target) args.push('-t', opts.target);

  job.output += `$ "${opts.uv4}" ${args.map((a) => (/\\s/.test(a) ? `"${a}"` : a)).join(' ')}\n\n`;

  const child = spawn(opts.uv4, args, {
    windowsHide: true,
    cwd: path.dirname(opts.project),
  });

  let tailed = 0;
  const tailTimer = setInterval(() => {
    readFile(opts.logFile).then((buf) => {
      const text = decodeOutput(buf);
      if (text.length > tailed) {
        job.output += text.slice(tailed);
        tailed = text.length;
      }
    }).catch(() => { /* log not written yet */ });
  }, 400);

  if (child.stderr) child.stderr.on('data', (d) => { job.output += decodeOutput(d); });

  child.on('error', (e) => {
    clearInterval(tailTimer);
    job.status = 'error';
    job.error = errText(e);
    job.endedAt = Date.now();
  });

  child.on('close', (code) => {
    clearInterval(tailTimer);
    readFile(opts.logFile).then((buf) => {
      const text = decodeOutput(buf);
      if (text.length > tailed) job.output += text.slice(tailed);
      finish();
    }).catch(finish);

    function finish() {
      job.exitCode = code;
      job.status = 'done';
      job.endedAt = Date.now();
    }
  });

  return child;
}

/**
 * Drive UV4.exe and resolve once it exits — for tool calls that must return
 * the build/flash result itself rather than stream it into a job.
 * @returns {Promise<{exitCode:number|null, output:string, timedOut:boolean}>}
 */
export function runUv4Blocking(opts) {
  const timeoutMs = opts.timeoutMs ?? 300000;
  const args = [opts.action, opts.project, '-j0', '-o', opts.logFile];
  if (opts.target) args.push('-t', opts.target);

  return new Promise((resolve) => {
    let settled = false;
    let stderr = '';
    let timer = null;

    const finish = (exitCode, timedOut) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      readFile(opts.logFile).then((buf) => {
        resolve({ exitCode, output: stderr + decodeOutput(buf), timedOut });
      }).catch(() => {
        resolve({ exitCode, output: stderr, timedOut });
      });
    };

    let child;
    try {
      child = spawn(opts.uv4, args, { windowsHide: true, cwd: path.dirname(opts.project) });
    } catch (error) {
      resolve({ exitCode: null, output: errText(error), timedOut: false });
      return;
    }

    if (child.stderr) child.stderr.on('data', (d) => { stderr += decodeOutput(d); });
    child.on('error', (e) => { stderr += errText(e); finish(null, false); });
    child.on('close', (code) => finish(code, false));

    timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish(null, true);
    }, timeoutMs);
  });
}

/**
 * Parse Keil build output into structured diagnostics.
 * Handles lines like: `..\User\main.c(42): error: #20: identifier "x" is undefined`
 * and `(line,col)` variants, plus the final "N Error(s), M Warning(s)" tally.
 */
export function parseBuildLog(text) {
  const issues = [];
  let errors = 0;
  let warnings = 0;
  let programSize = '';

  const lineRe = /^(.*?)\((\d+)(?:\s*,\s*(\d+))?\):\s*(error|warning|fatal error)\s*:?\s*(.*)$/;

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const m = lineRe.exec(line);
    if (m) {
      const kind = m[4] === 'warning' ? 'warning' : 'error';
      if (kind === 'error') errors += 1; else warnings += 1;
      const issue = {
        file: m[1].trim(),
        line: Number(m[2]),
        kind,
        message: m[5].trim(),
      };
      // Omit the key entirely when the compiler reported no column: `undefined`
      // is not lossless JSON and the tool-result validator rejects it.
      if (m[3]) issue.col = Number(m[3]);
      issues.push(issue);
      continue;
    }
    const size = /Program Size:\s*(Code=[^\n]+)/.exec(line);
    if (size) programSize = size[1];
  }

  // If the explicit "N Error(s)" tally exists, trust it (it counts link errors too).
  const tally = /(\d+)\s+Error\(s\)\s*,\s*(\d+)\s+Warning\(s\)/.exec(String(text));
  if (tally) { errors = Number(tally[1]); warnings = Number(tally[2]); }

  return { issues, errors, warnings, programSize };
}
