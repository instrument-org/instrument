# Controls activate on release

Supersedes [2026-07-27-controls-activate-on-press.md](2026-07-27-controls-activate-on-press.md).

## Context

We moved every button, card and list row in Studio from `click` to a synthesized press activation, on the reading that a desktop app answers on press and the app read as a web page without it. Two days of living with it, plus a look at what the platform actually does, showed the reasoning was wrong in a way worth writing down.

The earlier decision's central evidence was that the primitives disagreed among themselves: Radix Tabs selects on `mousedown`, Dropdown Menu opens on `pointerdown`, and the app's tab strip selects on `pointerdown`, while buttons, toggles, collapsibles and sidebar rows waited for `click`. That was read as incoherence needing a uniform policy. It is not incoherence. It is the platform convention, which splits by control type:

- Menus, popovers and select triggers open on press. `NSMenu` tracks from mouse down.
- Tabs and segmented controls select on press.
- Buttons act on release, and only if the release lands inside. `NSControl` tracks the mouse and sends no action when the pointer leaves.

Radix encodes exactly that split per primitive, deliberately. The policy replaced a correct distinction with a uniform rule the platform does not have.

The felt problem was real, but it had two other causes, both since fixed on their own terms. Color and background eased over 150ms, so every hover and pressed state arrived a beat late; that is [2026-07-27-hover-and-press-feedback-does-not-ease.md](2026-07-27-hover-and-press-feedback-does-not-ease.md), which the press decision itself named as "the alternative we did not take." And a media card's overlay action box spanned the card's full width with its controls left-aligned, so a wide dead strip and the expand control underneath it both swallowed presses. That was a hit-testing bug, fixed with `pointer-events` and pinned by a browser test. Neither had anything to do with activation timing.

## Decision

Controls activate on release, which is the browser default. There is no activation policy, no `activation` prop, and no helper.

Press activation stays exactly where the platform puts it, and in every case it is already there without code of ours:

| Control                                               | Mechanism                             |
| ----------------------------------------------------- | ------------------------------------- |
| Tab strip items                                       | `onPointerDown` on the `Reorder.Item` |
| Dropdown menu, popover, select, context menu triggers | Radix, internally                     |
| Radix Tabs                                            | Radix, internally                     |

## Why the helper could not be kept for a few controls

The obvious middle path is to keep press activation on the handful of controls that deserve it. It collapses on inspection, because the two sets do not overlap.

The tab strip item is a `Reorder.Item`, so a bare `onPointerDown` is the entire implementation: no click handler to double-fire against, no keyboard activation to preserve. A real `<button>` has both. It fires `click` on Enter and Space, so acting on `pointerdown` as well means mouse users get the action twice. Deduplicating that is the whole reason the helper synthesized a click through `HTMLElement.click()` and then suppressed the browser's own, and every caveat in the superseded decision descends from that one maneuver: the ancestor double-fire, the `stopPropagation` a nested control needs on its own `pointerdown`, the `draggable={false}` requirement, the interaction with hover-arming delays.

So the controls that need the helper are exactly the `<button>`s, which are exactly the controls the platform says act on release. The set worth keeping is empty.

## Consequences

- Pointer cancellation works everywhere again: press a control, drag off it, release, nothing happens. That is what users expect from a control that looks like a button, and it is what [WCAG pointer cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation) asks for.
- A whole class of click-through goes away. A press-activated control that unmounts (a menu item, a row that swaps the view) left the release click to land on whatever replaced it, and that element saw a genuine mouse click, so it ran. Release activation makes it impossible.
- A new control needs no thought about activation, and no lint rule policing it. The rule that rejected `onClick` on a raw `<button>` is gone.
- The responsiveness the press policy was chasing is still there, from the no-easing sweep. If the app ever feels slow again, that decision's remaining levers are the ones to reach for: keep routing out of React transitions, and keep the re-render a click causes small.
- `InternalLink` navigates on click again, so the ctrl-click and new-tab paths are one code path rather than a press path plus a keyboard-and-ctrl-click remainder.

## Implementation

- Reverted in `studio: activate controls on release again`, which removes `immediate-click.ts`, its browser test, the `activation` prop on eight primitives, and the lint rule.
- [The media card hit-testing fix that the press policy was mistakenly credited with](../../apps/studio/src/client/components/media-card-shell.tsx)
