// Client-half verification for the dsh-ide restart button.
//
// The bundle is a browser module: it registers itself on window.__ModuleLoader__
// and expects React plus a slot service. This harness provides a minimal
// hook-capable renderer and a fake fetch, then drives the real bundle:
//   render → click restart → confirm → POST /dsh-ide/restart → mode handling.
import fs from 'node:fs';
import vm from 'node:vm';

const BUNDLE = new URL('../client/client.js', import.meta.url);
const code = fs.readFileSync(BUNDLE, 'utf8');

let failures = 0;
const ok = (label, condition, detail) => {
  if (condition) { console.log(`  PASS  ${label}`); return; }
  failures += 1;
  console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
};
const section = (title) => console.log(`\n== ${title} ==`);

/* ------------------------------------------------------------------ *
 * Fake fetch — requests are recorded and answered from a script.      *
 * ------------------------------------------------------------------ */
const requests = [];
let answer = () => ({ ok: false, error: 'no answer scripted' });
const fakeFetch = (url, init) => {
  const method = (init && init.method) || 'GET';
  requests.push({ url: String(url), method, body: init && init.body });
  return Promise.resolve({ status: 200, json: () => Promise.resolve(answer(method, String(url))) });
};

/* ------------------------------------------------------------------ *
 * Minimal React-compatible renderer                                   *
 * ------------------------------------------------------------------ */
const HOOKS = new Map();   // component function -> hook cells
let CURRENT = null;
let ROOT = null;
let rendering = false;

function makeHooks(component) {
  let cells = HOOKS.get(component);
  if (!cells) { cells = []; HOOKS.set(component, cells); }
  let index = 0;
  const requestRender = () => {
    if (rendering || !ROOT || ROOT.component !== component) return;
    queueMicrotask(() => { if (ROOT && ROOT.component === component) renderWith(component, ROOT.props); });
  };
  return {
    useState(initial) {
      const at = index++;
      if (!cells[at] || cells[at].kind !== 'state') {
        cells[at] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial };
      }
      const cell = cells[at];
      return [cell.value, (next) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next;
        requestRender();
      }];
    },
    useEffect() { index += 1; },
    useCallback(fn) { index += 1; return fn; },
    useMemo(fn) { index += 1; return fn(); },
    useRef(initial) {
      const at = index++;
      if (!cells[at] || cells[at].kind !== 'ref') cells[at] = { kind: 'ref', value: { current: initial } };
      return cells[at].value;
    },
  };
}

const REACT = {
  useState: (...args) => CURRENT.useState(...args),
  useEffect: (...args) => CURRENT.useEffect(...args),
  useCallback: (...args) => CURRENT.useCallback(...args),
  useMemo: (...args) => CURRENT.useMemo(...args),
  useRef: (...args) => CURRENT.useRef(...args),
  createElement: (type, props, ...children) => ({
    type,
    ...(props || {}),
    children: children.length === 0 ? (props && props.children) : (children.length === 1 ? children[0] : children),
  }),
};

function renderWith(component, props) {
  CURRENT = makeHooks(component);
  rendering = true;
  let tree;
  try { tree = component(props || {}); } finally { rendering = false; }
  return expand(tree);
}
function mount(component, props) {
  ROOT = { component, props };
  return renderWith(component, props);
}
function renderRoot() { return ROOT ? renderWith(ROOT.component, ROOT.props) : null; }
async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/* Element tree helpers. Function elements are expanded once per render, the
 * way a real renderer would, so the harness can assert on what renders. */
function expand(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expand);
  if (typeof node.type === 'function') {
    const previous = CURRENT;
    CURRENT = makeHooks(node.type);
    try { return expand(node.type(node)); } finally { CURRENT = previous; }
  }
  node.children = expand(node.children);
  return node;
}
function find(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const hit = find(child, predicate); if (hit) return hit; }
    return null;
  }
  if (predicate(node)) return node;
  return find(node.children, predicate);
}
function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node !== 'object') return '';
  if (typeof node.type === 'function') return textOf(node.children);
  return textOf(node.children);
}
const byClass = (node, className) => find(node, (element) => typeof element.className === 'string' && element.className.split(' ').includes(className));
const hasText = (node, text) => textOf(node).includes(text);

/* ------------------------------------------------------------------ *
 * Sandbox                                                             *
 * ------------------------------------------------------------------ */
const registrations = [];
const slots = {
  inject(name, callback) { registrations.push({ name, dispose: callback() }); return () => {}; },
  register(options, render) { registrations.push({ options, render }); return () => {}; },
};
const intervals = new Map();
let intervalSeq = 0;
const timers = [];
const reloads = { count: 0 };

const store = new Map();
const documentStub = { head: { appendChild() {} }, getElementById() { return null; }, createElement() { return {}; } };
const context = {
  console, fetch: fakeFetch, URLSearchParams, TextDecoder,
  Promise, JSON, Object, Array, String, Number, Boolean, Math, Date, Error, Map, Set,
  isFinite, parseInt, parseFloat, queueMicrotask,
  setTimeout(fn) { timers.push(fn); return timers.length; },
  clearTimeout() {},
  setInterval(fn) { intervalSeq += 1; intervals.set(intervalSeq, fn); return intervalSeq; },
  clearInterval(id) { intervals.delete(id); },
  document: documentStub,
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
  },
  location: { reload() { reloads.count += 1; }, href: 'http://127.0.0.1:19387/' },
};
context.window = context;
let captured = null;
context.__ModuleLoader__ = { load(definition) { captured = definition; } };

vm.runInContext(code, vm.createContext(context), { filename: 'client.js' });

section('bundle registration');
ok('loads under its package id', captured !== null && captured.id === 'dsh-keil-ide');
const exportsObject = captured.factory((specifier) => {
  if (specifier !== 'react') throw new Error(`unexpected require: ${specifier}`);
  return REACT;
});
ok('exports name/inject/apply', exportsObject.name === 'dsh-ide'
  && Array.isArray(exportsObject.inject) && typeof exportsObject.apply === 'function');

/* ------------------------------------------------------------------ *
 * Apply → find the registered slot entry                              *
 * ------------------------------------------------------------------ */
let footerRender = null;
section('slot registration');
{
  const ctx = {
    slots,
    get() { return undefined; },
    effect(callback) { callback(); return () => {}; },
    on() { return () => {}; },
    inject() { return () => {}; },
  };
  try { exportsObject.apply(ctx); } catch (error) { console.log('  note: apply threw:', error.message); }
  const footer = registrations.find((entry) => entry.options && entry.options.name === 'sidebar.footer.action');
  ok('registers a sidebar.footer.action cell', Boolean(footer), JSON.stringify(registrations.map((entry) => entry.options && entry.options.name)));
  ok('cell id is its own', Boolean(footer) && footer.options.id === 'dsh-ide-restart', footer && footer.options.id);
  ok('cell sits beside Settings', Boolean(footer) && footer.options.order >= 0, String(footer && footer.options.order));
  ok('cell has a label', Boolean(footer && footer.options.label), String(footer && footer.options.label));
  footerRender = footer && footer.render;
}
ok('slot render function is callable', typeof footerRender === 'function');

/* ------------------------------------------------------------------ *
 * Idle render                                                         *
 * ------------------------------------------------------------------ */
section('button render (idle)');
requests.length = 0;
// The boot read may not have landed yet: the restart reply's own boot id is
// what the guard uses, so the flow must work without it.
answer = (method, url) => (url.indexOf('/dsh-ide/boot') === 0
  ? { ok: false, error: 'HTTP 404' }
  : { ok: true, mode: 'web', bootId: 'boot-A', logs: { err: 'C:/tmp/err.log' } });
let tree = mount(footerRender, { wide: true });
{
  ok('renders a restart button', Boolean(byClass(tree, 'dsh-ide-restart')));
  const button = byClass(tree, 'dsh-ide-restart');
  ok('button is enabled while idle', button.disabled !== true);
  ok('button carries a tooltip', typeof button.title === 'string' && button.title.includes('重启'), button.title);
  ok('no dialog before any click', !byClass(tree, 'dsh-ide-confirm'));
}

section('click opens the confirmation dialog');
{
  byClass(tree, 'dsh-ide-restart').onClick();
  tree = renderRoot();
  const overlay = byClass(tree, 'dsh-ide-confirm');
  const card = byClass(tree, 'dsh-ide-confirm-card');
  const go = byClass(tree, 'dsh-ide-confirm-go');
  const cancel = byClass(tree, 'dsh-ide-confirm-btn');
  ok('confirmation dialog appears', Boolean(overlay));
  ok('dialog explains the desktop flow', hasText(tree, '启动失败'));
  ok('dialog explains the dsh web flow', hasText(tree, 'dsh web'));
  ok('dialog names the Electron API a plugin cannot call', hasText(tree, 'app.relaunch()'));
  ok('no request sent before confirming', requests.length === 0, JSON.stringify(requests));

  // A dialog nobody can read is worse than none: every surface is opaque and
  // every label carries an explicit colour instead of inheriting one.
  ok('the card paints an opaque base surface', /^var\(--dsw-alias-bg-base/.test(String(card.style.background)), JSON.stringify(card.style));
  ok('the card sets its own text colour', /^var\(--dsw-alias-label-primary/.test(String(card.style.color)), JSON.stringify(card.style));
  ok('the backdrop uses the theme mask', /^var\(--dsw-alias-bg-mask-3/.test(String(overlay.style.background)), JSON.stringify(overlay.style));
  ok('the advance button paints its own fill', /^var\(--dsw-alias-brand-primary/.test(String(go.style.background)), JSON.stringify(go.style));
  ok('the advance button paints its own label colour', /^var\(--dsw-alias-label-primary-foreground/.test(String(go.style.color)), JSON.stringify(go.style));
  ok('the advance button does not hardcode plain white', String(go.style.color).indexOf('#fff') !== 0, String(go.style.color));
  ok('the cancel button keeps an explicit label colour', /^var\(--dsw-alias-label-primary/.test(String(cancel.style.color)), JSON.stringify(cancel.style));
  ok('no button dims itself with opacity', String(go.style.opacity ?? '') === '' && String(cancel.style.opacity ?? '') === '');
  ok('the dialog title keeps a colour of its own', /^var\(--dsw-alias-label-primary/.test(String(byClass(tree, 'dsh-ide-confirm-title').style.color)), JSON.stringify(byClass(tree, 'dsh-ide-confirm-title').style));
}

/* ------------------------------------------------------------------ *
 * Confirm → POST + web-mode polling → reload                          *
 * ------------------------------------------------------------------ */
section('confirm on a dsh web host: POST, poll, reload');
{
  const confirm = byClass(tree, 'dsh-ide-confirm-go');
  ok('confirm button exists', Boolean(confirm));
  confirm.onClick();
  tree = renderRoot();
  ok('shows the busy dialog', hasText(tree, '正在重启'));
  ok('button is disabled while busy', byClass(tree, 'dsh-ide-restart').disabled === true);
  await flush();
  const posts = requests.filter((entry) => entry.method === 'POST');
  ok('POSTed to /dsh-ide/restart once', posts.length === 1 && posts[0].url === '/dsh-ide/restart', JSON.stringify(posts));
}

section('web mode: polling reloads once the host answers again');
{
  const polls = [...intervals.values()];
  ok('a poll interval was armed', polls.length >= 1, `intervals=${intervals.size}`);

  // The boot id was captured ('boot-A'), so an answer carrying it is still the
  // old process; the replacement has to report a different one.
  answer = () => ({ ok: true, bootId: 'boot-A' });
  for (const poll of polls) await poll();
  await flush();
  ok('the same boot id keeps waiting', reloads.count === 0, `reloads=${reloads.count}`);
  ok('the poll keeps running while the host is down', intervals.size >= 1, `intervals=${intervals.size}`);

  // The replacement answers with a new boot id.
  answer = () => ({ ok: true, bootId: 'boot-B' });
  requests.length = 0;
  for (const poll of intervals.values()) await poll();
  await flush();
  ok('an answering replacement reloads the page', reloads.count === 1,
    `reloads=${reloads.count} requests=${JSON.stringify(requests)}`);
  ok('polling stops after reloading', intervals.size === 0, `intervals=${intervals.size}`);
}

section('web mode: the old host answering with the same boot id does not reload');
{
  HOOKS.clear();
  intervals.clear();
  requests.length = 0;
  timers.length = 0;
  reloads.count = 0;
  // This page's boot read is answered by the dying host itself, so the guard
  // value and the stale polls agree.
  answer = (method, url) => (url.indexOf('/dsh-ide/boot') === 0
    ? { ok: true, bootId: 'boot-S', pid: 5, restart: null }
    : { ok: true, mode: 'web', bootId: 'boot-S', logs: { err: 'x' } });
  mount(footerRender, { wide: true });
  let current = renderRoot();
  byClass(current, 'dsh-ide-restart').onClick();
  current = renderRoot();
  byClass(current, 'dsh-ide-confirm-go').onClick();
  await flush();
  ok('a poll was armed', intervals.size >= 1, `intervals=${intervals.size}`);
  for (const poll of [...intervals.values()]) await poll();
  await flush();
  ok('the same boot id does not reload', reloads.count === 0, `reloads=${reloads.count}`);

  // An answer with a different id is the replacement: reload.
  answer = () => ({ ok: true, bootId: 'boot-T' });
  for (const poll of [...intervals.values()]) await poll();
  await flush();
  ok('a new boot id reloads', reloads.count === 1, `reloads=${reloads.count}`);
}

section('web mode: a host that never answers eventually asks the user to act');
{
  HOOKS.clear();
  intervals.clear();
  requests.length = 0;
  timers.length = 0;
  reloads.count = 0;
  answer = (method, url) => (url.indexOf('/dsh-ide/boot') === 0
    ? { ok: true, bootId: 'boot-W', pid: 6, restart: null }
    : { ok: true, mode: 'web', bootId: 'boot-W', logs: { err: 'x' } });
  mount(footerRender, { wide: true });
  let current = renderRoot();
  byClass(current, 'dsh-ide-restart').onClick();
  current = renderRoot();
  byClass(current, 'dsh-ide-confirm-go').onClick();
  await flush();
  // The host never comes back: every poll fails.
  answer = () => ({ ok: false, error: 'failed to fetch' });
  for (let i = 0; i < 62; i += 1) {
    for (const poll of [...intervals.values()]) poll();
    await flush(1);
  }
  current = renderRoot();
  ok('no reload without an answer', reloads.count === 0, `reloads=${reloads.count}`);
  ok('polling gives up', intervals.size === 0, `intervals=${intervals.size}`);
  ok('the user is told to act', hasText(current, '宿主已请求退出'), textOf(current).slice(0, 120));
}

/* ------------------------------------------------------------------ *
 * Embedded mode: no polling, guidance dialog after the timeout        *
 * ------------------------------------------------------------------ */
section('embedded (Desktop app) mode');
{
  HOOKS.clear();
  requests.length = 0;
  intervals.clear();
  timers.length = 0;
  reloads.count = 0;
  answer = (method, url) => (url === '/dsh-ide/boot'
    ? { ok: true, bootId: 'boot-E', pid: 2, restart: null }
    : { ok: true, mode: 'embedded', bootId: 'boot-E', timeoutMs: 100, record: 'C:/tmp/rec.json' });
  mount(footerRender, { wide: true });
  let current = renderRoot();
  byClass(current, 'dsh-ide-restart').onClick();
  current = renderRoot();
  byClass(current, 'dsh-ide-confirm-go').onClick();
  current = renderRoot();
  ok('busy dialog comes first', hasText(current, '正在重启'));
  await flush();
  ok('no polling interval in embedded mode', intervals.size === 0, `intervals=${intervals.size}`);
  ok('a follow-up timeout was scheduled', timers.length >= 1, `timers=${timers.length}`);
  for (const timer of timers.splice(0)) timer();
  await flush();
  current = renderRoot();
  ok('guidance dialog appears', hasText(current, '宿主已请求退出'));
  ok('guidance names the recovery dialog', hasText(current, '恢复对话框'));
  ok('guidance mentions the tray fallback', hasText(current, '托盘'));
  ok('no reload was attempted', reloads.count === 0, `reloads=${reloads.count}`);
}

/* ------------------------------------------------------------------ *
 * Failure path                                                        *
 * ------------------------------------------------------------------ */
section('a refused request surfaces the host error');
{
  HOOKS.clear();
  timers.length = 0;
  answer = (method, url) => (url === '/dsh-ide/boot'
    ? { ok: true, bootId: 'boot-F', pid: 3, restart: null }
    : { ok: false, error: '只能从本机直连请求重启' });
  mount(footerRender, { wide: true });
  let current = renderRoot();
  byClass(current, 'dsh-ide-restart').onClick();
  current = renderRoot();
  byClass(current, 'dsh-ide-confirm-go').onClick();
  await flush();
  for (const timer of timers.splice(0)) timer();
  await flush();
  current = renderRoot();
  ok('host error text is shown', hasText(current, '只能从本机直连请求重启'));
}

/* ------------------------------------------------------------------ *
 * Narrow rail: the slot is skipped                                    *
 * ------------------------------------------------------------------ */
section('collapsed rail');
{
  HOOKS.clear();
  const rendered = mount(footerRender, { wide: false });
  ok('renders nothing in the 56px rail', rendered === null, JSON.stringify(rendered));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
