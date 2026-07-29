# Controls activate on press, not release

> Superseded by [2026-07-29-controls-activate-on-release.md](2026-07-29-controls-activate-on-release.md).

## Context

The web activates a control on `click`, which fires on pointer _release_. A desktop app is expected to answer on press. That difference is small in isolation and unmistakable in aggregate: every button, card and list row in Studio felt a beat slower than the OS around it, and the app read as a web page in a window.

The inconsistency was already visible before anything changed, because the primitives disagreed among themselves. Radix Tabs selects on `mousedown`, Radix Dropdown Menu opens on `pointerdown`, and the app's own tab strip selects on `pointerdown` — while plain buttons, toggles, collapsibles, file cards and sidebar rows all waited for `click`. Adjacent controls that looked identical behaved differently, and there is no library-wide switch for this: shadcn's Button is a styled `<button>` with no press policy, and Radix deliberately chooses per primitive.

Release activation is not an accident, and the arguments for it are real. macOS `NSControl` sends no action when the mouse is released outside the control, and [WCAG pointer cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation) recommends activating on release precisely so that moving away cancels. Down-event activation is expected to be essential, reversible, or undoable.

## Decision

Controls activate on press by default. The cases that keep release activation are enumerated, not opted into per call site, so a new control is immediate unless it is one of them.

Press activation is implemented by keeping `click` as the activation path: a press synthesizes one through `HTMLElement.click()` and the browser's own release click is then suppressed. Only the timing moves. Native button semantics, Radix's handler composition, Enter, Space and assistive technology are all unchanged, and touch stays on release so scrolling is not broken.

Release activation is kept for:

- **Destructive variants.** Losing pointer cancellation costs the most here, and this is where the WCAG guidance actually bites.
- **Explicit `submit` and `reset`.** The press is handed to the surrounding form.
- **`asChild`.** The rendered element belongs to somebody else and owns its own activation.
- **Confirmation dialogs**, which need no rule: `AlertDialogAction` and `AlertDialogCancel` borrow `buttonVariants` for styling and never render `Button`.

The tradeoff is accepted deliberately: a press that the user drags away from still acts. Every control that activates on press is reversible, re-runnable, or a view change. Nothing destructive was moved.

## The alternative we did not take

A desktop app can read as very responsive with almost no press activation at all, by removing the other sources of delay instead: activate the tab strip on press and leave everything else on `click`, drop the easing ramp from hover and press styling so state changes land on the next paint, keep routing out of React transitions so a view swap is never deprioritized, and lean on the compiler so the re-render a click causes is small.

That path keeps pointer cancellation everywhere, which is its real advantage. We did not take it because the delay users noticed here was activation timing rather than paint timing, and because the primitives already disagreed with each other, so _some_ policy had to be written down either way. The two are not exclusive: the styling and routing halves are still available, and are the better lever if the app ever feels slow _despite_ firing on press.

## Consequences

- `activation="release"` is the escape hatch on any primitive. Reach for it when a press commits something a user cannot undo by releasing elsewhere, and prefer expressing that as a destructive variant so the default covers it.
- A control that activates on press **never** acts on a real mouse click, whether or not its own press got that far. This is the invariant that makes the behavior predictable, and it means a guarded press is dropped rather than deferred to release.
- Suppressing the release click stops propagation as well as the default. A synthesized click bubbles like any other, so a release-activated ancestor has already seen it by the time the release arrives; without this it would run twice.
- Nesting an independently-activating control inside a press-activated one still requires `stopPropagation` on the _inner_ `pointerdown`, or one press reaches both. `FileRowCard` does this for its actions menu.
- Anything that opens on press must not be natively draggable, or the same press starts a drag. Images and thumbnails set `draggable={false}`.
- Press activation and hover-revealed controls interact badly: a control that fades in under the pointer can be activated before the user has seen it. `MediaCardShell` discards a press that lands inside its arming delay rather than deferring it. Guard the press, not the click: suppressing only the click leaves the press unguarded, and guarding both leaves the control dead for the length of the delay.
- The main window must not accept first mouse. Electron defaults `acceptFirstMouse` to false and this depends on it staying that way: raising a background window would otherwise fire whatever control the pointer happened to land on, which release activation made impossible.
- A button inside a `-webkit-app-region: drag` zone needs `no-drag`, or the drag region swallows the press and the control never activates at all.

## Implementation

- [The activation helper and the `detail === 0` test that tells a synthetic click from a real one](../../apps/studio/src/client/lib/immediate-click.ts)
- [Where the default and its exceptions are resolved](../../apps/studio/src/client/components/ui/button.tsx)
- [Navigation on press, including the ctrl-click and new-tab paths](../../apps/studio/src/client/components/internal-link.tsx)
- [Hover-delay interaction with press activation](../../apps/studio/src/client/components/media-card-shell.tsx)
- [Behavior pinned by tests, including the cancellation tradeoff and the ancestor double-fire](../../apps/studio/src/client/lib/immediate-click.browser.test.tsx)
