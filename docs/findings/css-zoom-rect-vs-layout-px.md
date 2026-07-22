# CSS zoom: mixing rect (on-screen px) with layout px

## Symptom

Scroll and virtualization UI misbehaves only when the app UI zoom is not 1x
(`zoomAtom`, 0.5x-2x). Two observed shapes:

- A scroll-to-bottom / scroll-to-end affordance stays visible while the viewport
  is already pinned to the bottom (and only clears on click), and stick-to-bottom
  auto-follow stops sticking. Grows worse the larger the zoom and the shorter the
  viewport.
- A virtualized list spaces its rows out with gaps and its scrollbar range
  stretches, proportional to the zoom factor.

## Root cause

The whole main window is scaled with CSS `zoom` on `ZoomRoot`. Under an ancestor
`zoom`, Chromium splits its measurement APIs into two coordinate spaces:

- `getBoundingClientRect()` returns **on-screen px** (multiplied by the zoom
  factor).
- `element.scrollTop`, `scrollHeight`, `clientHeight`, `offsetTop`, `offsetLeft`,
  `offsetWidth`, `offsetHeight`, and `ResizeObserver` box sizes return **layout
  px** (unscaled).

Any single computation that reads a rect value and combines it with a layout-px
value is wrong by the zoom factor at zoom != 1. It is silent at the 1x default,
so it slips through review.

Two recurring instances:

- **Scroll gap.** Distance-to-bottom computed as a rect-derived content bottom
  minus `scrollTop`/`clientHeight`. The rect term is `zoom x` larger, so the gap
  reads non-zero at the bottom: the button never goes inert and follow-bottom
  never arms. This is what stranded the scroll-to-end button in the third-party
  `@shadcn/react` message-scroller. Fixed by measuring the gap purely from
  `scrollHeight - scrollTop - clientHeight` (minus the tail spacer), which all
  share the layout-px space that `zoom` scales uniformly.
- **Virtualizer row measure.** A TanStack `measureElement` that returns
  `getBoundingClientRect().height` while rows are positioned via
  `transform: translateY(start)` and a spacer of `getTotalSize()` (both layout
  px). Every row reports `zoom x` its height. Fixed by measuring with
  `offsetHeight`.

## Audit heuristic

Flag any expression where a `getBoundingClientRect()` value is added to,
subtracted from, or compared against `scrollTop`, `scrollHeight`, `clientHeight`,
`offsetTop`/`offsetLeft`/`offsetWidth`/`offsetHeight`, a `ResizeObserver` size, or
a value later fed to `scrollTo`/`scrollBy`/`translateY`/a spacer height.

Safe by contrast:

- **rect-vs-rect** (`a.getBoundingClientRect().top - b.getBoundingClientRect().top`)
  cancels the zoom factor. Only when that delta is then added to a layout-px value
  (e.g. `scrollTop`) does it become a hazard.
- Values passed to a **native** scroll (`scrollIntoView`, `scrollTo({top:0})`) or
  a native Electron overlay are already in the space the engine expects.
- Pointer coordinate mixing (`event.clientX - rect.left`) inside a zoomed subtree
  needs a `/ zoom` correction; see `studio-sidebar-rail.tsx` for the reference
  pattern.

## Known sites

- Fixed: `@shadcn/react` message-scroller (scroll gap). Carried on a forked git
  build (`apps/studio/package.json` -> `github:mutewinter/ui#...`) pending
  upstream `shadcn-ui/ui#11249`.
- Fixed: `studio-command-menu.tsx` (virtualizer, uses `offsetHeight`).
- Fixed: `model-picker.tsx` (virtualizer, was `getBoundingClientRect().height`).
- Open candidates flagged but not yet addressed:
  - `nav-tasks.tsx` — rect delta + `scrollTop` fed as a virtualizer `scrollMargin`.
  - `hooks/use-hash-link-scroll.ts` — rect delta + `scrollTop` fed to `scrollTo`;
    over/under-scrolls on `#`-anchor clicks by the zoom factor.
  - `studio-modals/welcome-modal.tsx` — cosmetic: `event.clientX - rect.left` used
    as a CSS length in a mask on a self-zoomed dialog; spotlight drifts from the
    cursor.

## References

- `docs/architecture/responsive-layout.md` (the rect vs layout-px gotcha and the
  sanctioned zoom helpers for portalled content).
- `apps/studio/src/client/hooks/use-app-zoom.ts` for the zoom rationale and the
  upstream floating-ui issue.
