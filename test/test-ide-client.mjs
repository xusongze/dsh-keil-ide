// Verify the client bundle: load the __ModuleLoader__ factory, run apply()
// against a mock ctx, and unit-test the C tokenizer.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const code = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');

const sandbox = {
  window: {
    __ModuleLoader__: { load(reg) { sandbox.__registration = reg; } },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    localStorage: { getItem: () => null, setItem: () => {} },
  },
  navigator: { clipboard: { writeText: () => {} } },
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) }),
  URLSearchParams,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const reg = sandbox.__registration;
if (!reg) { console.error('FAIL: no factory registration captured'); process.exit(1); }
console.log('factory id:', reg.id);

let ok = true;
function fail(msg) { console.error('FAIL: ' + msg); ok = false; }

const mockReact = {
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
  createElement: (type, props, ...children) => ({ type, props, children }),
};
const requireMock = (spec) => {
  if (spec === 'react') return mockReact;
  throw new Error('unexpected require: ' + spec);
};

const plugin = reg.factory(requireMock);
console.log('exports.name:', plugin.name);
console.log('exports.inject:', JSON.stringify(plugin.inject));

// --- plugin body: slot registrations ---
const calls = [];
const tabTypes = [];
const mockCtx = {
  slots: {
    inject(key, cb) { calls.push(['inject', key]); cb(); },
    register(opts) { calls.push(['register', opts]); return () => {}; },
  },
  layout: { selectPanel() {} },
  effect(cb) { cb(); },
  get(name) {
    if (name === 'sidebarRightTabs') {
      return { register(def) { tabTypes.push(def); return () => {}; } };
    }
    if (name === 'sidebarRight') {
      return { openTab() {}, isExpanded() { return false; }, active() { return null; } };
    }
    return null;
  },
};
plugin.apply(mockCtx);

const injectKeys = calls.filter((c) => c[0] === 'inject').map((c) => c[1]);
const regs = calls.filter((c) => c[0] === 'register').map((c) => c[1]);
console.log('inject keys:', JSON.stringify(injectKeys));
console.log('register options:', JSON.stringify(regs));

for (const key of ['main', 'sidebar.panellist', 'conversation.input.left', 'sidebar.right.pane.tab']) {
  if (!injectKeys.includes(key)) fail('missing inject("' + key + '")');
}
const mainReg = regs.find((o) => o.name === 'main');
if (!mainReg || mainReg.key !== 'ide') fail('main slot must register key "ide"');
const listReg = regs.find((o) => o.name === 'sidebar.panellist');
if (!listReg || listReg.id !== 'ide' || listReg.label !== 'IDE') fail('sidebar.panellist must register id "ide"');
const composerReg = regs.find((o) => o.name === 'conversation.input.left');
if (!composerReg || composerReg.id !== 'dsh-ide') fail('composer toggle must register in conversation.input.left');
const dockBody = regs.find((o) => o.name === 'sidebar.right.pane.tab');
if (!dockBody || dockBody.key !== 'dsh-keil-ide') fail('right-dock body must register under key "dsh-keil-ide"');

console.log('tab types:', JSON.stringify(tabTypes.map((t) => ({ id: t.id, kind: t.kind, guide: (t.guide || []).map((g) => g.id) }))));
if (tabTypes.length !== 1) fail('exactly one right-dock tab type expected');
else {
  const t = tabTypes[0];
  if (t.id !== 'dsh-keil-ide') fail('tab type id mismatch');
  if (t.kind !== 'dsh-ide') fail('tab kind mismatch');
  if (!t.title || t.title() !== 'IDE') fail('tab title must be IDE');
  if (!t.guide || t.guide.length !== 1 || t.guide[0].id !== 'ide') fail('guide entry missing');
  if (!t.keepMounted) fail('tab type should keepMounted');
}

// --- tokenizer ---
function types(source) { return plugin.tokenizeC(source).map((t) => t.t + ':' + t.v); }
function expectTokens(label, source, want) {
  const got = types(source);
  const hit = JSON.stringify(got) === JSON.stringify(want);
  console.log('[' + label + ']', hit ? 'OK' : 'MISMATCH');
  if (!hit) { console.error('   got     ', JSON.stringify(got)); console.error('   expected', JSON.stringify(want)); ok = false; }
}

expectTokens('keyword+function',
  'int main(void) {',
  ['keyword:int', 'plain: ', 'function:main', 'punct:(', 'keyword:void', 'punct:)', 'plain: ', 'punct:{']);

expectTokens('preprocessor-include',
  '#include <stdio.h>\n',
  ['keyword:#', 'keyword:include', 'plain: ', 'string:<stdio.h>', 'plain:\n']);

expectTokens('preprocessor-define',
  '#define MAX 100',
  ['keyword:#', 'keyword:define', 'plain: ', 'constant:MAX', 'plain: ', 'number:100']);

expectTokens('line-comment',
  'x; // 注释\n',
  ['plain:x', 'punct:;', 'plain: ', 'comment:// 注释', 'plain:\n']);

expectTokens('block-comment',
  'a /* c */ b',
  ['plain:a', 'plain: ', 'comment:/* c */', 'plain: ', 'plain:b']);

expectTokens('string-and-number',
  'char s[] = "hi"; int n = 1.5e3;',
  ['keyword:char', 'plain: ', 'plain:s', 'punct:[', 'punct:]', 'plain: ', 'punct:=', 'plain: ',
    'string:"hi"', 'punct:;', 'plain: ', 'keyword:int', 'plain: ', 'plain:n', 'plain: ', 'punct:=',
    'plain: ', 'number:1.5e3', 'punct:;']);

expectTokens('type-and-call',
  'size_t n = strlen(s);',
  ['type:size_t', 'plain: ', 'plain:n', 'plain: ', 'punct:=', 'plain: ', 'function:strlen',
    'punct:(', 'plain:s', 'punct:)', 'punct:;']);

const unterminated = plugin.tokenizeC('/* never closed');
console.log('[unterminated-comment]', unterminated.length === 1 && unterminated[0].t === 'comment' ? 'OK' : 'MISMATCH');
if (!(unterminated.length === 1 && unterminated[0].t === 'comment')) ok = false;

const colors = Object.keys(plugin.TOKEN_COLOR).map((k) => plugin.TOKEN_COLOR[k]);
const allShiki = colors.every((c) => c.indexOf('var(--shiki-token-') === 0);
console.log('[token-colors]', allShiki ? 'OK (' + colors.length + ' mapped to --shiki-token-*)' : 'MISMATCH');
if (!allShiki) ok = false;

// --- session-workspace bridge -----------------------------------------
// The IDE panel is root-scoped and gets no Session binding, so the composer
// toggle (session-scoped, receives `sessionId`) must resolve the workspace root
// and hand it to the panel.
const bridge = plugin.__bridge;
if (!bridge) fail('client must export the session-workspace bridge');
else {
  const wsA = {
    phase: 'ready',
    items: [
      { workspaceId: 'w1', path: 'C:\\ws-a', title: 'a', sessionIds: ['s1', 's2'] },
      { workspaceId: 'w2', path: 'C:\\ws-b', title: 'b', sessionIds: ['s3'] },
    ],
  };
  const one = { phase: 'ready', items: [{ workspaceId: 'w1', path: 'C:\\only', title: 'o', sessionIds: ['s9'] }] };

  if (bridge.pathForSession(wsA, 's1') !== 'C:\\ws-a') fail('must pick the workspace owning the session');
  if (bridge.pathForSession(wsA, 's3') !== 'C:\\ws-b') fail('must pick the other workspace for its own session');
  if (bridge.pathForSession(one, 'unknown-session') !== 'C:\\only') fail('a lone workspace must be used even before the session is known');
  if (bridge.pathForSession(wsA, 'unknown-session') !== null) fail('ambiguous workspaces must not be guessed');
  if (bridge.pathForSession(null, 's1') !== null) fail('a missing snapshot must not throw or guess');
  if (bridge.pathForSession({ items: [] }, 's1') !== null) fail('an empty snapshot must yield null');

  let notified = null;
  const stop = bridge.subscribe((cwd, sid) => { notified = { cwd, sid }; });
  bridge.publish('C:\\ws-b', 's3');
  if (!notified || notified.cwd !== 'C:\\ws-b' || notified.sid !== 's3') fail('subscribers must receive the published workspace');
  if (bridge.state.cwd !== 'C:\\ws-b') fail('bridge state must hold the published workspace');
  // publishing the same value again must not re-notify
  notified = null;
  bridge.publish('C:\\ws-b', 's3');
  if (notified !== null) fail('an unchanged workspace must not re-notify');
  stop();
  notified = null;
  bridge.publish('C:\\ws-a', 's1');
  if (notified !== null) fail('an unsubscribed listener must stop receiving');
  console.log('[session-workspace-bridge] OK');
}

// --- read-only badge + bottom-left toast ---------------------------------
// These are purely presentational, so assert the pieces exist (and that the
// two lock states really are different shapes) instead of pretending to render
// them headlessly. The animation itself needs a live panel.
const wants = [
  ['toast-keyframe-in', /@keyframes dsh-ide-toast-in/],
  ['toast-keyframe-out', /@keyframes dsh-ide-toast-out/],
  ['toast-enters-from-left', /translateX\(-118%\)/],
  ['toast-exits-left', /translateX\(-52%\)/],
  ['toast-host', /className: "dsh-ide-toasts"/],
  ['toast-leaving-state', /dsh-ide-toast-leaving/],
  ['toast-tone-marks', /dsh-ide-toast-mark-on[\s\S]*dsh-ide-toast-mark-off[\s\S]*dsh-ide-toast-mark-err/],
  ['toast-aria-live', /"aria-live": "polite"/],
  ['toast-queue-capped', /\.slice\(-3\)/],
  ['readonly-corner-badge', /className: "dsh-ide-ro"/],
  ['lock-closed-shape', /M7 11V7a5 5 0 0 1 10 0v4/],
  ['lock-open-shape', /M7 11V7a5 5 0 0 1 9\.6-2/],
  ['toolbar-two-state', /dsh-ide-lockbtn-on/],
  ['group-lock-state', /var allLocked = files\.length > 0/],
  ['save-blocked-toast', /title: "已阻止保存"/],
  ['readonly-toast', /已锁定为只读/],
  ['toast-rounded', /border-radius:var\(--dsw-radius-lg,14px\)/],
  ['tree-default-width', /\.dsh-ide-tree\{width:308px;min-width:196px/],
  ['tree-row-legible', /\.dsh-ide-row\{[^"]*font-size:13\.5px/],
  ['tree-glyph-size', /createElement\(Svg, \{ size: 15 \}/],
  // add-file dialog (window.prompt does not exist in Electron)
  ['add-dialog-css', /\.dsh-ide-modal-card\{/],
  ['add-dialog-mode-both', /＋ \.c 和 \.h/],
  ['add-dialog-preview', /将创建：/],
  ['add-dialog-creates', /createDialogFiles/],
  // unsaved buffers survive a file switch, plus a save-all
  ['dirty-buffer-map', /var dirtyMap = useRef\(\{\}\)/],
  ['dirty-buffer-restore', /已恢复未保存的修改/],
  ['save-all-button', /全部保存/],
  ['save-all-fn', /var saveAll = useCallback/],
  ['tree-dirty-dot', /dsh-ide-dirtydot/],
];
for (const [label, re] of wants) {
  if (!re.test(code)) fail('missing ' + label);
}
// A prompt-based flow is dead code in the desktop app: refuse to regress to it.
// Comments legitimately mention window.prompt, so strip them before checking.
const codeNoComments = code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
if (/window\.prompt\s*\(/.test(codeNoComments)) fail('client must not call window.prompt (Electron has no prompt())');
console.log('[no-window-prompt] OK');
console.log('[readonly-ui-pieces]', wants.length + ' guarded');

console.log(ok ? 'CLIENT CHECKS OK' : 'CLIENT CHECKS FAILED');
process.exit(ok ? 0 : 1);
