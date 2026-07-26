# One shortcut table: in-app menu bar and a shortcut guide

Status: **not started.** Owner: TBD. The seed exists: [shortcuts.ts](../../../apps/studio/src/electron-main/menus/shortcuts.ts) declares one shortcut (`toggleSidebar`) as data and the native menu builds its item from it via `shortcutMenuItem`. Everything below is about growing that from one entry into the table three surfaces read.

## Problem

Shortcut definitions live inside the native menu template. [main-window.ts](../../../apps/studio/src/electron-main/menus/main-window.ts) is ~250 lines of `MenuItemConstructorOptions` where the chord, the label, and the action are fused into each item, and [utils.ts](../../../apps/studio/src/electron-main/menus/utils.ts) holds the app/edit/help/devtools menus the same way. That is fine while the native menu is the only consumer, and it stops being fine three ways:

1. **Windows/Linux draw their own chrome.** Those platforms already run frameless (`frame: false`, [windows/main/index.ts](../../../apps/studio/src/electron-main/windows/main/index.ts)) with a custom title bar, so we want our own menu bar in the app boundary rather than the native one. It needs the same items the native menu has, in the renderer, as data.
2. **Users can't discover shortcuts.** There's no directory. The only in-app hint is a single hardcoded string in [command-menu-cta.tsx:7](../../../apps/studio/src/client/components/command-menu-cta.tsx#L7) that spells out `⌘+K` by hand -- exactly the kind of copy that goes stale when a chord changes.
3. **Chords already need a second consumer in main.** `bindReservedShortcuts` runs the reserved subset from `before-input-event` because Chromium eats the editing chords when a contenteditable has focus. That consumer reads the same entries, which is why the table starts in the main process.

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

- **The seed table**: `Shortcut` = `{ accelerator, label, reserved, run }`, plus `shortcutMenuItem()` to project one into a menu item and `bindReservedShortcuts()` to run the reserved ones early ([shortcuts.ts](../../../apps/studio/src/electron-main/menus/shortcuts.ts)).
- **Menu rebuild plumbing**: `createApplicationMenu()` re-runs `Menu.buildFromTemplate` on window focus/blur, `window.focus-changed`, and `preferences.updated` ([menus/index.ts](../../../apps/studio/src/electron-main/menus/index.ts)), so a table-driven template stays live without new invalidation.
- **Command transport**: menu actions call `sendAppCommand` ([app-command.ts](../../../apps/studio/src/electron-main/app-command.ts)), streamed to the renderer and applied by `useAppCommands`, which already gates on `MODAL_SAFE_COMMANDS` and `blockingModalCountAtom` ([use-app-commands.ts](../../../apps/studio/src/client/hooks/use-app-commands.ts)). An in-app menu bar can dispatch the same `AppCommand` union directly instead of routing through main.
- **UI primitives on hand**: `ui/menubar.tsx` (Radix Menubar, currently only used by [dev-panel.tsx](../../../apps/studio/src/client/components/dev-panel.tsx)) and `ui/kbd.tsx` for rendering chords.
- **Where the bar mounts**: [studio-toolbar.tsx:95](../../../apps/studio/src/client/components/studio-toolbar.tsx#L95) is the custom title bar row, and `WindowControls` already self-gates on `isWindows() || isLinux() || (isMacOS() && forceShow)` ([window-controls.tsx:16](../../../apps/studio/src/client/components/window-controls.tsx#L16)) with a debug-panel override to force it on macOS. The menu bar wants the same gate and the same override so it stays testable on a Mac.

## Design decisions

- **The table lives in shared code, not main.** The renderer needs `label` and `accelerator` to draw both the bar and the guide, so definitions move to `src/shared`. `run` cannot cross that boundary: main-side entries close over `sendAppCommand`/window controls, and renderer-side entries dispatch locally. Split each entry into a serializable descriptor (`id`, `label`, `accelerator`, `group`, `reserved`) plus a per-process action map keyed by `id`.
- **`AppCommand` is the action vocabulary.** Most items already resolve to one (`toggleSidebar`, `navigate`, `selectByIndex`...). Entries whose action is main-only (`reload`, `goBack`, zoom, `Close Tab`'s focused-window branch) keep a main-side handler and are dispatched over RPC when the in-app bar fires them.
- **Roles stay roles.** Undo/Redo/Cut/Copy/Paste/Select All are `role:` items Chromium implements against the focused editable. They belong in the table for display only -- never `reserved`, and the in-app bar must invoke them through `webContents` role equivalents rather than re-implementing editing.
- **Accelerator strings stay Electron-shaped** (`CmdOrCtrl+Shift+T`), with one formatter for display (`⌘⇧T` vs `Ctrl+Shift+T`) and one matcher for raw key events. `matchesAccelerator` currently understands only `CmdOrCtrl+<key>` and refuses everything else; it needs to grow `Shift`, `Alt`, `Tab`, and the numpad/`Plus` forms the Window menu uses before those entries can be reserved.
- **The guide's `?` is not a menu accelerator.** It has no modifier, is layout-dependent (Shift+/ on US), and must yield to any editable. It belongs in the renderer as a keydown handler gated on the active element, not in the reserved set.

## Implementation phases

### Phase 1 - Grow the table in place

Move the remaining `main-window.ts` and `utils.ts` items into `SHORTCUTS` entry by entry, each with a `group` (File / View / Window / Edit / Help) so a menu and a guide can both order them. Menu construction becomes a projection over the table. Keep the hidden-accelerator items (numpad zoom, `CmdOrCtrl+1..8`, the `visible: false` duplicates) as entries flagged out of display -- the guide should not list four Zoom In rows.

### Phase 2 - Cross the process boundary

Split descriptors (shared, serializable) from actions (per-process). Expose the descriptor list to the renderer -- as a static import if the table is fully static, or an RPC read if `isDeveloperMode()`-style gating makes it dynamic. Verify the native menu still builds identically from the split table before anything consumes it.

### Phase 3 - Shortcut guide

A modal listing descriptors grouped by `group`, chords rendered through the platform formatter and `Kbd`. Register it as an app-wide modal per the `atoms/<name>-modal.ts` + `<StudioModals />` pattern in [apps/studio/CLAUDE.md](../../../apps/studio/CLAUDE.md), and open it from a renderer keydown on `?` that no-ops when the event target is editable. Retire the hardcoded `⌘+K` string in `command-menu-cta.tsx` in favor of the formatter.

### Phase 4 - In-app menu bar

Render the same descriptors as a Radix `Menubar` in the custom title bar, gated like `WindowControls` (Windows/Linux, plus a debug override on macOS). Firing an item dispatches its `AppCommand` in the renderer or calls the main-side handler over RPC. Then decide whether `Menu.setApplicationMenu` still runs on those platforms: keeping it preserves the accelerators, so the likely answer is to keep the native menu registered but hidden, or move every chord into the reserved binder and drop it.

## Open questions

- Does dropping the native menu on Windows/Linux cost us accelerators that only `Menu` delivers, or does `before-input-event` cover every chord? This decides whether phase 4 ends with two menu systems or one.
- Should the guide list the hidden duplicates (numpad zoom, `Cmd+=`) as alternates on one row, or omit them?
- Is `group` enough for guide ordering, or does the guide want its own sections (a "Tabs" section that spans File and Window menu items)?
- Should the command menu (`Cmd+K`) read the same table so actions there show their chords?
