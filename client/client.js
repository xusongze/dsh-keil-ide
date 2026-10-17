window.__ModuleLoader__.load({
  id: "dsh-keil-ide",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useCallback = React.useCallback;
    var useMemo = React.useMemo;
    var useRef = React.useRef;
    var createElement = React.createElement;

    var NS = "dsh-ide";
    /** Right-panel tab type identity (unique across every registration). */
    var TAB_ID = "dsh-keil-ide";
    /** Right-panel tab kind, used by sidebarRight.openTab(). */
    var TAB_KIND = "dsh-ide";

    /* ================================================================== *
     * Host API                                                           *
     * ================================================================== */
    function api(method, pathname, body) {
      var url = pathname;
      if (method === "GET" && body) {
        var q = new URLSearchParams();
        Object.keys(body).forEach(function (k) { q.set(k, body[k]); });
        url = pathname + "?" + q.toString();
      }
      var init = { method: method, headers: {} };
      if (method !== "GET" && body !== undefined && body !== null) {
        init.headers["Content-Type"] = "application/json; charset=utf-8";
        init.body = JSON.stringify(body);
      }
      return fetch(url, init).then(function (res) {
        return res.json().catch(function () { return { ok: false, error: "HTTP " + res.status }; });
      }).catch(function (error) {
        return { ok: false, error: (error && error.message) || String(error) };
      });
    }

    /* Timers go through guarded helpers: the bundle must survive a host page
     * where a bare timer global is absent (headless sandboxes, tests). */
    function later(fn, ms) {
      return (typeof window !== "undefined" && typeof window.setTimeout === "function")
        ? window.setTimeout(fn, ms) : 0;
    }
    function cancelLater(id) {
      if (id && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
        window.clearTimeout(id);
      }
    }
    function repeat(fn, ms) {
      return (typeof window !== "undefined" && typeof window.setInterval === "function")
        ? window.setInterval(fn, ms) : 0;
    }
    function cancelRepeat(id) {
      if (id && typeof window !== "undefined" && typeof window.clearInterval === "function") {
        window.clearInterval(id);
      }
    }

    /* ================================================================== *
     * Stylesheet — every colour is a DSH theme token, so the panel tracks *
     * the app palette (including dark mode) without any extra wiring.     *
     * ================================================================== */
    var STYLE_ID = "dsh-keil-ide-style";
    var CSS = [
      ".dsh-ide-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;",
      "background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);",
      "font-family:var(--dsw-font-family);font-size:13px;-webkit-font-smoothing:antialiased}",
      ".dsh-ide-root-side{border-left:1px solid var(--dsw-alias-border-l1)}",

      ".dsh-ide-header{display:flex;align-items:center;gap:8px;padding:8px 12px;flex-wrap:wrap;",
      "border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}",
      ".dsh-ide-brand{display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:13px;",
      "padding-right:4px;color:var(--dsw-alias-label-primary)}",
      ".dsh-ide-brand svg{color:#4176e6}",

      ".dsh-ide-input{flex:1;min-width:180px;padding:5px 9px;font-size:12px;outline:none;",
      "color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);",
      "border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);",
      "font-family:var(--ds-font-family-code);transition:border-color .1s var(--ds-ease-in-out)}",
      ".dsh-ide-input::placeholder{color:var(--dsw-alias-label-secondary)}",
      ".dsh-ide-input:focus{border-color:#4176e6}",

      ".dsh-ide-btn{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;font-size:12px;",
      "cursor:pointer;font-family:inherit;white-space:nowrap;color:var(--dsw-alias-label-primary);",
      "background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);",
      "border-radius:var(--dsw-radius-xs);transition:background .1s var(--ds-ease-in-out),",
      "border-color .1s var(--ds-ease-in-out),opacity .1s var(--ds-ease-in-out)}",
      ".dsh-ide-btn:hover:not(:disabled){background:var(--dsw-alias-bg-overlay);border-color:var(--dsw-alias-border-l2)}",
      ".dsh-ide-btn:disabled{opacity:.45;cursor:default}",
      ".dsh-ide-btn-primary{color:#fff;background:#4176e6;border-color:#4176e6}",
      ".dsh-ide-btn-primary:hover:not(:disabled){background:#3562d1;border-color:#3562d1}",
      ".dsh-ide-btn-danger{color:var(--dsw-alias-state-error-primary);background:transparent;border-color:var(--dsw-alias-border-l1)}",
      ".dsh-ide-btn-danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary)}",
      ".dsh-ide-step{padding:3px 8px;font-size:14px;line-height:1;min-width:26px;justify-content:center}",

      ".dsh-ide-body{display:flex;flex:1;min-height:0}",

      ".dsh-ide-tree{width:308px;min-width:196px;max-width:48%;overflow:auto;padding:6px 0;",
      "border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}",
      ".dsh-ide-row{display:flex;align-items:center;gap:8px;width:100%;padding:6.5px 12px;font-size:13.5px;",
      "text-align:left;cursor:pointer;border:none;background:transparent;color:var(--dsw-alias-label-primary);",
      "font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;",
      "transition:background .1s var(--ds-ease-in-out)}",
      ".dsh-ide-row:hover{background:var(--dsw-alias-bg-layer-2)}",
      ".dsh-ide-row svg{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}",
      ".dsh-ide-row-up{color:var(--dsw-alias-label-secondary);font-weight:600}",
      ".dsh-ide-empty{padding:10px 14px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      // read-only corner badge: a small amber padlock on the file glyph
      ".dsh-ide-glyph{position:relative;display:inline-flex;align-items:center;flex:0 0 auto}",
      ".dsh-ide-ro{position:absolute;right:-6px;bottom:-4px;display:inline-flex;align-items:center;",
      "justify-content:center;padding:1px;border-radius:3px;line-height:0;",
      "background:var(--dsw-alias-warn-primary);color:#1a1a1a;",
      "box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-1)}",
      ".dsh-ide-ro svg{color:#1a1a1a}",
      ".dsh-ide-ro-chip{display:inline-flex;align-items:center;gap:3px;padding:1px 5px;border-radius:3px;",
      "font-size:10.5px;font-weight:600;background:var(--dsw-alias-warn-primary);color:#1a1a1a}",
      ".dsh-ide-ro-chip-off{background:transparent;border:1px solid var(--dsw-alias-border-l2);",
      "color:var(--dsw-alias-label-secondary)}",
      // two-state lock button: closed + amber when protected, open + muted when writable
      ".dsh-ide-lockbtn{gap:4px}",
      ".dsh-ide-lockbtn-on{background:var(--dsw-alias-warn-primary)!important;color:#1a1a1a!important;",
      "border-color:transparent!important}",
      ".dsh-ide-lockbtn-on svg{color:#1a1a1a!important}",
      ".dsh-ide-add-on{color:var(--dsw-alias-warn-primary)}",
      // bottom-left transient status toasts (slide in from the left)
      ".dsh-ide-toasts{position:absolute;left:12px;bottom:12px;z-index:30;display:flex;",
      "flex-direction:column;gap:6px;align-items:flex-start;pointer-events:none;max-width:min(340px,72%)}",
      ".dsh-ide-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:8px;padding:10px 14px;",
      "border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-overlay);",
      "border:1px solid var(--dsw-alias-border-l1);box-shadow:0 8px 26px rgba(0,0,0,.18);",
      "font-size:12px;line-height:1.45;color:var(--dsw-alias-label-primary);",
      "animation:dsh-ide-toast-in .34s var(--ds-ease-in-out) both}",
      ".dsh-ide-toast-leaving{animation:dsh-ide-toast-out .2s var(--ds-ease-in-out) both}",
      ".dsh-ide-toast-mark{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;",
      "width:18px;height:18px;border-radius:50%;margin-top:1px}",
      ".dsh-ide-toast-mark-on{background:var(--dsw-alias-warn-primary);color:#1a1a1a}",
      ".dsh-ide-toast-mark-off{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}",
      ".dsh-ide-toast-mark-err{background:var(--dsw-alias-state-error);color:#fff}",
      ".dsh-ide-toast-mark-info{background:#4176e6;color:#fff}",
      ".dsh-ide-toast-text{display:flex;flex-direction:column;gap:1px;min-width:0}",
      ".dsh-ide-toast-title{font-weight:600}",
      ".dsh-ide-toast-detail{font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}",
      "@keyframes dsh-ide-toast-in{from{opacity:0;transform:translateX(-118%) scale(.96)}to{opacity:1;transform:translateX(0) scale(1)}}",
      "@keyframes dsh-ide-toast-out{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(-52%)}}",
      // a read-only buffer gets a flat caret and a faint amber inset so it reads
      // as locked even before the user tries to type
      ".dsh-ide-area-ro{caret-color:transparent;box-shadow:inset 0 0 0 9999px rgba(255,193,7,.045)}",

      ".dsh-ide-main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}",
      ".dsh-ide-toolbar{display:flex;align-items:center;gap:8px;padding:7px 12px;flex-wrap:wrap;",
      "border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}",
      ".dsh-ide-file{font-weight:600;font-size:12.5px;max-width:38%;overflow:hidden;",
      "text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code)}",
      ".dsh-ide-dirty{color:var(--dsw-alias-state-warn-primary)}",
      // unsaved buffer in the tree: a small amber dot at the row's trailing edge
      ".dsh-ide-dirtydot{flex:0 0 auto;width:7px;height:7px;border-radius:50%;margin-left:auto;",
      "background:var(--dsw-alias-warn-primary)}",
      ".dsh-ide-row-dirty{color:var(--dsw-alias-label-primary)}",
      ".dsh-ide-row-dirty span:not(.dsh-ide-dirtydot){font-style:italic}",
      // in-panel modal (window.prompt does not exist in Electron)
      ".dsh-ide-modal{position:absolute;inset:0;z-index:40;display:flex;align-items:center;",
      "justify-content:center;background:rgba(0,0,0,.3);padding:16px;animation:dsh-ide-fade-in .16s var(--ds-ease-in-out) both}",
      ".dsh-ide-modal-card{width:min(420px,94%);max-height:100%;overflow:auto;padding:16px;",
      "display:flex;flex-direction:column;gap:10px;border-radius:var(--dsw-radius-lg,14px);",
      "background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);",
      "box-shadow:0 18px 50px rgba(0,0,0,.3);animation:dsh-ide-pop-in .2s var(--ds-ease-in-out) both}",
      ".dsh-ide-modal-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".dsh-ide-modal-hint{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary)}",
      ".dsh-ide-modal-hint code{font-family:var(--ds-font-family-code);font-size:11px;",
      "background:var(--dsw-alias-bg-layer-2);padding:1px 4px;border-radius:3px}",
      ".dsh-ide-modal-row{display:flex;gap:6px;flex-wrap:wrap}",
      ".dsh-ide-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:2px}",
      "@keyframes dsh-ide-fade-in{from{opacity:0}to{opacity:1}}",
      "@keyframes dsh-ide-pop-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}",
      ".dsh-ide-grow{flex:1;min-width:8px}",
      ".dsh-ide-label{font-size:11.5px;color:var(--dsw-alias-label-secondary)}",
      ".dsh-ide-num{font-size:12px;min-width:20px;text-align:center;font-family:var(--ds-font-family-code)}",
      ".dsh-ide-select{padding:4px 6px;font-size:12px;cursor:pointer;max-width:150px;outline:none;",
      "color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);",
      "border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-xs);font-family:inherit}",

      ".dsh-ide-codewrap{position:relative;display:flex;flex:1;min-height:0;overflow:hidden;",
      "background:var(--shiki-background,var(--dsw-alias-bg-layer-1))}",
      ".dsh-ide-gutter{flex:0 0 auto;min-width:46px;overflow:hidden;box-sizing:border-box;",
      "padding:12px 9px 12px 10px;text-align:right;font-family:inherit;font-size:inherit;",
      "line-height:1.65;color:var(--dsw-alias-label-secondary);user-select:none;",
      "background:var(--dsw-alias-bg-layer-2);border-right:1px solid var(--dsw-alias-border-l1)}",
      ".dsh-ide-ln{display:block;font-variant-numeric:tabular-nums}",
      ".dsh-ide-ln-active{color:#4176e6;font-weight:700}",
      ".dsh-ide-code{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden}",
      ".dsh-ide-pre,.dsh-ide-area{position:absolute;top:0;right:0;bottom:0;left:0;margin:0;border:0;",
      "box-sizing:border-box;padding:12px 16px;font-family:inherit;font-size:inherit;line-height:1.65;",
      "letter-spacing:0;tab-size:4;-moz-tab-size:4;white-space:pre;word-break:normal;overflow-wrap:normal}",
      ".dsh-ide-pre{overflow:hidden;pointer-events:none;",
      "color:var(--shiki-foreground,var(--dsw-alias-label-primary))}",
      ".dsh-ide-pre code{font:inherit}",
      ".dsh-ide-area{overflow:auto;resize:none;outline:none;color:transparent;background:transparent;",
      "caret-color:var(--shiki-foreground,var(--dsw-alias-label-primary))}",
      ".dsh-ide-area::selection{background:rgba(77,147,248,.30)}",
      ".dsh-ide-placeholder{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;",
      "justify-content:center;color:var(--dsw-alias-label-secondary);font-size:13px;padding:24px;text-align:center;",
      "pointer-events:none}",

      ".dsh-ide-out{height:150px;min-height:72px;overflow:auto;padding:10px 14px;",
      "font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;",
      "background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);",
      "border-top:1px solid var(--dsw-alias-border-l1)}",
      ".dsh-ide-out-muted{color:var(--dsw-alias-label-secondary)}",
      ".dsh-ide-out-ok{color:var(--dsw-alias-state-success-primary)}",
      ".dsh-ide-out-err{color:var(--dsw-alias-state-error-primary)}",

      ".dsh-ide-status{display:flex;align-items:center;gap:12px;padding:5px 12px;font-size:11.5px;",
      "color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l1);",
      "background:var(--dsw-alias-bg-layer-1);white-space:nowrap;overflow:hidden}",
      ".dsh-ide-status-text{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}",
      ".dsh-ide-caret{font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);flex:0 0 auto}",
      ".dsh-ide-link{flex:0 0 auto;background:none;border:none;padding:0;cursor:pointer;font:inherit;",
      "color:#4176e6}",
      ".dsh-ide-link:hover{text-decoration:underline}",

      ".dsh-ide-scroll{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent}",

      ".dsh-ide-toggle{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;",
      "font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap;",
      "border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);",
      "background:transparent;border:1px solid transparent;",
      "transition:background .1s var(--ds-ease-in-out),color .1s var(--ds-ease-in-out)}",
      ".dsh-ide-toggle:hover{color:var(--dsw-alias-label-primary);",
      "background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}",
      ".dsh-ide-toggle-on{color:#4176e6;background:var(--dsw-alias-bg-layer-2);",
      "border-color:var(--dsw-alias-border-l2)}",

      // project mode: group headers, add button, mode toggle, chips, error list
      ".dsh-ide-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-xs);overflow:hidden}",
      ".dsh-ide-seg-btn{padding:4px 10px;font-size:12px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit}",
      ".dsh-ide-seg-btn-on{background:#4176e6;color:#fff}",
      ".dsh-ide-group{display:flex;align-items:center;gap:5px;padding:7px 10px 3px;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}",
      ".dsh-ide-group:hover{color:var(--dsw-alias-label-primary)}",
      ".dsh-ide-group-open{color:var(--dsw-alias-label-primary)}",
      ".dsh-ide-chev{flex:0 0 auto;width:11px;font-size:10px;text-align:center;opacity:.85}",
      ".dsh-ide-group-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dsh-ide-count{flex:0 0 auto;font-weight:400;font-size:11.5px;opacity:.65;margin:0 3px}",
      ".dsh-ide-add{flex:0 0 auto;width:20px;height:20px;line-height:1;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:16px;padding:0}",
      ".dsh-ide-add:hover{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}",
      ".dsh-ide-chip{font-size:11px;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}",
      ".dsh-ide-chip-ok{color:var(--dsw-alias-state-success-primary)}",
      ".dsh-ide-chip-err{color:var(--dsw-alias-state-error-primary)}",
      ".dsh-ide-errlist{border-top:1px solid var(--dsw-alias-border-l1);max-height:130px;overflow:auto;background:var(--dsw-alias-bg-layer-2)}",
      ".dsh-ide-errrow{display:flex;gap:8px;align-items:baseline;padding:4px 12px;font-size:12px;cursor:pointer;border:none;background:transparent;width:100%;text-align:left;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code)}",
      ".dsh-ide-errrow:hover{background:var(--dsw-alias-bg-overlay)}",
      ".dsh-ide-err-kind-err{color:var(--dsw-alias-state-error-primary);font-weight:600;flex:0 0 auto}",
      ".dsh-ide-err-kind-warn{color:var(--dsw-alias-state-warn-primary);font-weight:600;flex:0 0 auto}",
      ".dsh-ide-err-file{color:var(--dsw-alias-label-secondary);flex:0 0 auto;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dsh-ide-err-msg{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",

      // restart button (sidebar foot) — mirrors the shell's 28px icon button
      ".dsh-ide-restart{width:28px;height:28px;padding:0;flex:0 0 auto;display:inline-flex;",
      "align-items:center;justify-content:center;border:none;border-radius:var(--dsw-radius-sm);",
      "background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;position:relative}",
      ".dsh-ide-restart:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));",
      "color:var(--dsw-alias-label-primary)}",
      ".dsh-ide-restart:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid ",
      "var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}",
      ".dsh-ide-restart[disabled]{cursor:default}",
      ".dsh-ide-restart-busy svg{animation:dsh-ide-spin 1s linear infinite}",
      "@keyframes dsh-ide-spin{to{transform:rotate(360deg)}}",
      // The modal is opaque on purpose: the card paints --dsw-alias-bg-base
      // (a layer token carries alpha in this theme) and each element repeats its
      // colour inline, so no missing variable can leave the dialog invisible.
      ".dsh-ide-confirm{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;",
      "justify-content:center;background:var(--dsw-alias-bg-mask-3,rgba(0,0,0,.48))}",
      ".dsh-ide-confirm-card{width:min(440px,92vw);border-radius:var(--dsw-radius-lg,12px);",
      "background:var(--dsw-alias-bg-base,Canvas);color:var(--dsw-alias-label-primary,CanvasText);",
      "border:1px solid var(--dsw-alias-border-l2,currentColor);",
      "box-shadow:0 18px 48px rgba(0,0,0,.35);padding:18px 18px 14px;",
      "font-family:var(--dsw-font-family,system-ui);font-size:13px}",
      ".dsh-ide-confirm-title{font-size:15px;font-weight:600;margin-bottom:8px}",
      ".dsh-ide-confirm-body{font-size:13px;line-height:1.6}",
      ".dsh-ide-confirm-body code{font-family:var(--ds-font-family-code,monospace);font-size:12px;",
      "background:var(--dsw-alias-bg-layer-2,transparent);padding:1px 5px;border-radius:4px}",
      ".dsh-ide-confirm-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}",
      ".dsh-ide-confirm-btn{padding:6px 14px;font-size:13px;font-family:inherit;cursor:pointer;",
      "border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;",
      "border:1px solid var(--dsw-alias-border-l2,currentColor)}",
      ".dsh-ide-confirm-go{border-color:transparent;font-weight:600}",
    ].join("");

    function ensureStyles() {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID)) return;
      var el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = CSS;
      document.head.appendChild(el);
    }

    /* ================================================================== *
     * Editor preferences (persisted per browser)                         *
     * ================================================================== */
    var FONT_OPTIONS = [
      { id: "dsh", label: "跟随 DSH", stack: 'var(--ds-font-family-code, Consolas, monospace)' },
      { id: "consolas", label: "Consolas", stack: 'Consolas, "Courier New", monospace' },
      { id: "cascadia", label: "Cascadia Code", stack: '"Cascadia Code", Consolas, monospace' },
      { id: "jetbrains", label: "JetBrains Mono", stack: '"JetBrains Mono", Consolas, monospace' },
      { id: "fira", label: "Fira Code", stack: '"Fira Code", Consolas, monospace' },
      { id: "source", label: "Source Code Pro", stack: '"Source Code Pro", Consolas, monospace' },
      { id: "menlo", label: "SF Mono / Menlo", stack: '"SF Mono", Menlo, Consolas, monospace' },
      { id: "system", label: "系统等宽", stack: "ui-monospace, SFMono-Regular, Consolas, monospace" },
    ];
    var FONT_MIN = 10;
    var FONT_MAX = 26;
    var SETTINGS_KEY = "dsh-ide-settings";

    function fontStackOf(id) {
      var found = FONT_OPTIONS.filter(function (f) { return f.id === id; })[0];
      return found ? found.stack : FONT_OPTIONS[0].stack;
    }
    function loadSettings() {
      var fallback = { fontSize: 14, fontId: "dsh" };
      try {
        var raw = window.localStorage.getItem(SETTINGS_KEY);
        if (!raw) return fallback;
        var parsed = JSON.parse(raw);
        var size = Number(parsed && parsed.fontSize);
        var known = FONT_OPTIONS.some(function (f) { return f.id === parsed.fontId; });
        return {
          fontSize: isFinite(size) ? Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(size))) : fallback.fontSize,
          fontId: known ? parsed.fontId : fallback.fontId,
        };
      } catch (e) { return fallback; }
    }
    function saveSettings(next) {
      try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    }

    // Collapsed/expanded project groups, remembered per project file.
    var EXPANDED_PREFIX = "dsh-ide-expanded:";
    function loadExpanded(projectPath) {
      try {
        var raw = window.localStorage.getItem(EXPANDED_PREFIX + projectPath);
        return raw ? (JSON.parse(raw) || {}) : null;
      } catch (e) { return null; }
    }
    function saveExpanded(projectPath, map) {
      try { window.localStorage.setItem(EXPANDED_PREFIX + projectPath, JSON.stringify(map || {})); } catch (e) { /* ignore */ }
    }

    /* ================================================================== *
     * Session-workspace bridge                                            *
     *                                                                     *
     * The IDE panel lives in the root-scoped `main` slot, which the shell  *
     * deliberately gives no Session binding — so it cannot tell which      *
     * conversation is on screen. The composer toggle is registered in      *
     * `conversation.input.left`, which IS session-scoped and receives      *
     * `sessionId` plus the `useWorkspaces` hook. It resolves the workspace *
     * root there and publishes it here for the panel to consume.           *
     * ================================================================== */
    var WORKSPACE_PROJECT_PREFIX = "dsh-ide-wsproject:";
    var sessionWorkspace = { cwd: null, sessionId: null, listeners: [] };

    function publishSessionWorkspace(cwd, sessionId) {
      var next = cwd || null;
      var nextId = sessionId || null;
      if (sessionWorkspace.cwd === next && sessionWorkspace.sessionId === nextId) return;
      sessionWorkspace.cwd = next;
      sessionWorkspace.sessionId = nextId;
      sessionWorkspace.listeners.slice().forEach(function (fn) {
        try { fn(next, nextId); } catch (e) { /* a bad listener must not break the rest */ }
      });
    }

    function subscribeSessionWorkspace(fn) {
      sessionWorkspace.listeners.push(fn);
      return function () {
        var i = sessionWorkspace.listeners.indexOf(fn);
        if (i !== -1) sessionWorkspace.listeners.splice(i, 1);
      };
    }

    /**
     * Resolve the workspace root for a session from a `WorkspaceSnapshot`
     * (`{ items: WorkspaceView[] , phase }`, where each view carries
     * `path` and `sessionIds`). Falls back to the only workspace when the
     * session id is unknown or not found yet.
     */
    function workspacePathForSession(snapshot, sessionId) {
      var items = snapshot && snapshot.items;
      if (!items || !items.length) return null;
      if (sessionId) {
        for (var i = 0; i < items.length; i += 1) {
          var ids = items[i] && items[i].sessionIds;
          if (ids && ids.indexOf(sessionId) !== -1 && items[i].path) return items[i].path;
        }
      }
      return items.length === 1 && items[0].path ? items[0].path : null;
    }

    /** The project the user picked by hand in this workspace, if any. */
    function loadWorkspaceProject(cwd) {
      if (!cwd) return null;
      try { return window.localStorage.getItem(WORKSPACE_PROJECT_PREFIX + cwd) || null; } catch (e) { return null; }
    }
    function saveWorkspaceProject(cwd, projectPath) {
      if (!cwd || !projectPath) return;
      try { window.localStorage.setItem(WORKSPACE_PROJECT_PREFIX + cwd, projectPath); } catch (e) { /* ignore */ }
    }

    /* ================================================================== *
     * Icons                                                              *
     * ================================================================== */
    function Svg(props) {
      return createElement("svg", {
        width: props.size || 16, height: props.size || 16, viewBox: "0 0 24 24",
        fill: "none", stroke: "currentColor", strokeWidth: "2",
        strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
      }, props.children);
    }
    function CodeGlyph(props) {
      return createElement(Svg, { size: props.size },
        createElement("polyline", { points: "16 18 22 12 16 6" }),
        createElement("polyline", { points: "8 6 2 12 8 18" }));
    }
    function FolderGlyph() {
      return createElement(Svg, { size: 15 },
        createElement("path", { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" }));
    }
    function FileGlyph() {
      return createElement(Svg, { size: 15 },
        createElement("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }),
        createElement("polyline", { points: "14 2 14 8 20 8" }));
    }
    /** Closed padlock — "this file is read-only". */
    function LockGlyph(props) {
      return createElement(Svg, { size: props.size || 8 },
        createElement("rect", { x: 3, y: 11, width: 18, height: 10, rx: 2 }),
        createElement("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }));
    }
    /** Open padlock — "this file is writable". The shackle swings clear of the body. */
    function UnlockGlyph(props) {
      return createElement(Svg, { size: props.size || 8 },
        createElement("rect", { x: 3, y: 11, width: 18, height: 10, rx: 2 }),
        createElement("path", { d: "M7 11V7a5 5 0 0 1 9.6-2" }));
    }
    /** Neutral mark for a plain informational toast. */
    function InfoGlyph(props) {
      return createElement(Svg, { size: props.size || 11 },
        createElement("circle", { cx: 12, cy: 12, r: 9 }),
        createElement("path", { d: "M12 11v5" }),
        createElement("path", { d: "M12 8h.01" }));
    }

    /**
     * A file glyph carrying a corner badge when the file is read-only on disk —
     * the at-a-glance warning that keeps standard-library code from being edited
     * by accident.
     */
    function FileIcon(props) {
      if (!props.readOnly) return createElement("span", { className: "dsh-ide-glyph" }, createElement(FileGlyph));
      return createElement("span", {
        className: "dsh-ide-glyph", title: "只读文件：写入已被禁用（工具栏锁形按钮可解锁）",
      },
        createElement(FileGlyph),
        createElement("span", { className: "dsh-ide-ro" }, createElement(LockGlyph)));
    }

    /** Sidebar panel glyph — the "IDE mode" switch entry. */
    function IdeGlyph(props) {
      return createElement("span", {
        style: {
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: props.active ? "#4176e6" : "inherit",
        },
      }, createElement(CodeGlyph, { size: props.size || 16 }));
    }

    /* ================================================================== *
     * C tokenizer. Colours map onto DSH's own Shiki token variables, so   *
     * the editor reads exactly like a DSH code block and follows the      *
     * app's light/dark switch for free.                                   *
     * ================================================================== */
    var KEYWORDS = {};
    ("auto break case char const continue default do double else enum extern float for goto if inline "
      + "int long register restrict return short signed sizeof static struct switch typedef union unsigned "
      + "void volatile while _Bool _Complex _Atomic _Static_assert _Thread_local _Alignas _Alignof _Generic "
      + "_Noreturn _Pragma asm __asm__ __inline __restrict __attribute__ __declspec true false").split(" ")
      .forEach(function (w) { KEYWORDS[w] = 1; });

    var TYPES = {};
    ("size_t ssize_t ptrdiff_t intptr_t uintptr_t wchar_t char16_t char32_t bool FILE va_list time_t off_t "
      + "pid_t socklen_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t intmax_t uintmax_t "
      + "u8 u16 u32 u64 s8 s16 s32 s64").split(" ")
      .forEach(function (w) { TYPES[w] = 1; });

    var TOKEN_COLOR = {
      keyword: "var(--shiki-token-keyword)",
      type: "var(--shiki-token-constant)",
      function: "var(--shiki-token-function)",
      string: "var(--shiki-token-string)",
      number: "var(--shiki-token-constant)",
      constant: "var(--shiki-token-parameter)",
      comment: "var(--shiki-token-comment)",
      punct: "var(--shiki-token-punctuation)",
    };

    var IDENT_START = /[A-Za-z_$]/;
    var IDENT_PART = /[A-Za-z0-9_$]/;
    var MACRO_NAME = /^[A-Z_][A-Z0-9_]*$/;
    var PUNCT = "(){}[];,.<>+-*/%=&|!^~?:#";

    function isDigit(ch) { return ch >= "0" && ch <= "9"; }

    /** Scan C source into {t, v} tokens. Unterminated literals run to EOF. */
    function tokenizeC(src) {
      var out = [];
      var i = 0;
      var n = src.length;
      var lineStart = true;
      var inInclude = false;

      function emit(t, v) { if (v) out.push({ t: t, v: v }); }

      while (i < n) {
        var ch = src[i];

        if (ch === "\n") { emit("plain", "\n"); i += 1; lineStart = true; inInclude = false; continue; }
        if (ch === " " || ch === "\t" || ch === "\r") {
          var ws = i;
          while (i < n && (src[i] === " " || src[i] === "\t" || src[i] === "\r")) i += 1;
          emit("plain", src.slice(ws, i));
          continue;
        }

        if (ch === "#" && lineStart) {
          emit("keyword", "#");
          i += 1;
          lineStart = false;
          var sp = i;
          while (i < n && (src[i] === " " || src[i] === "\t")) i += 1;
          emit("plain", src.slice(sp, i));
          if (i < n && IDENT_START.test(src[i])) {
            var ds = i;
            while (i < n && IDENT_PART.test(src[i])) i += 1;
            var directive = src.slice(ds, i);
            emit("keyword", directive);
            inInclude = directive === "include" || directive === "include_next";
          }
          continue;
        }

        lineStart = false;

        if (ch === "/" && src[i + 1] === "/") {
          var lineEnd = src.indexOf("\n", i);
          if (lineEnd === -1) lineEnd = n;
          emit("comment", src.slice(i, lineEnd));
          i = lineEnd;
          continue;
        }
        if (ch === "/" && src[i + 1] === "*") {
          var blockEnd = src.indexOf("*/", i + 2);
          blockEnd = blockEnd === -1 ? n : blockEnd + 2;
          emit("comment", src.slice(i, blockEnd));
          i = blockEnd;
          continue;
        }
        if (ch === '"' || ch === "'") {
          var quote = ch;
          var j = i + 1;
          while (j < n) {
            if (src[j] === "\\") { j += 2; continue; }
            if (src[j] === quote) { j += 1; break; }
            if (src[j] === "\n") break;
            j += 1;
          }
          j = Math.min(j, n);
          emit("string", src.slice(i, j));
          i = j;
          continue;
        }
        if (inInclude && ch === "<") {
          var gt = src.indexOf(">", i);
          var nl = src.indexOf("\n", i);
          if (gt !== -1 && (nl === -1 || gt < nl)) {
            emit("string", src.slice(i, gt + 1));
            i = gt + 1;
            continue;
          }
        }
        if (isDigit(ch) || (ch === "." && isDigit(src[i + 1] || ""))) {
          var numStart = i;
          while (i < n) {
            var c = src[i];
            if (c === "+" || c === "-") {
              var prev = src[i - 1] || "";
              if (prev !== "e" && prev !== "E" && prev !== "p" && prev !== "P") break;
              i += 1;
              continue;
            }
            if (/[0-9a-fA-FxXbBoO._]/.test(c)) { i += 1; continue; }
            break;
          }
          emit("number", src.slice(numStart, i));
          continue;
        }
        if (IDENT_START.test(ch)) {
          var idStart = i;
          while (i < n && IDENT_PART.test(src[i])) i += 1;
          var word = src.slice(idStart, i);
          var k = i;
          while (k < n && (src[k] === " " || src[k] === "\t")) k += 1;
          if (KEYWORDS[word]) emit("keyword", word);
          else if (TYPES[word]) emit("type", word);
          else if (src[k] === "(") emit("function", word);
          else if (MACRO_NAME.test(word) && word.length > 1) emit("constant", word);
          else emit("plain", word);
          continue;
        }
        if (PUNCT.indexOf(ch) !== -1) { emit("punct", ch); i += 1; continue; }
        emit("plain", ch);
        i += 1;
      }
      return out;
    }

    var HIGHLIGHT_LIMIT = 200000; // characters; above this render plain text

    function renderHighlight(tokens, source) {
      if (tokens === null) return [source, "\n"];
      var nodes = [];
      for (var i = 0; i < tokens.length; i += 1) {
        var tok = tokens[i];
        var color = TOKEN_COLOR[tok.t];
        if (color) nodes.push(createElement("span", { key: i, style: { color: color } }, tok.v));
        else nodes.push(tok.v);
      }
      nodes.push("\n");
      return nodes;
    }

    /* ================================================================== *
     * Code editor: a numbered gutter beside a highlighted <pre> behind a  *
     * transparent <textarea>, so the native caret, selection and IME      *
     * still behave normally.                                             *
     * ================================================================== */
    function CodeEditor(props) {
      var preRef = useRef(null);
      var areaRef = useRef(null);
      var gutterRef = useRef(null);

      var lineCount = useMemo(function () {
        if (typeof props.value !== "string") return 1;
        return props.value.split("\n").length;
      }, [props.value]);

      var tokens = useMemo(function () {
        if (typeof props.value !== "string") return [];
        if (props.value.length > HIGHLIGHT_LIMIT) return null;
        return tokenizeC(props.value);
      }, [props.value]);

      var sync = useCallback(function () {
        var area = areaRef.current;
        if (!area) return;
        if (preRef.current) {
          preRef.current.scrollTop = area.scrollTop;
          preRef.current.scrollLeft = area.scrollLeft;
        }
        if (gutterRef.current) gutterRef.current.scrollTop = area.scrollTop;
      }, []);

      // Read the live DOM value: props.value is one render behind during onChange.
      var reportCaret = useCallback(function () {
        var area = areaRef.current;
        if (!area || !props.onCaret) return;
        var value = area.value;
        var start = area.selectionStart;
        var end = area.selectionEnd;
        var head = value.slice(0, start).split("\n");
        var info = { line: head.length, col: head[head.length - 1].length + 1, selStart: null, selEnd: null };
        if (end > start) {
          info.selStart = head.length;
          info.selEnd = value.slice(0, end).split("\n").length;
        }
        props.onCaret(info);
      }, [props.onCaret]);

      useEffect(function () { sync(); }, [tokens, sync, lineCount]);
      useEffect(function () { reportCaret(); }, [props.value, reportCaret]);

      var gotoLine = useCallback(function (line) {
        var area = areaRef.current;
        if (!area) return;
        var value = area.value;
        var parts = value.split("\n");
        var idx = 0;
        for (var i = 0; i < line - 1 && i < parts.length; i += 1) idx += parts[i].length + 1;
        area.selectionStart = area.selectionEnd = Math.min(idx, value.length);
        var lh = (props.fontSize || 14) * 1.65;
        area.scrollTop = Math.max(0, (line - 1) * lh - lh * 2);
        area.focus();
        sync();
        reportCaret();
      }, [props.fontSize, sync, reportCaret]);

      useEffect(function () {
        if (props.jump && props.jump.line) gotoLine(props.jump.line);
      }, [props.jump, gotoLine]);

      function onKeyDown(e) {
        if (e.key === "Tab") {
          e.preventDefault();
          var area = areaRef.current;
          if (area) {
            var start = area.selectionStart;
            var end = area.selectionEnd;
            props.onChange(props.value.slice(0, start) + "    " + props.value.slice(end));
            requestAnimationFrame(function () {
              if (areaRef.current) areaRef.current.selectionStart = areaRef.current.selectionEnd = start + 4;
            });
          }
        }
        if (props.onKeyDown) props.onKeyDown(e);
      }

      var numbers = [];
      for (var n = 1; n <= lineCount; n += 1) {
        numbers.push(createElement("div", {
          key: n,
          className: "dsh-ide-ln" + (props.caret && props.caret.line === n ? " dsh-ide-ln-active" : ""),
        }, n));
      }

      return createElement("div", {
        className: "dsh-ide-codewrap",
        style: { fontFamily: props.fontFamily, fontSize: props.fontSize + "px" },
      },
        createElement("div", { className: "dsh-ide-gutter", ref: gutterRef, "aria-hidden": "true" }, numbers),
        createElement("div", { className: "dsh-ide-code" },
          createElement("pre", { className: "dsh-ide-pre", ref: preRef, "aria-hidden": "true" },
            createElement("code", null, renderHighlight(tokens, props.value))),
          createElement("textarea", {
            className: "dsh-ide-area" + (props.readOnly ? " dsh-ide-area-ro" : ""),
            ref: areaRef,
            value: props.value,
            wrap: "off",
            spellCheck: false,
            autoCapitalize: "off",
            autoCorrect: "off",
            readOnly: !!props.readOnly,
            "aria-readonly": props.readOnly ? "true" : "false",
            "aria-label": "C source editor",
            onChange: function (e) { props.onChange(e.target.value); reportCaret(); },
            onScroll: sync,
            onKeyUp: reportCaret,
            onClick: reportCaret,
            onSelect: reportCaret,
            onKeyDown: onKeyDown,
          })));
    }

    /* ================================================================== *
     * File tree                                                          *
     * ================================================================== */
    function FileTree(props) {
      var listing = props.listing;
      var canGoUp = props.dir && props.dir !== props.root;
      var dirs = listing.dirs || [];
      var files = listing.files || [];
      return createElement("div", { className: "dsh-ide-tree dsh-ide-scroll" },
        canGoUp && createElement("button", {
          type: "button", className: "dsh-ide-row dsh-ide-row-up", onClick: props.onUp,
        }, "↑  上级目录"),
        dirs.map(function (d) {
          return createElement("button", {
            type: "button", key: "d:" + d.name, className: "dsh-ide-row", title: d.name,
            onClick: function () { props.onOpenDir(d.name); },
          }, createElement(FolderGlyph), createElement("span", null, d.name));
        }),
        files.map(function (f) {
          return createElement("button", {
            type: "button", key: "f:" + f.name, className: "dsh-ide-row", title: f.name,
            onClick: function () { props.onOpenFile(f.name); },
          }, createElement(FileIcon, { readOnly: f.readOnly }), createElement("span", null, f.name));
        }),
        dirs.length === 0 && files.length === 0 &&
          createElement("div", { className: "dsh-ide-empty" }, "此目录没有 .c / .h 文件"));
    }

    /* ================================================================== *
     * Project tree (uvprojx groups + files)                               *
     * ================================================================== */
    function ProjectTree(props) {
      var target = props.target || { groups: [] };
      var groups = target.groups || [];
      var expanded = props.expanded || {};
      return createElement("div", { className: "dsh-ide-tree dsh-ide-scroll" },
        groups.map(function (g) {
          var open = !!expanded[g.name];
          var files = g.files || [];
          // Two-state lock: closed + amber once every file is protected.
          var allLocked = files.length > 0 && files.every(function (f) { return f.readOnly; });
          var rows = [createElement("div", {
            key: "h",
            className: "dsh-ide-group" + (open ? " dsh-ide-group-open" : ""),
            title: (open ? "折叠 " : "展开 ") + g.name,
            onClick: function () { props.onToggleGroup(g.name); },
          },
            createElement("span", { className: "dsh-ide-chev" }, open ? "▾" : "▸"),
            createElement("span", { className: "dsh-ide-group-name" }, g.name),
            createElement("span", { className: "dsh-ide-count" }, files.length),
            createElement("button", {
              type: "button", className: "dsh-ide-add" + (allLocked ? " dsh-ide-add-on" : ""),
              title: allLocked
                ? "该分组已全部只读 —— 点击解锁"
                : "把该分组设为只读（保护标准库代码，防手滑）",
              onClick: function (e) { e.stopPropagation(); props.onToggleGroupReadOnly(g); },
            }, createElement(allLocked ? LockGlyph : UnlockGlyph, { size: 10 })),
            createElement("button", {
              type: "button", className: "dsh-ide-add", title: "向该分组添加 / 新建文件",
              onClick: function (e) { e.stopPropagation(); props.onAddFile(g.name); },
            }, "+"))];
          if (open) {
            for (var i = 0; i < files.length; i += 1) {
              (function (f) {
                var unsaved = (props.dirtyPaths || []).indexOf(f.abs) !== -1;
                rows.push(createElement("button", {
                  type: "button", key: g.name + "|" + f.path,
                  className: "dsh-ide-row" + (unsaved ? " dsh-ide-row-dirty" : ""),
                  title: f.path + (unsaved ? "（有未保存的修改）" : ""),
                  onClick: function () { props.onOpenFile(f); },
                }, createElement(FileIcon, { readOnly: f.readOnly }), createElement("span", null, f.name),
                  unsaved && createElement("span", { className: "dsh-ide-dirtydot" })));
              })(files[i]);
            }
          }
          return createElement("div", { key: g.name }, rows);
        }),
        groups.length === 0 &&
          createElement("div", { className: "dsh-ide-empty" }, "工程没有分组"));
    }

    /* ================================================================== *
     * Build-error list (click to jump to file:line)                       *
     * ================================================================== */
    function ErrorList(props) {
      var d = props.diagnostics;
      if (!d || !d.issues || d.issues.length === 0) return null;
      return createElement("div", { className: "dsh-ide-errlist dsh-ide-scroll" },
        createElement("div", { className: "dsh-ide-group" },
          createElement("span", { className: "dsh-ide-group-name" }, d.errors + " 错误 · " + d.warnings + " 警告"),
          d.programSize ? createElement("span", { className: "dsh-ide-chip" }, d.programSize) : null),
        d.issues.map(function (it, i) {
          return createElement("button", {
            type: "button", key: i, className: "dsh-ide-errrow",
            onClick: function () { props.onJump(it); },
          },
            createElement("span", { className: "dsh-ide-err-kind-" + (it.kind === "error" ? "err" : "warn") },
              it.kind === "error" ? "错误" : "警告"),
            createElement("span", { className: "dsh-ide-err-file" }, it.file + ":" + it.line),
            createElement("span", { className: "dsh-ide-err-msg" }, it.message));
        }));
    }

    /* ================================================================== *
     * The IDE surface, shared by the main panel and the right dock        *
     * ================================================================== */
    function basename(p) {
      if (!p) return "";
      var parts = String(p).split(/[\\/]/);
      return parts[parts.length - 1] || p;
    }
    function shortPath(base, full) {
      var b = String(base || "").replace(/[\\/]+$/, "");
      if (b && String(full).toLowerCase().indexOf(b.toLowerCase()) === 0) {
        return String(full).slice(b.length).replace(/^[\\/]+/, "");
      }
      return full;
    }
    var EMPTY_CARET = { line: 1, col: 1, selStart: null, selEnd: null };

    function IdeView(props) {
      var ctx = props.ctx;
      var compact = !!props.compact;

      var rootRef = useRef(null);
      var [mode, setMode] = useState("dir");
      var [root, setRoot] = useState("");
      var [dir, setDir] = useState("");
      var [listing, setListing] = useState({ dirs: [], files: [] });
      var [project, setProject] = useState(null);
      var [expanded, setExpanded] = useState({});
      var [targetIndex, setTargetIndex] = useState(0);
      var [keil, setKeil] = useState(null);
      var [choices, setChoices] = useState(null);
      var [file, setFile] = useState(null);
      var [dirty, setDirty] = useState(false);

      /**
       * Unsaved edits keyed by canonical path.
       *
       * Switching files must not throw work away — the old buffer is kept here
       * and restored when that file is opened again, so the panel behaves like
       * a real editor instead of a viewer that forgets.
       */
      var dirtyMap = useRef({});
      var [dirtyPaths, setDirtyPaths] = useState([]);

      /** In-panel "add file" dialog state: { group, name, mode } or null. */
      var [addDialog, setAddDialog] = useState(null);

      /** Record or clear one path's buffer and refresh the derived list. */
      var setBuffer = useCallback(function (absPath, content) {
        if (!absPath) return;
        if (content === undefined) delete dirtyMap.current[absPath];
        else dirtyMap.current[absPath] = content;
        setDirtyPaths(Object.keys(dirtyMap.current));
      }, []);

      var [caret, setCaret] = useState(EMPTY_CARET);
      var [status, setStatus] = useState("");
      var [output, setOutput] = useState(null);
      var [diagnostics, setDiagnostics] = useState(null);
      var [jump, setJump] = useState(null);
      var [command, setCommand] = useState("gcc {file} -o {out}");
      var [busy, setBusy] = useState(false);
      var initial = useMemo(loadSettings, []);
      var [fontSize, setFontSize] = useState(initial.fontSize);
      var [fontId, setFontId] = useState(initial.fontId);

      // Which workspace this panel should follow. Published by the
      // session-scoped composer toggle; null while it is still unknown.
      var [wsCwd, setWsCwd] = useState(sessionWorkspace.cwd);
      var [emptyWorkspace, setEmptyWorkspace] = useState(null);
      /** Workspace we already ran auto-discovery for, so a re-render cannot re-open a stale project. */
      var autoLoadedFor = useRef(null);

      /**
       * Bottom-left transient status toasts. One animation shared by every
       * status update — read-only changes today, anything else tomorrow.
       * `locked` picks the padlock (true = closed, false = open, null = info).
       */
      var [toasts, setToasts] = useState([]);
      var toastSeq = useRef(0);
      var toastTimers = useRef([]);

      var pushToast = useCallback(function (opts) {
        var id = (toastSeq.current += 1);
        var toast = {
          id: id,
          title: opts.title || "",
          detail: opts.detail || "",
          tone: opts.tone || "info",
          locked: opts.locked === undefined ? null : !!opts.locked,
          leaving: false,
        };
        setToasts(function (list) { return list.concat([toast]).slice(-3); });
        toastTimers.current.push(later(function () {
          setToasts(function (list) {
            return list.map(function (t) { return t.id === id ? Object.assign({}, t, { leaving: true }) : t; });
          });
          toastTimers.current.push(later(function () {
            setToasts(function (list) { return list.filter(function (t) { return t.id !== id; }); });
          }, 220));
        }, 3400));
      }, []);

      // Drop every pending dismissal timer when the panel unmounts.
      useEffect(function () {
        return function () {
          toastTimers.current.forEach(cancelLater);
          toastTimers.current = [];
        };
      }, []);

      /**
       * Write one path's buffer to disk. Resolves to true on success.
       * Defined after `pushToast` so its dependency is a real function.
       */
      var flushBuffer = useCallback(function (absPath) {
        var content = dirtyMap.current[absPath];
        if (content === undefined) return Promise.resolve(true);
        return api("POST", "/dsh-ide/write", { path: absPath, content: content }).then(function (r) {
          if (r && r.ok) { setBuffer(absPath, undefined); return true; }
          if (r && r.readOnly) {
            pushToast({ tone: "err", locked: true, title: "保存被拒绝", detail: basename(absPath) + " 是只读文件" });
          }
          setStatus("保存失败：" + basename(absPath) + " — " + ((r && r.error) || "unknown"));
          return false;
        });
      }, [setBuffer, pushToast]);

      useEffect(function () {
        setWsCwd(sessionWorkspace.cwd);
        return subscribeSessionWorkspace(function (cwd) { setWsCwd(cwd); });
      }, []);

      useEffect(function () { saveSettings({ fontSize: fontSize, fontId: fontId }); }, [fontSize, fontId]);

      var listDir = useCallback(function (dirPath, quiet) {
        if (!dirPath) return;
        api("GET", "/dsh-ide/list", { path: dirPath }).then(function (r) {
          if (r && r.ok) {
            setDir(r.path);
            setListing({ dirs: r.dirs || [], files: r.files || [] });
            if (!quiet) setStatus("已列出 " + r.path);
          } else {
            setStatus("列表失败：" + ((r && r.error) || "unknown"));
          }
        });
      }, []);

      useEffect(function () {
        api("GET", "/dsh-ide/keil").then(function (r) { if (r && r.ok) setKeil(r.keil); });
        api("GET", "/dsh-ide/info").then(function (info) {
          // The workspace auto-loader is authoritative once it knows a
          // workspace, so it must not be clobbered by this fallback root.
          if (sessionWorkspace.cwd || autoLoadedFor.current) return;
          var start = info && info.cwd ? info.cwd : "";
          rootRef.current = start;
          setRoot(start);
          listDir(start);
        });
      }, [listDir]);

      // Auto-load the workspace's Keil project. Runs once per workspace; the
      // previous project's state is cleared first so switching workspaces can
      // never leave a stale tree on screen.
      useEffect(function () {
        if (!wsCwd || autoLoadedFor.current === wsCwd) return;
        autoLoadedFor.current = wsCwd;

        setProject(null);
        setChoices(null);
        setEmptyWorkspace(null);
        setFile(null);
        setDirty(false);
        setDiagnostics(null);
        setOutput(null);
        setMode("project");
        setTargetIndex(0);
        rootRef.current = wsCwd;
        setRoot(wsCwd);
        setStatus("工作区：" + wsCwd);

        var prefer = loadWorkspaceProject(wsCwd);
        api("GET", "/dsh-ide/workspace", { cwd: wsCwd, prefer: prefer || undefined }).then(function (r) {
          if (!r || !r.ok) { setStatus("载入工程失败：" + ((r && r.error) || "unknown")); return; }
          if (r.project) { listDir(r.project.baseDir, true); applyProject(r.project); return; }
          if (r.candidates && r.candidates.length) {
            setChoices(r.candidates);
            setStatus("本工作区有 " + r.candidates.length + " 个工程，请选择");
            return;
          }
          // Nothing here: say so plainly, keep the manual entry points, and
          // never fall back to some other directory's project.
          setEmptyWorkspace(wsCwd);
          setStatus("本工作区未发现 Keil 工程");
        });
      }, [wsCwd, applyProject, listDir]);

      // Restore the collapsed/expanded group state for whichever project is open.
      // First open (nothing saved yet): expand the small groups — usually the
      // user's own code — and keep the big library groups collapsed.
      useEffect(function () {
        if (!project) { setExpanded({}); return; }
        var saved = loadExpanded(project.path);
        if (saved) { setExpanded(saved); return; }
        var t = project.targets[0];
        var def = {};
        if (t) {
          for (var i = 0; i < t.groups.length; i += 1) {
            if ((t.groups[i].files || []).length <= 12) def[t.groups[i].name] = true;
          }
        }
        setExpanded(def);
      }, [project && project.path]);

      // Report the file + caret to the host, which mirrors it to
      // $DSH_HOME/dsh-ide-state.json so an Agent can resolve "line N"
      // without being told which file is open.
      useEffect(function () {
        if (!file) return undefined;
        var timer = later(function () {
          api("POST", "/dsh-ide/state", {
            file: file.path,
            line: caret.line,
            col: caret.col,
            selStart: caret.selStart,
            selEnd: caret.selEnd,
          });
        }, 350);
        return function () { cancelLater(timer); };
      }, [file, caret]);

      var openPath = useCallback(function (absPath) {
        api("GET", "/dsh-ide/read", { path: absPath }).then(function (r) {
          if (r && r.ok) {
            var ro = !!r.readOnly;
            // A file with unsaved edits reopens with that buffer, not the disk copy.
            var buffered = dirtyMap.current[r.path];
            setFile({ path: r.path, content: buffered === undefined ? r.content : buffered, readOnly: ro });
            setDirty(buffered !== undefined);
            setCaret(EMPTY_CARET);
            setStatus(ro
              ? "已打开（只读）：" + r.path
              : (buffered !== undefined ? "已恢复未保存的修改：" + r.path : "已打开 " + r.path));
          } else {
            setStatus("打开失败：" + ((r && r.error) || "unknown"));
          }
        });
      }, []);

      /** Re-read whatever tree is on screen so the badges follow the disk state. */
      var refreshReadOnly = useCallback(function () {
        if (project) {
          api("POST", "/dsh-ide/project", { project: project.path, cwd: sessionWorkspace.cwd || undefined })
            .then(function (r) { if (r && r.ok && r.project) setProject(r.project); });
        } else if (dir) {
          listDir(dir, true);
        }
      }, [project, dir, listDir]);

      /**
       * Set or clear the read-only attribute. `absPath` defaults to the open
       * file; a directory recurses, so a whole library group is one click.
       */
      var setReadOnlyAt = useCallback(function (absPath, readOnly) {
        if (!absPath) return;
        setBusy(true);
        api("POST", "/dsh-ide/readonly", { path: absPath, readOnly: !!readOnly }).then(function (r) {
          setBusy(false);
          if (!r || !r.ok) {
            setStatus("设置只读失败：" + ((r && r.error) || "unknown"));
            pushToast({ tone: "err", title: "设置只读失败", detail: (r && r.error) || "unknown" });
            return;
          }
          var n = typeof r.changed === "number" ? r.changed : 1;
          var scope = n > 1 ? n + " 个文件" : basename(absPath);
          setStatus((r.readOnly ? "已设为只读：" : "已取消只读：") + basename(absPath) + (n > 1 ? "（含 " + n + " 个文件）" : ""));
          pushToast({
            tone: r.readOnly ? "on" : "off",
            locked: !!r.readOnly,
            title: r.readOnly ? "已锁定为只读" : "已解锁，可以编辑",
            detail: scope + (r.readOnly ? " · 保存会被阻止" : " · 保存已放行"),
          });
          if (file && file.path === absPath) {
            setFile({ path: file.path, content: file.content, readOnly: !!r.readOnly });
          }
          refreshReadOnly();
        }).catch(function (err) {
          setBusy(false);
          var msg = (err && err.message) || String(err);
          setStatus("设置只读失败：" + msg);
          pushToast({ tone: "err", title: "设置只读失败", detail: msg });
        });
      }, [file, refreshReadOnly, pushToast]);

      var applyProject = useCallback(function (p) {
        setProject(p); setMode("project"); setChoices(null); setTargetIndex(0);
        setEmptyWorkspace(null);
        rootRef.current = p.baseDir; setRoot(p.baseDir);
        // Remember the choice against this workspace, so reopening it is instant
        // and auto-discovery will not override the user's pick.
        saveWorkspaceProject(sessionWorkspace.cwd || p.baseDir, p.path);
        var dev = p.targets[0] && p.targets[0].device ? " · " + p.targets[0].device : "";
        setStatus("已打开工程 " + basename(p.path) + dev);
      }, []);

      var openProject = useCallback(function () {
        var uiWorkspace = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : null;
        if (!uiWorkspace || typeof uiWorkspace.pickDirectory !== "function") { setStatus("当前环境不支持文件夹选择，请手动输入 .uvprojx 路径"); return; }
        setStatus("选择工程所在目录…");
        uiWorkspace.pickDirectory().then(function (picked) {
          if (!picked) { setStatus("未选择目录"); return; }
          rootRef.current = picked; setRoot(picked);
          api("POST", "/dsh-ide/project", { dir: picked }).then(function (r) {
            if (r && r.ok) {
              if (r.multiple) { setChoices(r.candidates); setMode("project"); setStatus("发现多个工程，请选择"); }
              else applyProject(r.project);
            } else setStatus("打开工程失败：" + ((r && r.error) || "unknown"));
          });
        }).catch(function (err) { setStatus("打开工程失败：" + ((err && err.message) || err)); });
      }, [ctx, applyProject]);

      var openProjectPath = useCallback(function (abs) {
        api("POST", "/dsh-ide/project", { project: abs, cwd: sessionWorkspace.cwd || undefined }).then(function (r) {
          if (r && r.ok && r.project) applyProject(r.project);
          else setStatus("打开工程失败：" + ((r && r.error) || "unknown"));
        });
      }, [applyProject]);

      var toggleGroup = useCallback(function (name) {
        setExpanded(function (cur) {
          var next = Object.assign({}, cur);
          if (next[name]) delete next[name]; else next[name] = true;
          if (project) saveExpanded(project.path, next);
          return next;
        });
      }, [project]);

      /**
       * Protect (or release) every file of a project group in one action — the
       * quick way to lock down a standard-library group. The directories are
       * derived from the group's own files, so a group spread over several
       * folders is handled too.
       */
      var setGroupReadOnly = useCallback(function (group) {
        var readOnly = (group.files || []).some(function (f) { return !f.readOnly; });
        var dirs = [];
        (group.files || []).forEach(function (f) {
          var dir = String(f.abs || "").replace(/[\\/][^\\/]*$/, "");
          if (dir && dirs.indexOf(dir) === -1) dirs.push(dir);
        });
        if (!dirs.length) { setStatus("该分组里的文件不在磁盘上，无法设置只读"); return; }
        setBusy(true);
        var changed = 0;
        var chain = Promise.resolve();
        dirs.forEach(function (dir) {
          chain = chain.then(function () {
            return api("POST", "/dsh-ide/readonly", { path: dir, readOnly: readOnly }).then(function (r) {
              if (r && r.ok) changed += (r.changed || 0);
            });
          });
        });
        chain.then(function () {
          setBusy(false);
          setStatus((readOnly ? "已把分组设为只读：" : "已取消分组只读：") + group.name + "（" + changed + " 个文件）");
          pushToast({
            tone: readOnly ? "on" : "off",
            locked: readOnly,
            title: readOnly ? "分组已锁定为只读" : "分组已解锁",
            detail: group.name + " · " + changed + " 个文件",
          });
          refreshReadOnly();
        }).catch(function (err) {
          setBusy(false);
          var msg = (err && err.message) || String(err);
          setStatus("设置只读失败：" + msg);
          pushToast({ tone: "err", title: "设置分组只读失败", detail: msg });
        });
      }, [refreshReadOnly, pushToast]);

      var save = useCallback(function () {
        if (!file) return;
        // The badge is not decoration: a protected file is refused here and
        // again on the host, so a mis-click cannot rewrite library code.
        if (file.readOnly) {
          setStatus("「" + basename(file.path) + "」是只读文件，已阻止保存。要修改请先点工具栏的锁形按钮解锁。");
          pushToast({
            tone: "err", locked: true,
            title: "已阻止保存",
            detail: basename(file.path) + " 是只读文件，先解锁再保存",
          });
          return;
        }
        // Seed the buffer from what is on screen when the editor never fired
        // onChange (e.g. a freshly opened file).
        if (dirtyMap.current[file.path] === undefined) dirtyMap.current[file.path] = file.content;
        setBusy(true);
        flushBuffer(file.path).then(function (ok) {
          setBusy(false);
          if (ok) { setDirty(false); setStatus("已保存 " + file.path); }
        });
      }, [file, flushBuffer, pushToast]);

      /** Write every unsaved buffer in one go. */
      var saveAll = useCallback(function () {
        var paths = Object.keys(dirtyMap.current);
        if (paths.length === 0) return;
        setBusy(true);
        var saved = 0;
        var chain = Promise.resolve();
        paths.forEach(function (p) {
          chain = chain.then(function () {
            return flushBuffer(p).then(function (ok) { if (ok) saved += 1; });
          });
        });
        chain.then(function () {
          setBusy(false);
          if (file) setDirty(dirtyMap.current[file.path] !== undefined);
          var all = saved === paths.length;
          setStatus((all ? "已保存全部 " : "部分保存失败：") + saved + " / " + paths.length + " 个文件");
          pushToast({
            tone: all ? "info" : "err", locked: null,
            title: all ? "全部保存完成" : "有文件保存失败",
            detail: saved + " / " + paths.length + " 个文件",
          });
        });
      }, [file, flushBuffer, pushToast]);

      var compile = useCallback(function () {
        if (!file) return;
        setBusy(true);
        setDiagnostics(null);
        setOutput({ text: "编译中…", kind: "muted" });
        setStatus("编译中…");
        api("POST", "/dsh-ide/compile", { file: file.path, command: command }).then(function (r) {
          setBusy(false);
          if (r && r.ok) {
            var body = (r.stdout || "") + (r.stderr || "");
            if (!body.trim()) body = "(编译器没有输出)";
            setOutput({
              text: "$ " + r.command + "\n\n" + body.replace(/\s+$/, "") + "\n\n[退出码 " + r.exitCode + "]",
              kind: r.exitCode === 0 ? "ok" : "err",
            });
            setStatus(r.exitCode === 0 ? "编译成功" : "编译结束（退出码 " + r.exitCode + "）");
          } else {
            setOutput({ text: "编译请求失败：" + ((r && r.error) || "unknown"), kind: "err" });
            setStatus("编译失败");
          }
        });
      }, [file, command]);

      var pollJob = useCallback(function (jobId, kind) {
        api("GET", "/dsh-ide/job", { id: jobId }).then(function (r) {
          if (!r || !r.ok || !r.job) { setBusy(false); return; }
          var j = r.job;
          var outText = (j.output || "").trim() || "(无输出)";
          setOutput({ text: outText, kind: j.exitCode === 0 ? "ok" : (j.status === "running" ? "muted" : "err") });
          if (j.diagnostics) setDiagnostics(j.diagnostics);
          if (j.status === "done" || j.status === "error") {
            setBusy(false);
            var label = kind === "build" ? "构建" : "烧录";
            if (j.status === "error") setStatus(label + "出错：" + (j.error || ""));
            else setStatus(j.exitCode === 0 ? label + "成功" : label + "失败（" + (j.exitMessage || ("退出码 " + j.exitCode)) + "）");
            return;
          }
          setTimeout(function () { pollJob(jobId, kind); }, 600);
        });
      }, []);

      var startJob = useCallback(function (kind) {
        if (!project) { setStatus("请先打开工程"); return; }
        if (!keil || !keil.found) { setStatus("未检测到 Keil MDK，无法" + (kind === "build" ? "编译" : "烧录")); return; }
        var targetName = project.targets[targetIndex] ? project.targets[targetIndex].name : undefined;
        setBusy(true); setDiagnostics(null);
        setOutput({ text: (kind === "build" ? "构建中…" : "烧录中…"), kind: "muted" });
        setStatus(kind === "build" ? "正在构建…" : "正在烧录…");
        api("POST", "/dsh-ide/" + kind, { project: project.path, target: targetName }).then(function (r) {
          if (r && r.ok) pollJob(r.jobId, kind);
          else { setBusy(false); setOutput({ text: ((r && r.error) || "启动失败"), kind: "err" }); setStatus("启动失败"); }
        });
      }, [project, keil, targetIndex, pollJob]);

      /**
       * Open the in-panel "add file" dialog.
       *
       * `window.prompt` is NOT implemented in Electron, so the old prompt-based
       * flow silently did nothing in the desktop app — this dialog is why the
       * plus button works at all now.
       */
      var addFileToGroup = useCallback(function (groupName) {
        if (!project) return;
        setAddDialog({ group: groupName, name: "", mode: "both" });
      }, [project]);

      /** File names implied by the dialog's mode. */
      function dialogNames(dlg) {
        var base = String((dlg && dlg.name) || "").replace(/[\\/:*?"<>|]/g, "").trim();
        if (!base) return [];
        if (/\.(c|h)$/i.test(base)) return [base];          // the user typed an extension
        if (dlg.mode === "c") return [base + ".c"];
        if (dlg.mode === "h") return [base + ".h"];
        return [base + ".c", base + ".h"];
      }

      /** Create every file the dialog implies and add each to the project group. */
      var createDialogFiles = useCallback(function () {
        var dlg = addDialog;
        if (!dlg || !project) return;
        var names = dialogNames(dlg);
        if (names.length === 0) { setStatus("请填写文件名"); return; }
        var dirAbs = project.baseDir.replace(/[\\/]+$/, "") + "\\" + dlg.group;
        setBusy(true);
        var made = 0;
        var chain = Promise.resolve();
        names.forEach(function (name) {
          chain = chain.then(function () {
            return api("POST", "/dsh-ide/project/add", {
              project: project.path,
              target: project.targets[targetIndex] ? project.targets[targetIndex].name : undefined,
              group: dlg.group,
              filePath: dirAbs + "\\" + name,
            }).then(function (r) {
              if (r && r.ok) made += 1;
              else setStatus("添加失败：" + name + " — " + ((r && r.error) || "unknown"));
            });
          });
        });
        chain.then(function () {
          setBusy(false);
          setAddDialog(null);
          var msg = names.join("、") + "（分组 " + dlg.group + "）";
          setStatus("已创建并挂进工程：" + msg);
          pushToast({ tone: "info", locked: null, title: "已创建 " + made + " 个文件", detail: msg });
          api("POST", "/dsh-ide/project", { project: project.path, cwd: sessionWorkspace.cwd || undefined })
            .then(function (r2) { if (r2 && r2.ok && r2.project) applyProject(r2.project); });
        });
      }, [addDialog, project, targetIndex, applyProject, pushToast]);

      var jumpToError = useCallback(function (it) {
        if (it.abs) openPath(it.abs);
        // Expand the group holding this file so the jump is visible in the tree.
        var t = project && project.targets ? project.targets[targetIndex] : null;
        if (t) {
          var hit = null;
          for (var i = 0; i < t.groups.length && !hit; i += 1) {
            var gfiles = t.groups[i].files || [];
            for (var j = 0; j < gfiles.length; j += 1) {
              if (gfiles[j].abs === it.abs) { hit = t.groups[i].name; break; }
            }
          }
          if (hit) {
            setExpanded(function (cur) {
              if (cur[hit]) return cur;
              var next = Object.assign({}, cur); next[hit] = true;
              saveExpanded(project.path, next);
              return next;
            });
          }
        }
        setJump({ line: it.line, seq: Date.now() });
      }, [openPath, project, targetIndex]);

      var pickDirectory = useCallback(function () {
        var uiWorkspace = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : null;
        if (!uiWorkspace || typeof uiWorkspace.pickDirectory !== "function") {
          setStatus("当前环境不支持文件夹选择窗口，请在上方输入框手动输入路径后回车");
          return;
        }
        setStatus("正在打开文件夹选择窗口…");
        uiWorkspace.pickDirectory().then(function (picked) {
          if (picked) { rootRef.current = picked; setRoot(picked); setMode("dir"); listDir(picked); }
          else setStatus("未选择文件夹");
        }).catch(function (err) {
          setStatus("打开文件夹选择窗口失败：" + ((err && err.message) || err));
        });
      }, [ctx, listDir]);

      var goRoot = useCallback(function () {
        var raw = rootRef.current;
        if (raw) { setRoot(raw); setMode("dir"); listDir(raw); }
      }, [listDir]);

      var exitIde = useCallback(function () {
        var layout = ctx && (ctx.layout || (typeof ctx.get === "function" ? ctx.get("layout") : null));
        if (layout && typeof layout.selectPanel === "function") layout.selectPanel(null);
      }, [ctx]);

      var copyReference = useCallback(function () {
        if (!file) return;
        var text = file.path + ":" + caret.line;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
          setStatus("已复制引用 " + text);
        } catch (e) { setStatus(text); }
      }, [file, caret]);

      var onEditorKey = useCallback(function (e) {
        if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { e.preventDefault(); save(); }
      }, [save]);

      var stepFont = useCallback(function (delta) {
        setFontSize(function (cur) { return Math.min(FONT_MAX, Math.max(FONT_MIN, cur + delta)); });
      }, []);

      var target = project && project.targets ? project.targets[targetIndex] : null;
      var fontStack = fontStackOf(fontId);
      var canEdit = !!file;
      var inProject = mode === "project" && !!project;
      var caretLabel = "行 " + caret.line + "，列 " + caret.col
        + (caret.selStart !== null ? "（选中 " + caret.selStart + "–" + caret.selEnd + " 行）" : "");
      var keilLabel = keil && keil.found ? ("Keil MDK" + (keil.version ? " " + keil.version : "")) : "Keil 未检测到";

      var treePane;
      if (inProject && target) {
        treePane = createElement(ProjectTree, {
          target: target,
          expanded: expanded,
          dirtyPaths: dirtyPaths,
          onToggleGroup: toggleGroup,
          onToggleGroupReadOnly: setGroupReadOnly,
          onAddFile: addFileToGroup,
          onOpenFile: function (f) { openPath(f.abs); },
        });
      } else if (choices && choices.length) {
        treePane = createElement("div", { className: "dsh-ide-tree dsh-ide-scroll" },
          createElement("div", { className: "dsh-ide-group" }, createElement("span", { className: "dsh-ide-group-name" }, "发现多个工程，选择其一")),
          choices.map(function (c) {
            return createElement("button", {
              type: "button", key: c, className: "dsh-ide-row", title: c,
              onClick: function () { openProjectPath(c); },
            }, createElement(FolderGlyph), createElement("span", null, shortPath(root, c)));
          }));
      } else if (emptyWorkspace && mode === "project") {
        // A workspace with no Keil project states that plainly, and keeps the
        // manual entry points — it never substitutes another directory.
        treePane = createElement("div", { className: "dsh-ide-tree dsh-ide-scroll" },
          createElement("div", { className: "dsh-ide-group" },
            createElement("span", { className: "dsh-ide-group-name" }, "本工作区未发现 Keil 工程")),
          createElement("div", { className: "dsh-ide-empty" }, emptyWorkspace),
          createElement("div", { className: "dsh-ide-empty" }, "用上方「打开工程」选目录，或切到「目录」手动浏览。"));
      } else {
        treePane = createElement(FileTree, {
          listing: listing, dir: dir, root: root,
          onUp: function () {
            var p = dir.replace(/[\\/]+$/, "");
            var idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
            listDir((idx > 0 ? p.slice(0, idx) : root) || root);
          },
          onOpenDir: function (name) { listDir(dir.replace(/[\\/]+$/, "") + "/" + name); },
          onOpenFile: function (name) { openPath(dir + "/" + name); },
        });
      }

      return createElement("div", { className: "dsh-ide-root" + (compact ? " dsh-ide-root-side" : "") },
        createElement("div", { className: "dsh-ide-header" },
          createElement("span", { className: "dsh-ide-brand" }, createElement(CodeGlyph, { size: 16 }), "IDE"),
          createElement("div", { className: "dsh-ide-seg" },
            createElement("button", { type: "button", className: "dsh-ide-seg-btn" + (mode === "dir" ? " dsh-ide-seg-btn-on" : ""), onClick: function () { setMode("dir"); } }, "目录"),
            createElement("button", { type: "button", className: "dsh-ide-seg-btn" + (mode === "project" ? " dsh-ide-seg-btn-on" : ""), onClick: function () { setMode("project"); } }, "工程")),
          createElement("input", {
            className: "dsh-ide-input", type: "text", value: root, title: root,
            placeholder: "路径，或直接粘贴 .uvprojx 路径回车打开工程",
            onChange: function (e) { rootRef.current = e.target.value; },
            onKeyDown: function (e) {
              if (e.key !== "Enter") return;
              var v = (rootRef.current || "").trim();
              if (/\.uvprojx$/i.test(v)) openProjectPath(v);
              else goRoot();
            },
          }),
          createElement("button", { type: "button", className: "dsh-ide-btn", onClick: pickDirectory }, "打开目录"),
          createElement("button", { type: "button", className: "dsh-ide-btn dsh-ide-btn-primary", onClick: openProject }, "打开工程"),
          createElement("button", {
            type: "button", className: "dsh-ide-btn",
            onClick: function () {
              if (inProject) api("POST", "/dsh-ide/project", { project: project.path }).then(function (r) { if (r && r.ok && r.project) applyProject(r.project); });
              else listDir(dir);
            },
          }, "刷新"),
          !compact && createElement("button", { type: "button", className: "dsh-ide-btn dsh-ide-btn-danger", onClick: exitIde }, "退出 IDE")),

        createElement("div", { className: "dsh-ide-body" },
          treePane,

          createElement("div", { className: "dsh-ide-main" },
            createElement("div", { className: "dsh-ide-toolbar" },
              createElement("span", { className: "dsh-ide-file" },
                canEdit ? basename(file.path) : (inProject ? basename(project.path) : "未打开文件"),
                dirty && createElement("span", { className: "dsh-ide-dirty" }, " •")),
              canEdit && createElement("button", {
                type: "button", disabled: busy,
                className: "dsh-ide-btn" + (dirty ? " dsh-ide-btn-primary" : ""),
                onClick: save, title: "Ctrl+S",
              }, "保存"),
              dirtyPaths.length > 1 && createElement("button", {
                type: "button", disabled: busy,
                className: "dsh-ide-btn",
                onClick: saveAll,
                title: "保存所有未保存的文件（切文件不会丢，但别忘了一起存）",
              }, "全部保存 (" + dirtyPaths.length + ")"),
              canEdit && createElement("button", {
                type: "button", disabled: busy,
                className: "dsh-ide-btn dsh-ide-lockbtn" + (file.readOnly ? " dsh-ide-lockbtn-on" : ""),
                title: file.readOnly
                  ? "当前：只读 —— 点击解锁，允许修改这个文件"
                  : "当前：可写 —— 点击设为只读，防止误改（标准库代码建议设为只读）",
                onClick: function () { setReadOnlyAt(file.path, !file.readOnly); },
              },
                createElement(file.readOnly ? LockGlyph : UnlockGlyph, { size: 12 }),
                file.readOnly ? "只读" : "可写"),
              inProject && createElement("button", { type: "button", disabled: busy, className: "dsh-ide-btn dsh-ide-btn-primary", onClick: function () { startJob("build"); } }, "编译"),
              inProject && createElement("button", { type: "button", disabled: busy, className: "dsh-ide-btn", onClick: function () { startJob("flash"); } }, "烧录"),
              !inProject && canEdit && createElement("button", { type: "button", disabled: busy, className: "dsh-ide-btn", onClick: compile }, "编译"),
              !inProject && createElement("input", {
                className: "dsh-ide-input", type: "text", value: command,
                style: { flex: "2 1 180px", minWidth: 140 },
                title: "编译命令，可用占位符 {file} {name} {dir} {out}",
                onChange: function (e) { setCommand(e.target.value); },
              }),
              createElement("div", { className: "dsh-ide-grow" }),
              inProject && target && createElement("span", {
                className: "dsh-ide-chip" + (keil && keil.found ? " dsh-ide-chip-ok" : " dsh-ide-chip-err"),
                title: keil && keil.found ? keil.uv4 : "未检测到 Keil MDK",
              }, keilLabel + " · " + target.device),
              inProject && project.targets.length > 1 && createElement("select", {
                className: "dsh-ide-select", value: String(targetIndex), title: "目标",
                onChange: function (e) { setTargetIndex(Number(e.target.value)); },
              }, project.targets.map(function (t, i) { return createElement("option", { key: i, value: String(i) }, t.name); })),
              createElement("span", { className: "dsh-ide-label" }, "字号"),
              createElement("button", {
                type: "button", className: "dsh-ide-btn dsh-ide-step", title: "减小字号",
                disabled: fontSize <= FONT_MIN, onClick: function () { stepFont(-1); },
              }, "−"),
              createElement("span", { className: "dsh-ide-num" }, fontSize),
              createElement("button", {
                type: "button", className: "dsh-ide-btn dsh-ide-step", title: "增大字号",
                disabled: fontSize >= FONT_MAX, onClick: function () { stepFont(1); },
              }, "＋"),
              createElement("span", { className: "dsh-ide-label" }, "字体"),
              createElement("select", {
                className: "dsh-ide-select", value: fontId, title: "编辑器字体",
                onChange: function (e) { setFontId(e.target.value); },
              }, FONT_OPTIONS.map(function (f) {
                return createElement("option", { key: f.id, value: f.id }, f.label);
              }))),

            canEdit
              ? createElement(CodeEditor, {
                  value: file.content,
                  readOnly: !!file.readOnly,
                  fontFamily: fontStack,
                  fontSize: fontSize,
                  caret: caret,
                  onCaret: setCaret,
                  jump: jump,
                  onKeyDown: onEditorKey,
                  onChange: function (next) {
                    setFile({ path: file.path, content: next, readOnly: file.readOnly });
                    setDirty(true);
                    // Keep the buffer so switching away and back is lossless.
                    setBuffer(file.path, next);
                  },
                })
              : createElement("div", { className: "dsh-ide-codewrap" },
                  createElement("div", { className: "dsh-ide-placeholder" },
                    inProject ? "在左侧工程树选择文件开始编辑" : "在左侧选择一个 .c / .h 文件开始编辑")),

            createElement(ErrorList, { diagnostics: diagnostics, onJump: jumpToError }),
            createElement("div", {
              className: "dsh-ide-out dsh-ide-scroll",
              style: { fontFamily: fontStack },
            }, output
              ? createElement("span", { className: "dsh-ide-out-" + output.kind }, output.text)
              : createElement("span", { className: "dsh-ide-out-muted" }, inProject ? "构建 / 烧录输出将显示在这里。" : "编译输出将显示在这里。")))),

        createElement("div", { className: "dsh-ide-status" },
          createElement("span", { className: "dsh-ide-status-text" }, status || "就绪"),
          canEdit && createElement("span", { className: "dsh-ide-caret" }, caretLabel),
          canEdit && createElement("button", {
            type: "button", className: "dsh-ide-link", onClick: copyReference,
            title: "复制「文件路径:行号」，可直接粘贴给 AI",
          }, "复制引用")),

        // In-panel "add file" dialog. Electron has no window.prompt(), so this
        // is the only way the plus button can ask for a name.
        addDialog && createElement("div", {
          className: "dsh-ide-modal",
          onClick: function () { setAddDialog(null); },
        },
          createElement("div", {
            className: "dsh-ide-modal-card",
            onClick: function (e) { e.stopPropagation(); },
          },
            createElement("div", { className: "dsh-ide-modal-title" },
              "向分组「" + addDialog.group + "」添加文件"),
            createElement("div", { className: "dsh-ide-modal-hint" },
              "只写文件名即可，扩展名按下面的选择自动补。文件会建在 ",
              createElement("code", null, addDialog.group),
              " 目录并自动挂进工程。"),
            createElement("input", {
              className: "dsh-ide-input", type: "text",
              placeholder: "例如 gpio / delay / oled",
              value: addDialog.name, autoFocus: true,
              onChange: function (e) { setAddDialog(Object.assign({}, addDialog, { name: e.target.value })); },
              onKeyDown: function (e) {
                if (e.key === "Enter") createDialogFiles();
                if (e.key === "Escape") setAddDialog(null);
              },
            }),
            createElement("div", { className: "dsh-ide-modal-row" },
              [["both", "＋ .c 和 .h"], ["c", "＋ .c"], ["h", "＋ .h"]].map(function (opt) {
                return createElement("button", {
                  type: "button", key: opt[0],
                  className: "dsh-ide-btn" + (addDialog.mode === opt[0] ? " dsh-ide-btn-primary" : ""),
                  onClick: function () { setAddDialog(Object.assign({}, addDialog, { mode: opt[0] })); },
                }, opt[1]);
              })),
            createElement("div", { className: "dsh-ide-modal-hint" },
              "将创建：",
              (dialogNames(addDialog).length
                ? dialogNames(addDialog).map(function (n) { return addDialog.group + "\\" + n; }).join("   ·   ")
                : "（先填文件名）")),
            createElement("div", { className: "dsh-ide-modal-actions" },
              createElement("button", {
                type: "button", className: "dsh-ide-btn",
                onClick: function () { setAddDialog(null); },
              }, "取消"),
              createElement("button", {
                type: "button", className: "dsh-ide-btn dsh-ide-btn-primary", disabled: busy,
                onClick: createDialogFiles,
              }, "创建")))),

        // Bottom-left transient status toasts (slide in from the left).
        toasts.length > 0 && createElement("div", { className: "dsh-ide-toasts" },
          toasts.map(function (t) {
            return createElement("div", {
              key: t.id,
              className: "dsh-ide-toast" + (t.leaving ? " dsh-ide-toast-leaving" : ""),
              role: "status", "aria-live": "polite",
            },
              createElement("span", { className: "dsh-ide-toast-mark dsh-ide-toast-mark-" + t.tone },
                t.locked === null
                  ? createElement(InfoGlyph, { size: 11 })
                  : createElement(t.locked ? LockGlyph : UnlockGlyph, { size: 11 })),
              createElement("span", { className: "dsh-ide-toast-text" },
                createElement("span", { className: "dsh-ide-toast-title" }, t.title),
                t.detail && createElement("span", { className: "dsh-ide-toast-detail" }, t.detail)))})));
    }

    /* ================================================================== *
     * Composer toggle: opens / closes the right-docked IDE                *
     * ================================================================== */
    function sidebarRightOf(ctx) {
      try { return typeof ctx.get === "function" ? ctx.get("sidebarRight") : null; } catch (e) { return null; }
    }
    function ideIsOpen(ctx) {
      var ctrl = sidebarRightOf(ctx);
      if (!ctrl) return false;
      try {
        var expanded = typeof ctrl.isExpanded === "function" ? !!ctrl.isExpanded() : false;
        var active = typeof ctrl.active === "function" ? ctrl.active() : null;
        return expanded && !!active && active.kind === TAB_KIND;
      } catch (e) { return false; }
    }

    function IdeToggleButton(props) {
      var ctx = props.ctx;
      var [on, setOn] = useState(false);

      // This cell is session-scoped: the shell hands it `sessionId` and the
      // `useWorkspaces` hook. Together they pin down this conversation's
      // workspace root — which the root-scoped IDE panel cannot discover for
      // itself — so publish it for the panel to follow.
      var useWorkspaces = props && typeof props.useWorkspaces === "function" ? props.useWorkspaces : null;
      var wsSnapshot = useWorkspaces ? useWorkspaces(function (s) { return s; }) : null;
      var sessionId = props && props.sessionId ? props.sessionId : null;
      useEffect(function () {
        publishSessionWorkspace(workspacePathForSession(wsSnapshot, sessionId), sessionId);
      }, [wsSnapshot, sessionId]);

      useEffect(function () {
        setOn(ideIsOpen(ctx));
        var timer = repeat(function () { setOn(ideIsOpen(ctx)); }, 700);
        return function () { cancelRepeat(timer); };
      }, [ctx]);

      function toggle() {
        var ctrl = sidebarRightOf(ctx);
        if (!ctrl) return;
        if (ideIsOpen(ctx)) {
          try { ctrl.toggleExpanded(); } catch (e) { /* ignore */ }
          return;
        }
        try { ctrl.openTab(TAB_KIND); } catch (e) { /* no session on screen */ }
      }

      return createElement("button", {
        type: "button",
        className: "dsh-ide-toggle" + (on ? " dsh-ide-toggle-on" : ""),
        title: on ? "关闭右侧 IDE 面板" : "在右侧打开 IDE —— 一边改代码一边对话",
        "aria-pressed": on ? "true" : "false",
        onClick: toggle,
      }, createElement(CodeGlyph, { size: 14 }), createElement("span", null, "IDE"));
    }

    /* ================================================================== *
     * Restart control (sidebar foot, beside Settings)                     *
     * ================================================================== */

    /** Restart arrows — the same shape the shell uses for a reload. */
    function RestartGlyph(props) {
      return createElement(Svg, { size: props.size },
        createElement("path", { d: "M21 12a9 9 0 1 1-2.64-6.36" }),
        createElement("polyline", { points: "21 3 21 9 15 9" }));
    }

    /**
     * What the button can honestly do depends on who owns this process, and the
     * host reports that on demand — a plain `dsh web` can respawn itself, the
     * official Desktop app cannot (its host is a child of Electron).
     */
    function loadRestartInfo() {
      return api("GET", "/dsh-ide/boot", {});
    }

    /**
     * Boot id of the host this page loaded from. The restart reply carries the
     * live one, so this is only a fallback for a reply that omits it.
     */
    var bootIdRef = { current: "" };
    function rememberBootId() {
      loadRestartInfo().then(function (info) {
        if (info && info.ok === true && info.bootId) bootIdRef.current = info.bootId;
      });
    }

    /** Explicit colours for the modal: an unreadable dialog is worse than none. */
    var TEXT = "var(--dsw-alias-label-primary,CanvasText)";
    var MUTED = "var(--dsw-alias-label-secondary,CanvasText)";
    var ERROR_TEXT = "var(--dsw-alias-state-error-primary,#ec1313)";
    var CARD = "var(--dsw-alias-bg-base,#ffffff)";
    var BTN_BORDER = "1px solid var(--dsw-alias-border-l2,currentColor)";
    var BTN_ADVANCE = "var(--dsw-alias-brand-primary,#0f1115)";
    var BTN_ADVANCE_TEXT = "var(--dsw-alias-label-primary-foreground,#ffffff)";
    var CARD_STYLE = {
      background: CARD, color: TEXT, border: BTN_BORDER,
      boxShadow: "0 18px 48px rgba(0,0,0,.35)",
    };
    var CARD_HINT = { marginTop: "8px", color: MUTED };
    var CONFIRM_BTN = {
      background: "transparent", color: TEXT, border: BTN_BORDER,
      padding: "6px 14px", fontSize: "13px", fontFamily: "inherit",
      cursor: "pointer", borderRadius: "var(--dsw-radius-sm,6px)",
    };
    var ADVANCE_BTN = {
      background: BTN_ADVANCE, color: BTN_ADVANCE_TEXT, border: "1px solid transparent",
      padding: "6px 14px", fontSize: "13px", fontFamily: "inherit", fontWeight: 600,
      cursor: "pointer", borderRadius: "var(--dsw-radius-sm,6px)",
    };

    function RestartButton() {
      var [dialog, setDialog] = useState(null); // null | "confirm" | "busy" | "embed"
      var [error, setError] = useState("");

      function send() {
        var bootId = bootIdRef.current;
        setDialog("busy");
        setError("");
        return api("POST", "/dsh-ide/restart", {}).then(function (result) {
          if (!result || result.ok !== true) {
            setError((result && result.error) || "重启请求失败");
            setDialog("embed");
            return;
          }
          // The reply carries the boot id of the host still on the port, so the
          // guard works even if this page never captured it earlier.
          if (result.mode === "web") { watchForReturn(result.bootId || bootId); return; }
          setTimeout(function () { setDialog("embed"); }, (result.timeoutMs || 2500) + 300);
        });
      }

      /**
       * Web mode: the host comes back on the same port. A successful answer is
       * the signal — this page's own host is gone while it restarts, so the next
       * one to answer is the replacement. When the boot id of this page's host
       * was captured, an answer carrying that same id means the old process is
       * still on the port, and the page waits for the id to change.
       */
      function watchForReturn(previousBootId) {
        var attempts = 0;
        var timer = repeat(function () {
          attempts += 1;
          loadRestartInfo().then(function (info) {
            if (!info || info.ok !== true) return;
            if (previousBootId && info.bootId === previousBootId) return;
            cancelRepeat(timer);
            try { window.location.reload(); } catch (e) { /* ignore */ }
          });
          if (attempts > 60) { cancelRepeat(timer); setDialog("embed"); }
        }, 1000);
      }

      function buildConfirm() {
        var overlayProps = {
          className: "dsh-ide-confirm",
          style: { background: "var(--dsw-alias-bg-mask-3,rgba(0,0,0,.48))" },
          onClick: function (event) { if (event.target === event.currentTarget) setDialog(null); },
        };
        return createElement("div", overlayProps,
          createElement("div", { className: "dsh-ide-confirm-card", style: CARD_STYLE, role: "dialog", "aria-modal": "true" },
            createElement("div", { className: "dsh-ide-confirm-title", style: { color: TEXT } }, "重启 DeepSeek Harness"),
            createElement("div", { className: "dsh-ide-confirm-body", style: { color: MUTED } },
              "宿主进程会退出，让新加载的插件生效。",
              createElement("div", { style: CARD_HINT },
                createElement("b", { style: { color: TEXT } }, "如果这是桌面应用："),
                "应用会弹出「启动失败」恢复对话框，点其中的「重启」——那一项是默认按钮，直接回车也行。插件无法自己调用 Electron 的 ",
                createElement("code", null, "app.relaunch()"),
                "，这是官方客户端唯一的重启入口。"),
              createElement("div", { style: CARD_HINT },
                createElement("b", { style: { color: TEXT } }, "如果这是 dsh web："),
                "会自动重启，页面在宿主回来后自行刷新，你不需要做任何事。")),
            createElement("div", { className: "dsh-ide-confirm-foot" },
              createElement("button", {
                type: "button", className: "dsh-ide-confirm-btn", style: CONFIRM_BTN,
                onClick: function () { setDialog(null); },
              }, "取消"),
              createElement("button", {
                type: "button", className: "dsh-ide-confirm-btn dsh-ide-confirm-go", style: ADVANCE_BTN,
                onClick: function () { send(); },
              }, "重启"))));
      }

      function buildBusy() {
        return createElement("div", { className: "dsh-ide-confirm", style: { background: "var(--dsw-alias-bg-mask-3,rgba(0,0,0,.48))" } },
          createElement("div", { className: "dsh-ide-confirm-card", style: CARD_STYLE, role: "dialog", "aria-modal": "true" },
            createElement("div", { className: "dsh-ide-confirm-title", style: { color: TEXT } }, "正在重启…"),
            createElement("div", { className: "dsh-ide-confirm-body", style: { color: MUTED } }, "宿主进程正在退出，请等待它回来。")));
      }

      function buildEmbedded() {
        return createElement("div", { className: "dsh-ide-confirm", style: { background: "var(--dsw-alias-bg-mask-3,rgba(0,0,0,.48))" } },
          createElement("div", { className: "dsh-ide-confirm-card", style: CARD_STYLE, role: "dialog", "aria-modal": "true" },
            createElement("div", { className: "dsh-ide-confirm-title", style: { color: TEXT } }, "宿主已请求退出"),
            createElement("div", { className: "dsh-ide-confirm-body", style: { color: MUTED } },
              error ? createElement("div", { style: { color: ERROR_TEXT, marginBottom: "6px" } }, error) : null,
              "桌面应用应该已经弹出恢复对话框：点「重启」（默认按钮，回车即可）就能带着新插件回来。",
              createElement("div", { style: CARD_HINT },
                "如果没看到对话框，从托盘退出应用再启动一次即可。")),
            createElement("div", { className: "dsh-ide-confirm-foot" },
              createElement("button", {
                type: "button", className: "dsh-ide-confirm-btn dsh-ide-confirm-go", style: ADVANCE_BTN,
                onClick: function () { setDialog(null); setError(""); },
              }, "知道了"))));
      }

      var busy = dialog === "busy";
      var title = busy
        ? "正在重启…"
        : "重启 DeepSeek Harness —— 让新装入的插件生效";

      return createElement("span", { style: { display: "inline-flex" } },
        createElement("button", {
          type: "button",
          className: "dsh-ide-restart" + (busy ? " dsh-ide-restart-busy" : ""),
          title: title,
          "aria-label": title,
          disabled: busy,
          onClick: function () { if (!busy) setDialog("confirm"); },
        }, createElement(RestartGlyph, { size: 16 })),
        dialog === "confirm" ? buildConfirm() : null,
        busy ? buildBusy() : null,
        dialog === "embed" ? buildEmbedded() : null);
    }

    /* ================================================================== *
     * Right-dock registration (tab type + body)                           *
     * ================================================================== */
    function installRightPanel(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return;
      ctx.slots.inject("sidebar.right.pane.tab", function () {
        var disposed = false;
        var timer = 0;
        var release = null;

        function stop() {
          disposed = true;
          if (timer) { cancelLater(timer); timer = 0; }
          if (release) { try { release(); } catch (e) { /* ignore */ } release = null; }
        }

        // The seat exists before the services do (startup race): poll briefly.
        function attempt() {
          if (disposed) return;
          var tabs = typeof ctx.get === "function" ? ctx.get("sidebarRightTabs") : null;
          var ctrl = typeof ctx.get === "function" ? ctx.get("sidebarRight") : null;
          if (!tabs || typeof tabs.register !== "function" || !ctrl) {
            timer = later(attempt, 250);
            return;
          }
          var disposeType = null;
          var disposeBody = null;
          try {
            disposeType = tabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              keepMounted: true,
              title: function () { return "IDE"; },
              guide: [{
                id: "ide",
                order: 40,
                title: function () { return "IDE"; },
                description: function () { return "查看 / 编辑 / 编译 .c 与 .h 文件"; },
              }],
            });
            disposeBody = ctx.slots.register(
              { name: "sidebar.right.pane.tab", key: TAB_ID },
              function (ownerProps) {
                return createElement(IdeView, Object.assign({}, ownerProps, { ctx: ctx, compact: true }));
              },
            );
          } catch (error) {
            try { if (disposeType) disposeType(); } catch (e) { /* ignore */ }
            try { if (disposeBody) disposeBody(); } catch (e) { /* ignore */ }
            return;
          }
          release = function () {
            try { disposeBody(); } catch (e) { /* ignore */ }
            try { disposeType(); } catch (e) { /* ignore */ }
          };
        }

        attempt();
        return stop;
      });
    }

    /* ================================================================== *
     * Plugin body                                                        *
     * ================================================================== */
    var inject = ["slots", "layout"];

    function apply(ctx) {
      ctx.effect(function () {
        ensureStyles();
        return function () {
          var el = typeof document !== "undefined" ? document.getElementById(STYLE_ID) : null;
          if (el && el.parentNode) el.parentNode.removeChild(el);
        };
      }, "dsh-ide: stylesheet");

      // Main panel (key "ide") — the full-width IDE, selected by the sidebar entry.
      ctx.slots.inject("main", function () {
        return ctx.slots.register(
          { name: "main", key: "ide" },
          function (ownerProps) {
            return createElement(IdeView, Object.assign({}, ownerProps, { ctx: ctx, compact: false }));
          },
        );
      });

      // Sidebar panel icon — enters IDE mode in the main column.
      ctx.slots.inject("sidebar.panellist", function () {
        return ctx.slots.register(
          { name: "sidebar.panellist", id: "ide", order: 50, label: "IDE" },
          function (ownerProps) { return createElement(IdeGlyph, ownerProps); },
        );
      });

      // Composer tool row — the switch for the side-by-side IDE.
      ctx.slots.inject("conversation.input.left", function () {
        return ctx.slots.register(
          { name: "conversation.input.left", id: "dsh-ide", order: 60, label: "IDE" },
          function () { return createElement(IdeToggleButton, { ctx: ctx }); },
        );
      });

      // Sidebar foot — restart the harness so freshly installed plugins load.
      rememberBootId();
      ctx.slots.inject("sidebar.footer.action", function () {
        return ctx.slots.register(
          { name: "sidebar.footer.action", id: "dsh-ide-restart", order: 90, label: "重启 DSH" },
          function (ownerProps) {
            // The 56px rail hides this foot anyway; skip the work when asked to.
            if (ownerProps && ownerProps.wide === false) return null;
            return createElement(RestartButton, null);
          },
        );
      });

      // Right dock — the IDE beside the conversation.
      installRightPanel(ctx);
    }

    exports.name = NS;
    exports.inject = inject;
    exports.apply = apply;
    // Exported for the package's own regression tests.
    exports.tokenizeC = tokenizeC;
    exports.TOKEN_COLOR = TOKEN_COLOR;
    // The session-workspace bridge is otherwise unreachable from a unit test:
    // the writing half is a session-scoped slot cell and the reading half is a
    // root-scoped one.
    exports.__bridge = {
      publish: publishSessionWorkspace,
      subscribe: subscribeSessionWorkspace,
      pathForSession: workspacePathForSession,
      state: sessionWorkspace,
    };
    return module.exports;
  },
});
