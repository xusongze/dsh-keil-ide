# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-10-16

### Added

- **Add-file dialog.** Clicking a group's `+` opens an in-panel dialog: type a name, choose
  `.c` and `.h`, `.c` only, or `.h` only, and the files are created in the group's directory
  and registered in the project with the right `FileType` and include path. The previous flow
  relied on `window.prompt`, which **Electron does not implement** — so the plus button
  silently did nothing in the desktop app.
- **Unsaved edits survive a file switch.** Every modified file keeps its buffer in memory;
  reopening it restores that buffer instead of the on-disk copy, and a dot marks it in the
  project tree.
- **Save all.** A `全部保存 (N)` button appears in the toolbar once more than one file has
  unsaved changes, and writes them in one pass.

### Changed

- `/dsh-ide/project/add` accepts the new file's `content`, reports whether it created the
  file, and **never overwrites an existing one**; a new file without content gets a real
  skeleton (include guard for `.h`, `#include` for `.c`) instead of `/* TODO */`.
- Panel modals (the add-file dialog) use the panel's own frosted card and DSH radius tokens
  rather than a browser dialog.

## [1.0.0] — 2026-10-16

First public release.

### Added

- **Panel** — a full-width IDE panel from the sidebar, and a right-docked pane beside the
  chat. Directory browsing plus `uvprojx` project mode with collapsible groups and file
  counts.
- **Editor** — Shiki-token syntax highlighting, line numbers, jump-to-error, adjustable font
  family and size.
- **Read-only protection** — the on-disk read-only attribute drives an amber padlock badge in
  the file tree, a read-only editor, and a save that is refused by both the panel and the
  host. A whole group can be protected with one click on its padlock.
- **Status toasts** — bottom-left notifications that slide in from the left.
- **Session-workspace binding** — the panel and the tool both resolve the Keil project from the
  conversation's own workspace instead of a global "last opened" value.
- **`keil_project` tool** — `info`, `list`, `add`, `link`, `remove`, `repair`, `build`,
  `rebuild`, `clean`, `flash`. `add` writes the file *and* its `<File>` entry, matches or
  creates the group from the file's directory, and maintains the C include path.
- **`keil-stm32-project` skill** — an on-demand workflow guide for the agent.
- **Single-file GCC compile** for standalone C exercises.
- **Restart control** in the sidebar footer.

### Fixed

- `.h` entries are written with `FileType` **5**. Writing 8 made UV4 try to compile the header
  and fail with `C4065E: type of input file '…h' unknown`. `.cpp` is 8.
- The C include path is read from — and written to — the one `<IncludePath>` that matters
  (`TargetArmAds > Cads > VariousControls`), not the empty one under `<TargetOption>`.
- Tool results are lossless JSON: `undefined` values (an absent compiler column) are omitted
  instead of failing the result validator.
- `add` reports its three outcomes honestly (`contentWritten` / `entryExisted`) and self-heals
  an entry whose `FileType` contradicts its extension.
- `repair` reports what it changed and what it checked, not just two counters.
- `remove` prunes the include path entry once nothing references that directory.

### Security

- Every HTTP route is fenced to a direct loopback request: the peer address must be loopback,
  no forwarding header may be present, and the `Host` must be a loopback name. The `Host`
  check is what stops DNS rebinding, where a hostile name resolves to `127.0.0.1` and makes the
  attacker's page same-origin — a case no CORS preflight protects.
- A request carrying a body must be `application/json`, which forces a preflight for the
  ordinary cross-site POST case.
- `DSH_IDE_ALLOW_REMOTE=1` and `DSH_IDE_ALLOWED_HOSTS` opt out for intentional setups.

[1.0.0]: https://github.com/xusongze/dsh-keil-ide/releases/tag/v1.0.0
