# One shortcut table: in-app menu bar and a shortcut guide

Status: **phases 1-3 landed, phase 4 not started.** Owner: TBD. The table is [shared/shortcuts.ts](../../../apps/studio/src/shared/shortcuts.ts), the native menu is a projection over it, and the shortcut guide reads the same descriptors. What remains is the in-app menu bar for Windows/Linux.

## Problem

Shortcut definitions used to live inside the native menu template, with the chord, the label, and the action fused into each `MenuItemConstructorOptions`. That is fine while the native menu is the only consumer, and it stops being fine three ways:

1. **Windows/Linux draw their own chrome.** Those platforms already run frameless (`frame: false`, [windows/main/index.ts](../../../apps/studio/src/electron-main/windows/main/index.ts)) with a custom title bar, so we want our own menu bar in the app boundary rather than the native one. It needs the same items the native menu has, in the renderer, as data.
2. **Users can't discover shortcuts.** There was no directory, and the only in-app hint was a hardcoded `⌘+K` string in `command-menu-cta.tsx` -- exactly the kind of copy that goes stale when a chord changes.
3. **Chords already need a second consumer in main.** `bindReservedShortcuts` runs the reserved subset from `before-input-event` because Chromium eats the editing chords when a contenteditable has focus. That consumer reads the same entries, which is why the table started in the main process.

## Goal

One declaration per shortcut, read by every surface that shows or runs it:

- the native menu (macOS, and Windows/Linux until the in-app bar ships),
- an in-app menu bar drawn by us on Windows/Linux,
- a shortcut guide the user opens with `?`,
- the `before-input-event` binder for reserved chords.

### Success criteria

- Adding a shortcut means adding one entry. No second edit to make it appear in a menu, the guide, or the reserved path.
- The in-app menu bar on Windows/Linux offers the same items and chords as the native menu, and firing one runs the identical action.
- `?` with no editable focused opens a grouped, searchable list of every shortcut, with chords rendered per platform.
- Typing `?` into the prompt editor inserts a question mark and does not open the guide.
- Changing a chord in the table updates the menu, the bar, and the guide together.

## Current building blocks (reuse, don't rebuild)

- **The table**: `ShortcutDescriptor` = `{ accelerator, group, label, owner, reserved }` in [shared/shortcuts.ts](../../../apps/studio/src/shared/shortcuts.ts), keyed by id, with `SHORTCUT_ENTRIES` for consumers that walk it and `resolveAccelerator()` for the entries whose chord differs by platform.
- **The main-side actions**: `SHORTCUT_ACTIONS` (a `Record<ShortcutId, null | ShortcutAction>`, so a new descriptor forces a decision), `shortcutMenuItem(id)` to project one into a menu item, and `bindReservedShortcuts()` to run the reserved ones early ([menus/shortcuts.ts](../../../apps/studio/src/electron-main/menus/shortcuts.ts)).
- **The display formatter**: `formatAccelerator()` splits an accelerator into per-`Kbd` tokens for this platform ([format-accelerator.ts](../../../apps/studio/src/client/lib/format-accelerator.ts)).
- **Menu rebuild plumbing**: `createApplicationMenu()` re-runs `Menu.buildFromTemplate` on window focus/blur, `window.focus-changed`, and `preferences.updated` ([menus/index.ts](../../../apps/studio/src/electron-main/menus/index.ts)), so a table-driven template stays live without new invalidation.
- **Command transport**: menu actions call `sendAppCommand` ([app-command.ts](../../../apps/studio/src/electron-main/app-command.ts)), streamed to the renderer and applied by `useAppCommands`, which already gates on `MODAL_SAFE_COMMANDS` and `blockingModalCountAtom` ([use-app-commands.ts](../../../apps/studio/src/client/hooks/use-app-commands.ts)). An in-app menu bar can dispatch the same `AppCommand` union directly instead of routing through main.
- **UI primitives on hand**: `ui/menubar.tsx` (Radix Menubar, currently only used by [dev-panel.tsx](../../../apps/studio/src/client/components/dev-panel.tsx)) and `ui/kbd.tsx` for rendering chords.
- **Where the bar mounts**: [studio-toolbar.tsx:95](../../../apps/studio/src/client/components/studio-toolbar.tsx#L95) is the custom title bar row, and `WindowControls` already self-gates on `isWindows() || isLinux() || (isMacOS() && forceShow)` ([window-controls.tsx:16](../../../apps/studio/src/client/components/window-controls.tsx#L16)) with a debug-panel override to force it on macOS. The menu bar wants the same gate and the same override so it stays testable on a Mac.

## Design decisions

- **The table lives in shared code, not main.** The renderer needs `label` and `accelerator` to draw both the bar and the guide, so definitions live in `src/shared`. `run` cannot cross that boundary: main-side entries close over `sendAppCommand`/window controls, and renderer-side entries dispatch locally. Each entry is a serializable descriptor plus a per-process action map keyed by id.
- **`owner` says who binds the chord.** `menu` (the projected menu item), `renderer` (a keydown, for chords the menu can't own), or `external` (an Electron role, or a hidden accelerator-only item the template still writes by hand: numpad zoom, `Cmd+=`, `Cmd+1..8`). Every entry is listed in the guide regardless; only `menu` entries get an accelerator on their menu item.
- **`AppCommand` is the action vocabulary.** Most items already resolve to one (`toggleSidebar`, `navigate`, `selectByIndex`...). Entries whose action is main-only (`reload`, `goBack`, zoom, `Close Tab`'s focused-window branch) keep a main-side handler and are dispatched over RPC when the in-app bar fires them.
- **Roles stay roles.** Undo/Redo/Cut/Copy/Paste/Select All are `role:` items Chromium implements against the focused editable. The in-app bar must invoke them through `webContents` role equivalents rather than re-implementing editing. They are out of the table until the bar needs to draw them: their chords diverge by platform in ways the Edit role already handles (Windows redo is `Ctrl+Y`), so listing them would mean asserting a chord we don't own.
- **Accelerator strings stay Electron-shaped** (`CmdOrCtrl+Shift+T`), with one formatter for display (`⌘⇧T` vs `Ctrl+Shift+T`) and one matcher for raw key events. `matchesAccelerator` understands only `CmdOrCtrl+<key>` and refuses everything else; it needs to grow `Shift`, `Alt`, `Tab`, and the numpad/`Plus` forms the Window menu uses before those entries can be reserved.
- **The guide's `?` is not a menu accelerator.** It has no modifier, is layout-dependent (Shift+/ on US), and must yield to any editable. It is a renderer keydown gated on the active element, not a reserved chord. The Help menu item is the modifier-free way in, and carries no accelerator.
- **`?` yields to every modal.** It is cheap to press by accident, so the handler no-ops while `blockingModalCountAtom > 0` rather than replacing whatever the user is mid-way through. `studioModalAtom`'s `replaceable: false` is the backstop for the paths that don't go through the key (the Help menu item, `openShortcutGuide`).

## Implementation phases

### Phase 1 - Grow the table in place (done)

Menu construction is a projection over the table: `shortcutMenuItem(id)` for every item that has a chord, in `main-window.ts` and `utils.ts` alike. The hidden accelerator-only items (numpad zoom, `Cmd+=`, `Cmd+1..8`, the `Cmd+Shift+[`/`]` duplicates) stay hand-written in the template and are represented in the table as one `external` entry each, so the guide shows one Zoom In row rather than four.

### Phase 2 - Cross the process boundary (done)

Descriptors are a static shared import; actions are a main-side `Record<ShortcutId, null | ShortcutAction>`. Developer-only entries are gated in the renderer by `useDeveloperMode()`, not by dynamic descriptors, so no RPC read is needed.

### Phase 3 - Shortcut guide (done)

[shortcut-guide-modal.tsx](../../../apps/studio/src/client/components/studio-modals/shortcut-guide-modal.tsx): an app-wide modal, grouped and searchable through the same uFuzzy + `FuzzyHighlight` pairing the command menu and skill search use ([shortcut-search.ts](../../../apps/studio/src/client/lib/shortcut-search.ts)), with chords rendered per platform into `Kbd` caps. Opened by `?` ([use-shortcut-guide-hotkey.ts](../../../apps/studio/src/client/hooks/use-shortcut-guide-hotkey.ts)), by Help > Keyboard Shortcuts, or by the `openShortcutGuide` app command.

### Phase 4 - In-app menu bar

Render the same descriptors as a Radix `Menubar` in the custom title bar, gated like `WindowControls` (Windows/Linux, plus a debug override on macOS). Firing an item dispatches its `AppCommand` in the renderer or calls the main-side handler over RPC. Then decide whether `Menu.setApplicationMenu` still runs on those platforms: keeping it preserves the accelerators, so the likely answer is to keep the native menu registered but hidden, or move every chord into the reserved binder and drop it.

## Open questions

- Does dropping the native menu on Windows/Linux cost us accelerators that only `Menu` delivers, or does `before-input-event` cover every chord? This decides whether phase 4 ends with two menu systems or one.
- Should the command menu (`Cmd+K`) read the same table so actions there show their chords?
- The Edit roles are the one gap in the guide. Listing them needs a per-platform chord for redo; worth it, or is the Edit menu enough?

Settled by the guide, and worth revisiting only if the menu bar disagrees:

- **The hidden duplicates are omitted**, not shown as alternates: they exist so a chord works, not so a user learns four ways to zoom in.
- **`group` is the guide's own taxonomy** (General / Tabs / Navigation / View / Developer), not the native menu's structure -- "New Tab" and "Show Next Tab" belong together however the menus split them. Menu placement stays the template's business. Rows sort by label inside a group, since key order in the table is lint's opinion rather than an author's.
