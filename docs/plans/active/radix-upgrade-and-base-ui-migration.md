# Radix upgrade, and whether to move to Base UI

Status: proposal / not started. Phase 0 stands alone and is worth doing on its own. Phases 1+ are optional and should only start when `components/ui/` is otherwise quiet, because every step rewrites shared wrappers that large UI work touches.

## The question

Studio's primitives are Radix, pinned about a year behind upstream. Base UI (from the people who built Radix) reached 1.0 in December 2025, and shadcn made it the default base in July 2026. Two separate decisions hide behind "should we switch": whether to take a year of Radix bug fixes (cheap, clearly yes), and whether to change primitive libraries (expensive, not yet).

## Where the two libraries stand

Verified July 2026. Version claims here go stale fast; re-check before acting on them.

**Base UI** is stable and moving fast. 1.0 on 2025-12-11, 1.6.0 on 2026-06-18, roughly monthly minors, about 410 commits in 90 days, ~7.7M weekly downloads. The package is `@base-ui/react` (renamed from `@base-ui-components/react` at 1.0). Peers React 17/18/19; runtime deps are floating-ui plus the babel runtime.

**Radix is maintained, not dead.** Publishes continued through 2026-07 (`@radix-ui/react-dialog` 1.1.23, `select` 2.3.7, `tooltip` 1.2.16, unified `radix-ui` 1.6.7), about 173 commits in 90 days. It ships bug fixes, tree-shaking, and occasional new parts, but no new component families.

**shadcn supports both.** Base UI is the default for new projects; Radix stays supported via `shadcn init -b radix`, and every component ships for both bases. Upstream's own statement is that they are not migrating their production app and that switching component libraries is the worst thing to do to a working product. A migration skill exists (`npx skills add shadcn/ui`, then ask an agent to migrate one component at a time); it carries the full rename/prop/behavior mapping and works progressively with both libraries installed.

## Our exposure

- 22 individual `@radix-ui/react-*` packages in [apps/studio/package.json](../../../apps/studio/package.json), 45 wrappers in [apps/studio/src/client/components/ui/](../../../apps/studio/src/client/components/ui/), 28 files importing Radix directly.
- 126 `asChild` occurrences across 68 files.
- 154 `data-[state=…]` class selectors across 30 files, plus keyframe `animate-in`/`animate-out` from tw-animate-css.
- 8 sites reading `--radix-*` sizing vars, all of them dividing by `--content-zoom`.
- 6 sites using `onOpenAutoFocus` / `onCloseAutoFocus` / `onFocusOutside` / `onInteractOutside` with `preventDefault`.
- One non-modal overlay over the browser view ([browser-panel.tsx](../../../apps/studio/src/client/components/task/browser-panel.tsx)).

Not affected either way: sonner, react-resizable-panels. cmdk is affected indirectly: it depends on Radix internally and has not released since March 2025, so Radix stays installed until the command palette moves too.

Our wrappers are heavily customized. Most diverge from the stock shadcn originals by roughly their own file length, so any golden-pair three-way merge conflicts as the rule, not the exception. The largest are sidebar (568 lines), menubar (301), context-menu (273), dropdown-menu (278), command (215), select (200).

## Phase 0: take the Radix fixes (independent of any migration)

We are on roughly August 2025 versions: dialog 1.1.15, select 2.2.6, dropdown-menu 2.1.16, popover 1.1.15, tooltip 1.2.8, context-menu 2.2.16. The intervening fixes map directly onto this app's problem areas:

- menus not closing when the window loses focus, which is an Electron-shaped bug
- nested modal/non-modal layer bugs, pointer-events with overlapping layers, dismissable layer intercepting outside interactions
- React 19 infinite re-render caused by unstable composed ref identities
- dialog: `stopPropagation` on the overlay blocking dismissal; broken ARIA references when title or description are absent; dev-only title/description warnings removed
- select: typeahead focusing a removed element, empty-string item as a clear option, presence-based exit animations, placeholder reset on controlled resets
- tooltip: content mounting twice, `skipDelayDuration={0}` not actually skipping
- `/* @__PURE__ */` annotations so unused parts tree-shake

Steps:

1. Bump all 22 packages to current, or consolidate onto the single `radix-ui` package (1.6.7), which is what shadcn's Radix registry now uses and which removes cross-package version skew. We currently resolve two copies of `react-slot`.
2. Pin exact versions and read the changelogs for the newest patch: 1.1.23 and 2.3.7 are "reverted breaking changes that caused compatibility issues with React Server Components", so that line has recent churn.
3. QA overlays by hand: dialogs stacked over dialogs, menus over the browser view, select typeahead, tooltip delays, context menus in the file grid, all at more than one UI zoom level.

## Phase 1: spike one zoom-sensitive overlay on Base UI

Do not start a migration without this. It is the piece no upstream migration knowledge covers.

Pick select or dropdown-menu, build it on Base UI beside the existing wrapper, and exercise it at several UI zoom levels with the browser panel open. The question to answer is how the zoom compensation in [responsive-layout.md](../architecture/responsive-layout.md) re-expresses itself when positioning moves onto a separate Positioner node and the vars are renamed. Nothing about this typechecks; it is only visible by clicking.

If that comes out clean, the remaining wrappers are mechanical. If it does not, the whole migration is a multi-week grind and the answer is to stay on Radix.

## Phase 2: adopt Base UI where it adds capability, not where it re-litigates working code

Both libraries coexist in one app without conflict. The low-risk entry point is new surfaces rather than replacements: Base UI has Combobox, Autocomplete, `useFilteredItems`, Number Field, Field/Form, Toast, Drawer, Meter, and OTP Field, none of which Radix will ever have. Our mention autocomplete in [prompt-editor.tsx](../../../apps/studio/src/client/components/prompt-editor.tsx), [provider-picker.tsx](../../../apps/studio/src/client/components/provider-picker.tsx), and the cmdk palette are all hand-built approximations of Combobox/Autocomplete.

## Phase 3: progressive wrapper migration

Only after phases 1 and 2 have shown the shape. Order is bottom-up: leaf wrappers (button, label, separator, toggle) first, then disclosure (accordion, collapsible, tabs), then overlays (dialog, sheet, popover, tooltip, hover-card), then menus (dropdown-menu, context-menu, menubar), then select, then sidebar. One component and its consumers per commit, project green at every step, Radix removed only after the last wrapper.

The upstream skill drives this and writes a per-component report. Its structural rules that matter most here: positioning props must be destructured in the wrapper and forwarded to the Positioner explicitly, or they silently land on the Popup and positioning breaks with no type error; and a clean three-way merge is not proof of a clean file, so grep each migrated file for leftover Radix imports.

## Phase 4: retire cmdk

The command palette is the last Radix holdout, through cmdk. Moving it onto Base UI Combobox is what actually removes Radix from the dependency tree, and it is a rewrite of [command.tsx](../../../apps/studio/src/client/components/ui/command.tsx) plus its call sites, not a mapping exercise. Worth doing on its own merits given cmdk's release cadence, but it is a separate piece of work.

## What changes at call sites

Mechanical, mostly:

| Radix | Base UI |
| --- | --- |
| `asChild` | `render={<X/>}` |
| `data-[state=open]` / `closed` / `checked` / `unchecked` / `active` / `on` | `data-open` / `data-closed` / `data-checked` / `data-unchecked` / `data-active` / `data-pressed` |
| `animate-in` / `animate-out` keyframes | `data-starting-style:` / `data-ending-style:` transitions |
| `--radix-<comp>-content-available-height` | `--available-height` |
| `--radix-<comp>-trigger-width` / `-height` | `--anchor-width` / `--anchor-height` |
| `--radix-<comp>-content-transform-origin` | `--transform-origin` |
| `Overlay` / `Content` / accordion and tabs `Content` | `Backdrop` / `Popup` inside `Positioner` / `Panel` |
| `onOpenAutoFocus` / `onCloseAutoFocus` + `preventDefault` | `initialFocus={false}` / `finalFocus={false}` |
| Tooltip `delayDuration` | `delay` |
| Select `position="popper"` | `alignItemWithTrigger={false}` |

Needs a decision rather than a rename:

- Tabs default to manual activation; `activationMode` is gone.
- Menu checkbox and radio items default to not closing on click.
- `ContextMenu` loses `modal`, and its trigger loses `disabled`.
- Tooltip loses `skipDelayDuration` and `disableHoverableContent`.
- Navigation menu hover delay drops from 200ms to 50ms.
- `onValueChange` widens to `(value | null, eventDetails)`, so `useState<string>` setters passed directly stop typechecking.
- Accordion and toggle-group lose `type="single" | "multiple"` in favor of always-array values plus a `multiple` boolean.
- No Label, AspectRatio, or VisuallyHidden primitives: native `<label>`, CSS `aspect-ratio`, `sr-only`. Popover `Anchor` is gone.

Portal container support survives: Base UI's Portal parts accept `container`, so [use-portal-container.tsx](../../../apps/studio/src/client/hooks/use-portal-container.tsx) carries over, re-threaded per component.

## Risks specific to this app

- **Zoom compensation.** The highest risk, covered in phase 1. Neither library has special handling for CSS `zoom` in anchoring, so the workaround stays a workaround; it just has to be re-derived on renamed vars and a different node.
- **Press activation.** [2026-07-27-controls-activate-on-press.md](../decisions/2026-07-27-controls-activate-on-press.md) and [2026-07-29-controls-activate-on-release.md](../decisions/2026-07-29-controls-activate-on-release.md) reason from Radix's per-primitive press timing and its handler composition. Base UI ships its own Button primitive with its own semantics, so the evidence behind both decisions has to be re-gathered and the docs rewritten.
- **Electron overlays.** Webview pointer-event interplay, non-modal overlays above the browser view, and [leaking-z-index-stacks.md](../findings/leaking-z-index-stacks.md) were all tuned against Radix's dismissable layer. Base UI has far less Electron exposure, so bugs we hit will be newer and less reported.
- **Silent visual regressions.** 154 state selectors and an animation idiom change are wide, mechanical, and untypechecked.

## Recommendation

Do phase 0 now. Treat phases 1 to 4 as optional and sequenced behind a quiet `components/ui/`, entered through new surfaces rather than a wholesale switch. Staying on Radix indefinitely is a supported position: it is maintained, shadcn keeps shipping both bases, and our wrappers already absorb most of the API surface.

## Docs to update if this lands

- [responsive-layout.md](../architecture/responsive-layout.md): var names and which node carries zoom.
- The two press-activation decisions, once re-verified.
- [leaking-z-index-stacks.md](../findings/leaking-z-index-stacks.md): the portal claim is Radix-specific as written.
