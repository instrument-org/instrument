# Leaking z-index stacks in the renderer

**Status:** resolved for the surfaces listed below; the rule stands for new ones.

## The problem

A `z-10` on a positioned element does not mean "10 above my siblings". It means
"10 within the nearest ancestor stacking context", and `position: relative`
alone does not make one. So a small local stack -- an overlay button over a
thumbnail, a progress bar over a video -- climbs until it finds a real stacking
context, and along the way it outranks unrelated chrome that only ever asked to
paint in normal flow.

The visible symptom was a video card in the file grid: its duration readout and
progress bar (`z-10`) painted over the composer's slash menu. Both were in the
transcript's stacking context, and the menu lost despite sitting later in the
DOM and asking for a higher `z-index`, because the composer wrapper in
`components/task/chat.tsx` carries `isolate`.

That last part is the non-obvious half. `isolation: isolate` creates a stacking
context but does not position the element, so the whole subtree paints as a
block-level in-flow descendant -- step 3 of the CSS painting order, _below_
every positioned `z-index` descendant of the same parent (step 6 and up). A
`z-20` inside an isolated, unpositioned wrapper therefore loses to a `z-10`
outside it. The composer's `isolate` is correct and deliberate (it contains the
tutorial card's `-z-10` background); the leak was on the other side.

## The rule

An element that stacks children against each other owns a stacking context:
give it `isolate`. Reach for a raised `z-index` only when the element genuinely
has to paint above something outside its own subtree, and expect to justify it.

Radix overlays sidestep this entirely: they portal out of the route content
(see `hooks/use-portal-container.tsx`) and land at `z-50` in the tab's own
stacking context, above any in-page stack. Floating UI built by hand does not,
which is the second reason the composer's slash menu now uses `Popover`.

## Where it was applied

`isolate` marks the owner of a purely internal stack in:

- `components/media-card-shell.tsx` -- scrim, overlay actions, expand button,
  and the video progress bar and duration
- `components/prompt-input.tsx` -- the drag-and-drop overlay
- `components/markdown.tsx` -- the copy button over a code block
- `components/server-exceptions-alert.tsx` -- the per-row copy button
- `components/icons/planning-dot.tsx` -- the dot over its shockwave ring
- `routes/_app/skills/index.tsx` -- badges and copy button over the row's
  full-bleed link

Left raised on purpose, because each has to paint above a sibling subtree: the
sidebar rail's resize handle, `ui/sidebar.tsx`'s
fixed rail, `ui/button-group.tsx`'s focus ring, and the debug route's sticky
header. Anything inside a Dialog is already contained by the fixed `z-50`
content and needs nothing.
