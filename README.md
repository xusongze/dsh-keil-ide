# dsh-keil-ide

**Keil MDK / STM32 IDE mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**

A side panel for browsing and editing `.c` / `.h`, plus a **`keil_project` tool** and a
**skill** that let the agent create peripheral modules (GPIO, USART, TIM, PWM, ADC, I²C, SPI,
EXTI, OLED …), wire them into a `uvprojx` project, build with UV4, and flash to the chip.

> 中文文档见 [README.zh.md](README.zh.md).

---

## Why this exists

Ask an agent to "add a GPIO init file" and you usually get a file on disk that the Keil
project never sees — so the build fails with `cannot open source input file "gpio.h"`, or UV4
tries to compile the header itself (`C4065E`). Hand-editing `.uvprojx` XML is how projects get
broken.

This plugin makes the **project itself** a first-class object. The agent adds the file *and*
its `<File>` entry, keeps the C include path correct, and can then build and flash — without
anyone touching XML.

---

## Features

### Panel (client half)

| | |
|---|---|
| **Two placements** | Full-width panel from the sidebar **IDE** entry, or a right-docked pane side-by-side with the chat (composer **IDE** toggle). |
| **Two browse modes** | *Directory* mode for any folder; *Project* mode for a `uvprojx`, with collapsible groups (`Start`, `Library`, `System`, `User`, …) and per-group file counts. |
| **Editor** | Syntax highlighting driven by DSH's Shiki tokens, line numbers, Go-to-error, adjustable font family and size (10–26 px, remembered). |
| **Read-only protection** | Files marked read-only on disk get an amber padlock badge in the tree. The editor goes read-only and saving is refused — **twice**: once in the panel, once on the host. Lock a whole standard-library group with one click on the group's padlock. |
| **Status toasts** | Bottom-left notifications that slide in from the left, for read-only changes, blocked saves and other state updates. |
| **Auto-binding** | The panel follows the **session workspace**: open it and the workspace's Keil project loads by itself. Exactly one project → load it; several → pick from a list (remembered per workspace); none → an explicit "no Keil project in this workspace" state that never falls back to some other directory. |
| **Build output** | UV4 build log with error/warning counts, `Program Size`, and a clickable error list that jumps to the line. |

### Tool (host half — what the agent sees)

`keil_project`, with these actions:

| action | What it does |
|---|---|
| `info` | Project overview: chip, debugger, targets, groups, file counts, **Include / Define**. |
| `list` | Every group and file with its `FileType`; flags entries whose type contradicts the extension. |
| `add` | Create (or write) a `.c`/`.h` **and** add it to a project group. The group is matched from the file's own directory, and created when missing. Also maintains the C include path. |
| `link` | Add an existing file to the project without writing it. |
| `remove` | The inverse of `add`: drop the project entry (the file on disk survives unless `deleteFile: true`), and drop the include path when nothing else needs it. |
| `repair` | Fix a project an older build left broken: correct every `FileType` from its extension and add every used directory to the include path. |
| `build` | UV4 `-b` (incremental). `force: true` = `-r`. |
| `rebuild` | UV4 `-r` — use this to prove a new module really compiles. |
| `clean` | UV4 `-c`. |
| `flash` | UV4 `-f`, using the debugger configured in the project (e.g. ST-Link). |

The project is resolved in this order, and every result reports where it came from
(`projectSource`):

1. an explicit `project` argument — always wins;
2. the **session workspace** (auto-discovery, depth ≤ 4, build-output folders skipped);
3. a binding remembered for that workspace;
4. a project the IDE panel opened **inside** that workspace.

If the workspace has no Keil project, the call says so instead of quietly acting on a project
from somewhere else.

### Skill

`keil-stm32-project` — a short workflow guide the agent loads on demand: when to use the tool,
how the directory→group convention works, and the pitfalls worth not rediscovering
(`.h` must be `FileType` 5; a `uvprojx` carries three `<IncludePath>` tags and only the
`Cads > VariousControls` one counts; `build` is incremental, so use `rebuild` to verify).

### Also included

- A lightweight **single-file GCC compile** for standalone C exercises (non-project mode).
- A **restart** control in the sidebar footer.

---

## Requirements

- **Windows** for the Keil tier — `UV4.exe` is Windows-only. Everything else (browsing,
  editing, read-only, the panel) works cross-platform, and the Keil actions fail with a clear
  message rather than crashing.
- **Keil MDK 5** installed. Detected via
  `HKLM\SOFTWARE\WOW6432Node\Keil\Products\MDK`, then common install paths.
- For `flash`: a debugger configured in the project (ST-Link, J-Link, …).
- **Node 20+**, and DeepSeek Harness.
- `rebuild` / `build` note: MDK-Lite's 32 KB limit affects the link step, not flashing.

---

## Install

A DSH plugin is a package inside a **profile**'s `node_modules`, declared in that profile's
`package.json` under `dsh.profile.bundles`. The profile lives at
`~/.dsh/profiles/<profile-name>` (the desktop app uses `desktop`).

### From GitHub (no npm account needed)

```bash
cd ~/.dsh/profiles/desktop
npm install github:xusongze/dsh-keil-ide
```

Pin a release if you prefer:

```bash
npm install github:xusongze/dsh-keil-ide#v1.0.0
```

Then add the package name to that profile's `dsh.profile.bundles`:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-keil-ide"
      ]
    }
  }
}
```

A name listed in `bundles` but not installed makes DSH refuse to start, so keep the two in
sync. Restart DeepSeek Harness afterwards — the client bundle is loaded at startup.

### From npm

```bash
cd ~/.dsh/profiles/desktop
npm install dsh-keil-ide
```

…then the same `dsh.profile.bundles` edit. An npm release is also what makes the plugin
appear in the **DSH plugin market**, which resolves plugins from the npm registry.

### Manual copy

```bash
git clone https://github.com/xusongze/dsh-keil-ide.git
cp -r dsh-keil-ide ~/.dsh/profiles/desktop/node_modules/dsh-keil-ide
```

…then add `"dsh-keil-ide"` to `dsh.profile.bundles` as above.

### Verify

After the restart, the sidebar shows an **IDE** entry, the composer shows an **IDE** toggle, and
the agent's tool list contains `keil_project`.

---

## Usage

### In the panel

1. Open the **IDE** entry (or the docked pane) — the panel binds to your session workspace.
2. Browse in *Directory* mode, or let it load the workspace's `uvprojx` in *Project* mode.
3. Edit, `Ctrl+S` to save, **编译 / 烧录** for the project, and the error list at the bottom
   jumps to the offending line.
4. Protect library code: expand a group and click its padlock. Every file in it becomes
   read-only and shows the badge.

### From the agent

Just describe the task:

> Give the led project a GPIO module that drives PA0, then build and flash it.

The agent calls `keil_project` — `add` for `Hardware/gpio.c` and `Hardware/gpio.h` (creating the
`Hardware` group and fixing the include path), then `build`, then `flash`.

Works best when the conversation's workspace **is** the project directory (or an ancestor of
it). Otherwise pass the `.uvprojx` path explicitly.

---

## Configuration

| Environment variable | Effect |
|---|---|
| `DSH_IDE_ALLOW_REMOTE=1` | Disable the local-only fence entirely, for a LAN or remote DSH. |
| `DSH_IDE_ALLOWED_HOSTS=a.local,b.internal` | Allow extra (loopback-proxied) `Host` names while keeping the rest of the fence. |

Other settings live in `~/.dsh/dsh-ide-project.json` (remembered workspace → project bindings)
and in the panel's own toggles (font, group collapse state, per-workspace project choice).

---

## Security

This plugin reads, writes, builds and flashes **local files**, so its HTTP routes are fenced:

1. **Loopback peer only** — a non-loopback `remoteAddress` is refused, and so is any request
   carrying `Forwarded` / `X-Forwarded-For` / `X-Real-IP`.
2. **Loopback `Host` only** — this is the fence against **DNS rebinding**, where a hostile name
   resolves to `127.0.0.1` and makes the attacker's page *same-origin* with this server. Such
   requests send no CORS preflight, so a `Content-Type` check cannot help; only the `Host` can.
3. **JSON `Content-Type` for any request with a body** — this forces a CORS preflight for the
   ordinary cross-site POST case.

`flash` and `build` spawn `UV4.exe`, which is a local program executing a local project file —
the same thing Keil itself does.

---

## Development

The plugin is a plain ESM npm package, no build step:

```
lib/index.js      host half: HTTP routes, project/tool/skill wiring
lib/project.js    uvprojx parse + targeted text edits (never a full re-serialisation)
lib/keil.js       UV4.exe detection, spawn, build-log parsing
lib/tool.js       the keil_project tool definition and executor
lib/skill.js      the workflow skill
lib/util.js       fs/exec helpers, read-only attribute
client/client.js  the whole browser half (panel, editor, tree, toasts)
```

Tests run against a real Keil project copied to a temp directory:

```bash
node test-ide-keil.mjs      # uvprojx parse/edit, include path, build-log parsing
node test-ide-tool.mjs      # tool actions, group matching, registration wiring
node test-ide-client.mjs    # client bundle, tokenizer, session-workspace bridge
node test-ide-host.mjs      # HTTP routes
node test-ide-binding.mjs   # workspace → project resolution (7 scenarios)
node test-ide-workspace.mjs # panel auto-load acceptance
node test-ide-readonly.mjs  # read-only attribute + guards
```

The tests point at `C:/Users/.../stm32project/led/Project.uvprojx` as their fixture and
normalise a copy of it; edit the `src` constant to point at your own project.

---

## License

MIT — see [LICENSE](LICENSE).
