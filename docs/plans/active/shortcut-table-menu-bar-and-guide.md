# One shortcut table: in-app menu bar and a shortcut guide

Status: **phases 1-3 landed, phase 4 not started.** Owner: TBD. The table is [shared/shortcuts.ts](../../../apps/studio/src/shared/shortcuts.ts), the native menu is a projection over it, and the shortcut guide reads the same descriptors. What remains is the in-app menu bar for Windows/Linux.

## Problem

Shortcut definitions used to live inside the native menu template, with the chord, the label, and the action fused into each `MenuItemConstructorOptions`. That is fine while the native menu is the only consumer, and it stops being fine three ways:

1. **Windows/Linux draw their own chrome.** Those platforms already run frameless (`frame: false`, [windows/main/index.ts](../../../apps/studio/src/electron-main/windows/main/index.ts)) with a custom title bar, so we want our own menu bar in the app boundary rather than the native one. It needs the same items the native menu has, in the renderer, as data.
2. **Users can't discover shortcuts.** There was no directory, and the only in-app hint was a hardcoded `⌘+K` string in `command-menu-cta.tsx` -- exactly the kind of copy that goes stale when a chord changes.
3. **Chords already need a second consumer in main.** A menu accelerator is a fallback rather than a binding: Electron offers the native menu only the key events web content left unhandled, so `bindShortcutAccelerators` runs the app's own chords from `before-input-event` instead. That consumer reads the same entries, which is why the table started in the main process.

## Goal

One declaration per shortcut, read by every surface that shows or runs it:

- the native menu (macOS, and Windows/Linux until the in-app bar ships),
- an in-app menu bar drawn by us on Windows/Linux,
- a shortcut guide the user opens with `?`,
- the `before-input-event` binder that runs the app's own chords ahead of the page.

### Success criteria

- Adding a shortcut means adding one entry. No second edit to make it appear in a menu, the guide, or the binder.
- The in-app menu bar on Windows/Linux offers the same items and chords as the native menu, and firing one runs the identical action.
- `?` with no editable focused opens a grouped, searchable list of every shortcut, with chords rendered per platform.
- Typing `?` into the prompt editor inserts a question mark and does not open the guide.
- Changing a chord in the table updates the menu, the bar, and the guide together.

## Current building blocks (reuse, don't rebuild)

- **The table**: `ShortcutDescriptor` = `{ accelerator, alternates, group, label, owner }` in [shared/shortcuts.ts](../../../apps/studio/src/shared/shortcuts.ts), keyed by id, with `SHORTCUT_ENTRIES` for consumers that walk it and `resolveAccelerator()` for the entries whose chord differs by platform.
- **The main-side actions**: `SHORTCUT_ACTIONS` (a `Record<ShortcutId, null | ShortcutAction>`, so a new descriptor forces a decision), `shortcutMenuItem(id)` to project one into a menu item, and `bindShortcutAccelerators()` to run every menu-owned chord ahead of the page ([menus/shortcuts.ts](../../../apps/studio/src/electron-main/menus/shortcuts.ts)).
- **The display formatter**: `formatAccelerator()` splits an accelerator into per-`Kbd` tokens for this platform ([format-accelerator.ts](../../../apps/studio/src/client/lib/format-accelerator.ts)).
- **Menu rebuild plumbing**: `createApplicationMenu()` re-runs `Menu.buildFromTemplate` on window focus/blur, `window.focus-changed`, and `preferences.updated` ([menus/index.ts](../../../apps/studio/src/electron-main/menus/index.ts)), so a table-driven template stays live without new invalidation.
- **Command transport**: menu actions call `sendAppCommand` ([app-command.ts](../../../apps/studio/src/electron-main/app-command.ts)), streamed to the renderer and applied by `useAppCommands`, which already gates on `MODAL_SAFE_COMMANDS` and `blockingModalCountAtom` ([use-app-commands.ts](../../../apps/studio/src/client/hooks/use-app-commands.ts)). An in-app menu bar can dispatch the same `AppCommand` union directly instead of routing through main.
- **UI primitives on hand**: `ui/menubar.tsx` (Radix Menubar, currently only used by [dev-panel.tsx](../../../apps/studio/src/client/components/dev-panel.tsx)) and `ui/kbd.tsx` for rendering chords.
- **Where the bar mounts**: [studio-toolbar.tsx:95](../../../apps/studio/src/client/components/studio-toolbar.tsx#L95) is the custom title bar row, and `WindowControls` already self-gates on `isWindows() || isLinux() || (isMacOS() && forceShow)` ([window-controls.tsx:16](../../../apps/studio/src/client/components/window-controls.tsx#L16)) with a debug-panel override to force it on macOS. The menu bar wants the same gate and the same override so it stays testable on a Mac.

## Design decisions

- **The table lives in shared code, not main.** The renderer needs `label` and `accelerator` to draw both the bar and the guide, so definitions live in `src/shared`. `run` cannot cross that boundary: main-side entries close over `sendAppCommand`/window controls, and renderer-side entries dispatch locally. Each entry is a serializable descriptor plus a per-process action map keyed by id.
- **`owner` says how the chord reaches the menu.** `menu` (the app owns it and the menu draws a row for it), `renderer` (a keydown, for chords the menu can't own, and the only kind the main-process binder leaves alone), or `external` (the app owns the chord but the menu draws no row: an Electron role, or a chord standing for a range like `Cmd+1..8`). Every entry is listed in the guide regardless; only `menu` entries get an accelerator on their menu item.
- **`alternates` carries the chords nothing shows.** The other physical keys that mean one chord (`Cmd+=` and numpad `+` for `Cmd+Plus`) and the per-key chords behind a range live on the entry they belong to, so the binder can run them and `hiddenShortcutItems(id)` can project them as accelerator-only menu items. They stay out of the guide, which shows one Zoom In row rather than three.
- **`AppCommand` is the action vocabulary.** Most items already resolve to one (`toggleSidebar`, `navigate`, `selectByIndex`...). Entries whose action is main-only (`reload`, `goBack`, zoom, `Close Tab`'s focused-window branch) keep a main-side handler and are dispatched over RPC when the in-app bar fires them.
- **Roles stay roles.** Undo/Redo/Cut/Copy/Paste/Select All are `role:` items Chromium implements against the focused editable. The in-app bar must invoke them through `webContents` role equivalents rather than re-implementing editing. They are out of the table until the bar needs to draw them: their chords diverge by platform in ways the Edit role already handles (Windows redo is `Ctrl+Y`), so listing them would mean asserting a chord we don't own.
- **Accelerator strings stay Electron-shaped** (`CmdOrCtrl+Shift+T`), with one formatter for display (`⌘⇧T` vs `Ctrl+Shift+T`) and one matcher for raw key events ([match-accelerator.ts](../../../apps/studio/src/electron-main/menus/match-accelerator.ts)). The matcher reads any modifier set and decides a character key on `key`, the character the layout typed, because that is what the native menu decides on as well -- an accelerator becomes a Cocoa key equivalent matched against what the key types, and a layout-mapped VKEY elsewhere. Matching the physical `code` instead reads as equivalent on QWERTY and lands the app's chords on top of the user's editing keys everywhere else: on AZERTY, Cmd+Z arrives at the position QWERTY calls W. `code` is kept only for keys no character can decide -- the numpad, whose `+` is the same character as a shifted `=`, and the named keys. An accelerator outside the vocabulary parses to `null` and matches nothing, and a table entry that lands there fails the suite.
- **The guide's `?` is not a menu accelerator.** It has no modifier, is layout-dependent (Shift+/ on US), and must yield to any editable. It is a renderer keydown gated on the active element, not a main-process chord. The Help menu item is the modifier-free way in, and carries no accelerator.
- **`?` yields to every modal.** It is cheap to press by accident, so the handler no-ops while `blockingModalCountAtom > 0` rather than replacing whatever the user is mid-way through. `studioModalAtom`'s `replaceable: false` is the backstop for the paths that don't go through the key (the Help menu item, `openShortcutGuide`).

## Implementation phases

### Phase 1 - Grow the table in place (done)

Menu construction is a projection over the table: `shortcutMenuItem(id)` for every item that has a chord, in `main-window.ts` and `utils.ts` alike, and `hiddenShortcutItems(id)` for the accelerator-only ones (numpad zoom, `Cmd+=`, `Cmd+1..8`, the `Cmd+Shift+[`/`]` duplicates), which are `alternates` on the entry they belong to rather than hand-written rows.

### Phase 2 - Cross the process boundary (done)

Descriptors are a static shared import; actions are a main-side `Record<ShortcutId, null | ShortcutAction>`. Developer-only entries are gated in the renderer by `useDeveloperMode()`, not by dynamic descriptors, so no RPC read is needed.

### Phase 3 - Shortcut guide (done)

[shortcut-guide-modal.tsx](../../../apps/studio/src/client/components/studio-modals/shortcut-guide-modal.tsx): an app-wide modal, grouped and searchable through the same uFuzzy + `FuzzyHighlight` pairing the command menu and skill search use ([shortcut-search.ts](../../../apps/studio/src/client/lib/shortcut-search.ts)), with chords rendered per platform into `Kbd` caps. Opened by `?` ([use-shortcut-guide-hotkey.ts](../../../apps/studio/src/client/hooks/use-shortcut-guide-hotkey.ts)), by Help > Keyboard Shortcuts, or by the `openShortcutGuide` app command.

### Phase 4 - In-app menu bar

Render the same descriptors as a Radix `Menubar` in the custom title bar, gated like `WindowControls` (Windows/Linux, plus a debug override on macOS). Firing an item dispatches its `AppCommand` in the renderer or calls the main-side handler over RPC. Then decide whether `Menu.setApplicationMenu` still runs on those platforms: the binder already owns every menu chord, so the native menu is now only the visible surface plus the fallback for a focused browser guest.

## Open questions

- Does dropping the native menu on Windows/Linux cost us accelerators that only `Menu` delivers, or does `before-input-event` cover every chord? This decides whether phase 4 ends with two menu systems or one.
- Should the command menu (`Cmd+K`) read the same table so actions there show their chords?
- The Edit roles are the one gap in the guide. Listing them needs a per-platform chord for redo; worth it, or is the Edit menu enough?

Settled by the guide, and worth revisiting only if the menu bar disagrees:

- **`alternates` are omitted from the guide**, not shown beside the chord they stand in for: they exist so a key works, not so a user learns three ways to zoom in.
- **`group` is the guide's own taxonomy** (General / Tabs / Navigation / View / Developer), not the native menu's structure -- "New Tab" and "Show Next Tab" belong together however the menus split them. Menu placement stays the template's business. Rows sort by label inside a group, since key order in the table is lint's opinion rather than an author's.
