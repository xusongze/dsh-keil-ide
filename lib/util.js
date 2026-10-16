/**
 * dsh-keil-ide — shared host helpers.
 */
import { readdir, readFile, writeFile, stat, chmod } from 'node:fs/promises';
import { exec } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

export const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export const MAX_READ_BYTES = 4 * 1024 * 1024; // 4 MiB text files
export const MAX_BODY_BYTES = 16 * 1024 * 1024; // 16 MiB write body
export const COMPILE_TIMEOUT_MS = 120000;

export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');

export const stateFilePath = () => path.join(DSH_HOME, 'dsh-ide-state.json');

/** Minimal JSON responder. */
export function sendJson(res, status, payload) {
  try {
    res.writeHead(status, JSON_HEADERS);
    res.end(JSON.stringify(payload));
  } catch {
    /* response already finished */
  }
}

/** Read a request body as UTF-8 text, bounded. */
export function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Normalize a path argument to an absolute path. */
export function toAbsolute(input) {
  if (typeof input !== 'string' || input.trim() === '') throw new Error('missing path');
  return path.resolve(input.trim());
}

export function errText(error) {
  return error && error.message ? error.message : String(error);
}

export async function isDirectory(p) {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

export async function isFile(p) {
  try { return (await stat(p)).isFile(); } catch { return false; }
}

/**
 * Is the file read-only on disk?
 *
 * The owner-write bit is the portable signal: Windows' FILE_ATTRIBUTE_READONLY
 * surfaces as a mode without `0o200`, so this works on both platforms.
 */
export async function isReadOnly(p) {
  try { return ((await stat(p)).mode & 0o200) === 0; } catch { return false; }
}

/**
 * Set or clear the read-only attribute.
 * @returns the resulting read-only state.
 */
export async function setReadOnly(p, readOnly) {
  await chmod(p, readOnly ? 0o444 : 0o666);
  return readOnly;
}

/** List directories and .c/.h files directly under a directory, with read-only flags. */
export async function listDirectory(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const dirs = [];
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) dirs.push({ name: entry.name, type: 'dir' });
    else if (entry.isFile() && /\.(c|h)$/i.test(entry.name)) {
      files.push({
        name: entry.name,
        type: 'file',
        readOnly: await isReadOnly(path.join(dirPath, entry.name)),
      });
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { dirs, files };
}

/** Substitute placeholders in a compile command template. */
export function expandCommand(template, file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const ext = path.extname(base);
  const name = ext ? base.slice(0, -ext.length) : base;
  const out = process.platform === 'win32' ? `${name}.exe` : name;
  const quote = (s) => `"${s.replace(/"/g, '\\"')}"`;
  return String(template ?? '')
    .replaceAll('{file}', quote(file))
    .replaceAll('{name}', quote(name))
    .replaceAll('{dir}', quote(dir))
    .replaceAll('{out}', quote(out));
}

/**
 * Decode raw process output: strict UTF-8 first, then GB18030 (GBK superset)
 * for Chinese Windows tools, then other CJK code pages.
 */
export function decodeOutput(input) {
  if (input === undefined || input === null) return '';
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  if (buf.length === 0) return '';
  let ascii = true;
  for (let i = 0; i < buf.length; i += 1) if (buf[i] >= 0x80) { ascii = false; break; }
  if (ascii) return buf.toString('ascii');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    for (const encoding of ['gb18030', 'big5', 'shift_jis']) {
      try { return new TextDecoder(encoding).decode(buf); } catch { /* try next */ }
    }
    return buf.toString('utf8');
  }
}

/** Run a compile command; resolves with decoded output and exit code. */
export function runCompile(command, cwd) {
  const execCommand = process.platform === 'win32' ? `chcp 65001 >nul && ${command}` : command;
  return new Promise((resolve) => {
    const child = exec(execCommand, {
      cwd, timeout: COMPILE_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'buffer',
    }, (error, stdout, stderr) => {
      resolve({
        stdout: decodeOutput(stdout),
        stderr: decodeOutput(stderr),
        exitCode: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
        timedOut: !!(error && error.killed),
      });
    });
    child.on('error', (err) => {
      resolve({ stdout: '', stderr: errText(err), exitCode: 1, timedOut: false });
    });
  });
}

/**
 * Run a command and capture its decoded output. Always resolves with
 * { stdout, stderr, exitCode } — used for `reg query` and other probes
 * where a non-zero exit is an expected "not found".
 */
export function execCapture(command, opts = {}) {
  return new Promise((resolve) => {
    exec(command, {
      encoding: 'buffer',
      windowsHide: true,
      timeout: opts.timeout ?? 15000,
      maxBuffer: opts.maxBuffer ?? 2 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        stdout: decodeOutput(stdout),
        stderr: decodeOutput(stderr),
        exitCode: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
      });
    });
  });
}
