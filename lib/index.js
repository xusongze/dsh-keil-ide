/**
 * dsh-keil-ide — host half.
 *
 * HTTP API under /dsh-ide/* for the client bundle: plain file browsing/editing,
 * a gcc compile, and — the Keil tier — uvprojx project parsing, build and flash
 * through UV4.exe, plus adding files into a project group like µVision does.
 */
import path from 'node:path';
import os from 'node:os';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import {
  MAX_READ_BYTES, sendJson, readBody, toAbsolute, errText, isDirectory, isFile,
  listDirectory, expandCommand, runCompile, decodeOutput, DSH_HOME, stateFilePath,
  isReadOnly, setReadOnly,
} from './util.js';
import { detectKeil, runUv4Job, parseBuildLog, exitMessage, debuggerLabel } from './keil.js';
import { findUvprojx, loadProject, addFileToUvprojx, keilRelPath, fileTypeForName, resolveProjectFile } from './project.js';
import { createJob, getJob, jobView } from './jobs.js';
import { installTool, workspaceKey, listWorkspaces, rememberProject } from './tool.js';
import { installSkill } from './skill.js';
import {
  runtimeFacts, servingPort, scheduleWebRestart, prefetchRuntimeFacts, killHost,
} from './restart.js';

export const name = 'dsh-ide';
export const inject = ['webServer'];

/** Fresh identity per boot: the client uses a change to detect that the restart landed. */
const BOOT_ID = `${new Date().toISOString()}-${process.pid}`;

/**
 * Fence every route to a direct request from the machine running DSH.
 *
 * This plugin reads, writes, builds and flashes local files, so it is a local
 * tool, and three fences are needed:
 *
 *  1. the peer must be a loopback address, and no forwarding header may be
 *     present (something is proxying if one is);
 *  2. the `Host` must itself be a loopback name. This is the one that stops DNS
 *     rebinding: a hostile name that resolves to 127.0.0.1 makes the attacker's
 *     page SAME-ORIGIN with this server, and same-origin requests send no CORS
 *     preflight at all — so requiring a JSON `Content-Type` cannot help there,
 *     only the Host can;
 *  3. anything with a body must be `application/json`, which forces a preflight
 *     for the ordinary cross-site POST case.
 *
 * Escapes for intentional setups:
 *   - `DSH_IDE_ALLOWED_HOSTS=a.local,b.internal` — extra loopback-proxied names
 *   - `DSH_IDE_ALLOW_REMOTE=1` — disable the fence entirely (LAN / remote DSH)
 */
const ALLOW_REMOTE = process.env.DSH_IDE_ALLOW_REMOTE === '1';
const EXTRA_HOSTS = String(process.env.DSH_IDE_ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim().replace(/:\d+$/, '').toLowerCase())
  .filter(Boolean);

function localOnly(req) {
  if (ALLOW_REMOTE) return true;
  const headers = (req && req.headers) || {};
  const address = req && req.socket ? req.socket.remoteAddress : null;
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false;
  if (headers.forwarded !== undefined
    || headers['x-forwarded-for'] !== undefined
    || headers['x-real-ip'] !== undefined) return false;
  const host = String(headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (host && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' && EXTRA_HOSTS.indexOf(host) === -1) {
    return false;
  }
  return true;
}

/**
 * Register the restart endpoints. `register` is the host half's route helper.
 *
 * Only a direct loopback browser may drive this: a restart request has to come
 * from the machine running DSH itself, never through a proxy or a rebinding
 * page that merely reaches 127.0.0.1.
 */
function installRestartRoutes(register) {
  let restartInFlight = null;

  const loopbackPeer = (req) => {
    const address = req && req.socket ? req.socket.remoteAddress : null;
    if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false;
    if (req.headers.forwarded !== undefined || req.headers['x-forwarded-for'] !== undefined || req.headers['x-real-ip'] !== undefined) return false;
    return true;
  };

  register({
    kind: 'exact',
    path: '/dsh-ide/boot',
    handler: (req, res) => {
      sendJson(res, 200, { ok: true, bootId: BOOT_ID, pid: process.pid });
    },
  });

  register({
    kind: 'exact',
    path: '/dsh-ide/restart',
    handler: async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'POST required' }); return; }
      if (!loopbackPeer(req)) { sendJson(res, 403, { ok: false, error: '只能从本机直连请求重启' }); return; }
      if (restartInFlight !== null) {
        sendJson(res, 409, { ok: false, error: '已在重启中', mode: restartInFlight, since: restartInFlight.since });
        return;
      }
      let facts = { embedded: false, supervised: false, debugged: false };
      try { facts = await runtimeFacts(); } catch { /* probes are best-effort */ }
      const mode = facts.embedded ? 'embedded' : 'web';
      const since = new Date().toISOString();
      restartInFlight = { mode, since };

      if (mode === 'web') {
        // Hand the port over cleanly: the helper waits for it and replays this
        // exact invocation, so plain `dsh web` really does come back by itself.
        let plan = null;
        try {
          plan = scheduleWebRestart(servingPort(req));
        } catch (error) {
          restartInFlight = null;
          sendJson(res, 500, { ok: false, error: '无法启动重启守护进程: ' + errText(error) });
          return;
        }
        sendJson(res, 200, {
          ok: true, mode, bootId: BOOT_ID, since, logs: plan,
          message: '宿主进程即将退出，重启守护进程会在端口释放后拉起新的 dsh。',
        });
      } else {
        sendJson(res, 200, {
          ok: true, mode, bootId: BOOT_ID, since, timeoutMs: 2500,
          supervised: facts.supervised, debugged: facts.debugged,
          message: '宿主进程即将退出。桌面应用会弹出「启动失败」恢复对话框，点其中的「重启」即可带着新插件回来。',
        });
      }

      // Give the response time to flush, then take the host down. No request
      // needs to reach us afterwards.
      killHost(mode === 'web' ? 600 : 250);
    },
  });
}


export function apply(ctx) {
  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') return () => {};

  const disposers = [];
  /**
   * Projects opened in the IDE panel, keyed by the workspace they belong to.
   * Keying by workspace instead of one global value is what stops a session in
   * workspace A from hijacking the `keil_project` target of a session in B.
   */
  const panelProjects = new Map();
  const mostRecentPanelProject = () => {
    const entries = [...panelProjects.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return entries.length ? entries[0].project : null;
  };

  /**
   * Session workspaces the host has actually observed, newest first.
   *
   * The root-scoped `main` slot that hosts the IDE panel receives no Session
   * binding, so the panel cannot name its own conversation. Two things fill
   * that gap: the client's session-scoped composer toggle (which does receive
   * `sessionId` and resolves the workspace itself), and this record, learned
   * from every `keil_project` call (`exec.agent.session.header.cwd`).
   */
  const sessionWorkspaces = [];
  const noteSessionWorkspace = (entry) => {
    if (!entry || typeof entry.cwd !== 'string' || !entry.cwd) return;
    const key = workspaceKey(entry.cwd);
    const at = entry.at || new Date().toISOString();
    const existing = sessionWorkspaces.findIndex((w) => workspaceKey(w.cwd) === key);
    if (existing !== -1) sessionWorkspaces.splice(existing, 1);
    sessionWorkspaces.unshift({ cwd: entry.cwd, at });
    if (sessionWorkspaces.length > 20) sessionWorkspaces.length = 20;
  };
  const latestSessionWorkspace = () => (sessionWorkspaces.length ? sessionWorkspaces[0].cwd : null);

  /**
   * Where the panel's file browser should start.
   *
   * `process.cwd()` is the DSH install directory, which is never where the user
   * works. Order: an explicit request, then the session workspace actually
   * observed for a conversation, then the panel's own open project, then any
   * remembered workspace, and only then the host cwd.
   */
  const defaultPanelCwd = async (requested) => {
    if (requested) return { cwd: requested, cwdSource: 'requested' };
    const session = latestSessionWorkspace();
    if (session && (await isDirectory(session))) return { cwd: session, cwdSource: 'session-workspace' };
    const opened = mostRecentPanelProject();
    if (opened) {
      const dir = path.dirname(opened);
      if (await isDirectory(dir)) return { cwd: dir, cwdSource: 'panel-project' };
    }
    try {
      for (const ws of await listWorkspaces({ getPanelProjects: () => panelProjects })) {
        const candidate = ws.cwd || ws.key;
        if (candidate && (await isDirectory(candidate))) return { cwd: candidate, cwdSource: 'agent-workspace' };
      }
    } catch { /* no bindings yet */ }
    return { cwd: process.cwd(), cwdSource: 'host-cwd' };
  };

  /**
   * What the IDE panel should show for a workspace: the one project, a candidate
   * list, or an explicit "nothing here" — never a project from elsewhere.
   */
  const resolveWorkspace = async (cwd, prefer) => {
    const discovered = await findUvprojx(cwd, 4);
    const same = (a, b) => workspaceKey(a) === workspaceKey(b);
    const remembered = (await listWorkspaces({ getPanelProjects: () => panelProjects }))
      .find((w) => workspaceKey(w.cwd || w.key) === workspaceKey(cwd));

    if (discovered.length === 1) return { project: discovered[0], candidates: [], reason: null };
    if (discovered.length > 1) {
      const pick = [prefer, remembered && remembered.project]
        .find((c) => c && discovered.some((d) => same(d, c)));
      if (pick) return { project: pick, candidates: discovered, reason: 'remembered' };
      return { project: null, candidates: discovered, reason: 'ambiguous' };
    }

    // Nothing to discover: only a remembered/preferred project may stand in,
    // and it must still exist — otherwise this workspace genuinely has none.
    for (const candidate of [prefer, remembered && remembered.project]) {
      if (candidate && (await isFile(candidate))) {
        return { project: candidate, candidates: [], reason: 'remembered' };
      }
    }
    return { project: null, candidates: [], reason: 'not-found' };
  };
  /**
   * Every route goes through here, and it fences each one before the handler
   * can touch a path or spawn a process:
   *
   *  - `localOnly` rejects a non-loopback peer, a proxied request and a
   *    non-loopback `Host` (site POST / DNS rebinding);
   *  - a JSON `Content-Type` is required for anything with a body, which forces
   *    a CORS preflight and blocks the "simple request" bypass outright.
   */
  const register = (route) => {
    const handler = route.handler;
    const guarded = async (req, res) => {
      if (!localOnly(req)) {
        sendJson(res, 403, {
          ok: false,
          error: '仅允许本机直连访问。若确实需要远程使用，请设置 DSH_IDE_ALLOW_REMOTE=1 后重启 DSH。',
        });
        return;
      }
      // Only a request that actually carries a body has to be JSON. A bodyless
      // POST (the restart call) sends no Content-Type at all and must pass.
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const headers = (req && req.headers) || {};
        const hasBody = Number(headers['content-length'] || 0) > 0 || headers['transfer-encoding'] !== undefined;
        const type = String(headers['content-type'] || '').toLowerCase();
        if (hasBody && !type.startsWith('application/json')) {
          sendJson(res, 415, { ok: false, error: '需要 Content-Type: application/json' });
          return;
        }
      }
      return handler(req, res);
    };

    let dispose;
    try { dispose = webServer.register({ ...route, handler: guarded }); }
    catch (error) { try { console.warn('[dsh-ide] route register failed:', errText(error)); } catch {} return; }
    if (typeof dispose === 'function') disposers.push(dispose);
  };

  mkdir(DSH_HOME, { recursive: true }).catch(() => {});

  // --- host facts -------------------------------------------------------
  register({
    kind: 'exact',
    path: '/dsh-ide/info',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const asked = url.searchParams.get('cwd');
        const picked = await defaultPanelCwd(asked ? toAbsolute(asked) : null);
        sendJson(res, 200, {
          ...picked,
          workspaces: await listWorkspaces({ getPanelProjects: () => panelProjects }),
          home: os.homedir(),
          platform: process.platform,
          separator: path.sep,
        });
      } catch (error) { sendJson(res, 400, { ok: false, error: errText(error) }); }
    },
  });

  // --- what should the IDE panel load for a workspace? -------------------
  // The client passes its session workspace when it knows it (the session-scoped
  // composer toggle resolves it from `useWorkspaces`). The host falls back to a
  // workspace it has observed, and reports an explicit "nothing here" instead of
  // ever substituting a project from somewhere else.
  register({
    kind: 'exact',
    path: '/dsh-ide/workspace',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const asked = url.searchParams.get('cwd');
        const prefer = url.searchParams.get('prefer');
        const picked = await defaultPanelCwd(asked ? toAbsolute(asked) : null);
        if (!(await isDirectory(picked.cwd))) {
          sendJson(res, 200, {
            ok: true, cwd: picked.cwd, cwdSource: picked.cwdSource,
            project: null, candidates: [], reason: 'not-a-directory',
          });
          return;
        }
        const found = await resolveWorkspace(picked.cwd, prefer ? toAbsolute(prefer) : null);
        let projectPath = found.project;
        if (projectPath) {
          try {
            const project = await loadProject(projectPath);
            project.debuggerLabel = debuggerLabel(project.debuggerDll);
            sendJson(res, 200, {
              ok: true, cwd: picked.cwd, cwdSource: picked.cwdSource,
              project, candidates: found.candidates, reason: found.reason,
            });
            return;
          } catch { projectPath = null; }
        }
        sendJson(res, 200, {
          ok: true, cwd: picked.cwd, cwdSource: picked.cwdSource,
          project: null, candidates: found.candidates, reason: found.reason || 'not-found',
        });
      } catch (error) { sendJson(res, 400, { ok: false, error: errText(error) }); }
    },
  });

  // --- directory browsing ----------------------------------------------
  register({
    kind: 'exact',
    path: '/dsh-ide/list',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const raw = url.searchParams.get('path');
        // An empty path means "the panel's root", which is the session
        // workspace rather than the DSH install directory.
        const dirPath = raw ? toAbsolute(raw) : (await defaultPanelCwd()).cwd;
        if (!(await isDirectory(dirPath))) { sendJson(res, 404, { ok: false, error: 'not a directory: ' + dirPath }); return; }
        sendJson(res, 200, { ok: true, path: dirPath, ...(await listDirectory(dirPath)) });
      } catch (error) { sendJson(res, 400, { ok: false, error: errText(error) }); }
    },
  });

  // --- file read / write ------------------------------------------------
  register({
    kind: 'exact',
    path: '/dsh-ide/read',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const filePath = toAbsolute(url.searchParams.get('path') ?? '');
        if (!(await isFile(filePath))) { sendJson(res, 404, { ok: false, error: 'not a file: ' + filePath }); return; }
        const buf = await readFile(filePath);
        if (buf.length > MAX_READ_BYTES) { sendJson(res, 413, { ok: false, error: 'file too large to open in the editor' }); return; }
        sendJson(res, 200, {
          ok: true, path: filePath, content: decodeOutput(buf),
          readOnly: await isReadOnly(filePath),
        });
      } catch (error) { sendJson(res, 400, { ok: false, error: errText(error) }); }
    },
  });

  register({
    kind: 'exact',
    path: '/dsh-ide/write',
    handler: async (req, res) => {
      try {
        const parsed = JSON.parse(await readBody(req));
        const filePath = toAbsolute(parsed.path);
        if (typeof parsed.content !== 'string') { sendJson(res, 400, { ok: false, error: 'missing content' }); return; }
        // Refuse a protected file unless the caller explicitly forces it — this
        // is the server-side half of the read-only badge in the tree.
        if (await isReadOnly(filePath)) {
          if (parsed.force !== true) {
            sendJson(res, 403, {
              ok: false, readOnly: true,
              error: '文件是只读的，已拒绝写入。要修改请先点工具栏「只读」解锁。',
            });
            return;
          }
          // A forced write releases the attribute for exactly this write and
          // puts it back, so the file stays protected afterwards.
          await setReadOnly(filePath, false);
          try {
            await writeFile(filePath, parsed.content, 'utf8');
          } finally {
            await setReadOnly(filePath, true);
          }
          sendJson(res, 200, { ok: true, path: filePath, readOnly: true, forced: true });
          return;
        }
        await writeFile(filePath, parsed.content, 'utf8');
        sendJson(res, 200, { ok: true, path: filePath, readOnly: false });
      } catch (error) { sendJson(res, 400, { ok: false, error: errText(error) }); }
    },
  });

  // --- read-only attribute ----------------------------------------------
  // Setting it on a directory recurses, so a whole standard-library folder can
  // be protected in one action.
  register({
    kind: 'exact',
    path: '/dsh-ide/readonly',
    handler: async (req, res) => {
      try {
        const parsed = JSON.parse(await readBody(req));
        const target = toAbsolute(parsed.path);
        const readOnly = parsed.readOnly !== false;
        if (!(await isDirectory(target)) && !(await isFile(target))) {
          sendJson(res, 404, { ok: false, error: 'not found: ' + target }); return;
        }
        const changed = [];
        const walk = async (p) => {
          if (await isDirectory(p)) {
            for (const e of await readdir(p, { withFileTypes: true })) {
              if (e.name.startsWith('.')) continue;
              await walk(path.join(p, e.name));
            }
            return;
          }
          if (!/\.(c|h)$/i.test(p)) return;
          await setReadOnly(p, readOnly);
          changed.push(p);
        };
        await walk(target);
        sendJson(res, 200, { ok: true, path: target, readOnly, changed: changed.length });
      } catch (error) { sendJson(res, 400, { ok: false, error: errText(error) }); }
    },
  });

  // --- single-file gcc compile -----------------------------------------
  register({
    kind: 'exact',
    path: '/dsh-ide/compile',
    handler: async (req, res) => {
      try {
        const parsed = JSON.parse(await readBody(req));
        const filePath = toAbsolute(parsed.file);
        if (!(await isFile(filePath))) { sendJson(res, 404, { ok: false, error: 'not a file: ' + filePath }); return; }
        const template = typeof parsed.command === 'string' && parsed.command.trim() !== '' ? parsed.command : 'gcc {file} -o {out}';
        const command = expandCommand(template, filePath);
        const result = await runCompile(command, path.dirname(filePath));
        sendJson(res, 200, { ok: true, command, ...result });
      } catch (error) { sendJson(res, 400, { ok: false, error: errText(error) }); }
    },
  });

  // --- caret state mirror (Agent-readable) -----------------------------
  register({
    kind: 'exact',
    path: '/dsh-ide/state',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        try { sendJson(res, 200, { ok: true, state: JSON.parse(await readFile(stateFilePath(), 'utf8')) }); }
        catch { sendJson(res, 200, { ok: true, state: null }); }
        return;
      }
      try {
        const parsed = JSON.parse(await readBody(req, 64 * 1024));
        const asNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
        const state = {
          file: typeof parsed.file === 'string' && parsed.file !== '' ? parsed.file : null,
          line: asNumber(parsed.line),
          col: asNumber(parsed.col),
          selStart: asNumber(parsed.selStart),
          selEnd: asNumber(parsed.selEnd),
          updatedAt: new Date().toISOString(),
        };
        await writeFile(stateFilePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
        sendJson(res, 200, { ok: true, state });
      } catch (error) { sendJson(res, 400, { ok: false, error: errText(error) }); }
    },
  });

  // --- Keil detection ---------------------------------------------------
  register({
    kind: 'exact',
    path: '/dsh-ide/keil',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const override = url.searchParams.get('path') || undefined;
      const keil = await detectKeil(override);
      sendJson(res, 200, { ok: true, keil });
    },
  });

  // --- uvprojx project: open (find + load) ------------------------------
  register({
    kind: 'exact',
    path: '/dsh-ide/project',
    handler: async (req, res) => {
      try {
        const parsed = JSON.parse(await readBody(req));
        let projectPath = null;
        if (typeof parsed.project === 'string' && parsed.project.trim()) {
          projectPath = toAbsolute(parsed.project);
        } else if (typeof parsed.dir === 'string' && parsed.dir.trim()) {
          const dir = toAbsolute(parsed.dir);
          if (!(await isDirectory(dir))) { sendJson(res, 404, { ok: false, error: 'not a directory: ' + dir }); return; }
          const candidates = await findUvprojx(dir);
          if (candidates.length === 0) { sendJson(res, 404, { ok: false, error: '目录下未找到 .uvprojx 工程' }); return; }
          if (candidates.length > 1) { sendJson(res, 200, { ok: true, multiple: true, candidates }); return; }
          projectPath = candidates[0];
        } else {
          sendJson(res, 400, { ok: false, error: '需要 project 或 dir 参数' });
          return;
        }
        const project = await loadProject(projectPath);
        project.debuggerLabel = debuggerLabel(project.debuggerDll);
        // Bind under the SESSION WORKSPACE when the client named one, so the
        // panel and the agent agree on which workspace owns this project. Falls
        // back to the project's own directory for older clients.
        const bindCwd = typeof parsed.cwd === 'string' && parsed.cwd ? parsed.cwd : path.dirname(projectPath);
        panelProjects.set(workspaceKey(bindCwd) || 'global', {
          project: projectPath,
          cwd: bindCwd,
          at: new Date().toISOString(),
        });
        rememberProject(projectPath, bindCwd);
        sendJson(res, 200, { ok: true, project, workspace: bindCwd });
      } catch (error) { sendJson(res, 400, { ok: false, error: errText(error) }); }
    },
  });

  // --- uvprojx project: add a file to a group ---------------------------
  register({
    kind: 'exact',
    path: '/dsh-ide/project/add',
    handler: async (req, res) => {
      try {
        const parsed = JSON.parse(await readBody(req));
        const projectPath = toAbsolute(parsed.project);
        if (!(await isFile(projectPath))) { sendJson(res, 404, { ok: false, error: '工程不存在: ' + projectPath }); return; }
        if (typeof parsed.group !== 'string' || !parsed.group) { sendJson(res, 400, { ok: false, error: '需要 group 参数' }); return; }
        const filePath = toAbsolute(parsed.filePath);
        const baseDir = path.dirname(projectPath);
        const fileName = parsed.fileName || path.basename(filePath);
        const fileType = parsed.fileType ?? fileTypeForName(fileName);
        const rel = keilRelPath(baseDir, filePath);
        // Create the file if it does not exist yet (so "add" works for new files too).
        if (!(await isFile(filePath))) {
          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, '/* TODO */\n', 'utf8');
        }
        const xml = decodeOutput(await readFile(projectPath));
        const next = addFileToUvprojx(xml, {
          targetName: parsed.target || 'Target 1',
          groupName: parsed.group,
          fileName,
          filePath: rel,
          fileType,
        });
        await writeFile(projectPath, next, 'utf8');
        sendJson(res, 200, { ok: true, rel });
      } catch (error) { sendJson(res, 400, { ok: false, error: errText(error) }); }
    },
  });

  // --- restart (plugin development aid) ---------------------------------
  installRestartRoutes(register);
  // Warm the parent-process probe off the boot path: the first click decides
  // between "respawn myself" and "let the Desktop shell relaunch us" from it.
  prefetchRuntimeFacts();

  // --- build / flash jobs ----------------------------------------------
  const startUv4Job = (kind, action, diagnose) => async (req, res) => {
    try {
      const parsed = JSON.parse(await readBody(req));
      const projectPath = toAbsolute(parsed.project);
      if (!(await isFile(projectPath))) { sendJson(res, 404, { ok: false, error: '工程不存在: ' + projectPath }); return; }
      const keil = await detectKeil(parsed.keil);
      if (!keil.found) {
        sendJson(res, 400, { ok: false, error: '未检测到 Keil MDK（UV4.exe）。请安装 Keil，或在设置里指定 UV4.exe 路径', tried: keil.tried });
        return;
      }
      const job = createJob(kind, { project: projectPath, target: parsed.target || 'Target 1', uv4: keil.uv4 });
      if (diagnose) {
        const baseDir = path.dirname(projectPath);
        job.diagnose = (out) => {
          const d = diagnose(out);
          for (const it of d.issues) it.abs = resolveProjectFile(baseDir, it.file);
          return d;
        };
      }
      const logFile = path.join(DSH_HOME, `dsh-ide-uv4-${job.id}.log`);
      runUv4Job(job, { uv4: keil.uv4, action, project: projectPath, target: parsed.target || 'Target 1', logFile });
      sendJson(res, 200, { ok: true, jobId: job.id });
    } catch (error) { sendJson(res, 400, { ok: false, error: errText(error) }); }
  };

  register({ kind: 'exact', path: '/dsh-ide/build', handler: startUv4Job('build', '-b', (out) => parseBuildLog(out)) });
  register({ kind: 'exact', path: '/dsh-ide/flash', handler: startUv4Job('flash', '-f') });

  // --- job polling ------------------------------------------------------
  register({
    kind: 'exact',
    path: '/dsh-ide/job',
    handler: (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const id = Number(url.searchParams.get('id'));
      const job = getJob(id);
      if (!job) { sendJson(res, 404, { ok: false, error: 'job not found' }); return; }
      const view = jobView(job);
      if (job.status === 'done' && job.exitCode !== null) view.exitMessage = exitMessage(job.exitCode);
      sendJson(res, 200, { ok: true, job: view });
    },
  });

  // --- Agent integration: `keil_project` tool + workflow skill ----------
  installTool(ctx, {
    getPanelProjects: () => panelProjects,
    // Degraded path only, used when a call carries no session workspace.
    getActiveProject: () => mostRecentPanelProject(),
    // Learn each session's workspace from its own tool calls, so the panel can
    // default to it even when the client cannot name its session.
    noteSessionWorkspace,
  });
  installSkill(ctx);

  // --- teardown ---------------------------------------------------------
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch {} }
  });

  return () => {
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch {} }
  };
}
