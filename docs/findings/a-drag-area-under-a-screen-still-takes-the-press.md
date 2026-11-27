# A drag area under a screen still takes the press

**Status:** fixed for inert content by a rule in `globals.css`, and `drag-audit.mjs` finds any other case.

Setup's Not now, Continue, Skip and Back could not be clicked: a press moved the window instead. Tab and Return reached them, and nothing showed wrong in a screenshot or to a driven `click`, which dispatches input past the window's drag handling.

## Why

Electron builds the window's drag area from every box whose computed `app-region` is `drag` or `no-drag`, in document order, each `drag` added and each `no-drag` taken away, at the box's full size. What is drawn on top, `inert`, `pointer-events: none`, opacity and clipping play no part. A box with no `app-region` of its own adds nothing and takes nothing away, so a button drawn over a drag area is inside it unless the button, or a box after the drag area that covers it, says `no-drag`.

Setup draws over the app window, which stays mounted under it as `inert` (`window-frame.tsx`). The sidebar's empty space and foot, and the side panel's empty ground, are drag areas so the window moves by them. Under setup they lay beneath the footer's buttons: the sidebar's foot under Back, the side panel's ground under every button at the right.

## What it does now

`[inert], [inert] *` sets `app-region: initial`, so nothing inert is a handle for the window. `initial` rather than `no-drag`, which would cut a hole in a band around an inert box.

Toasts were the second case: the toasters sit at the window's lower left, outside the portal container, and a stack fanned out on hover lies over the sidebar's empty space, so Undo and the close buttons moved the window. The toasters' boxes are `no-drag` as the portal container's are.

The same trap waits for any surface drawn over a drag area that is neither inert, in the portal container nor in a toaster. `.agents/skills/studio-chrome-devtools/scripts/drag-audit.mjs` works out the drag area as Electron does and lists every visible control whose middle lies in it; `--args '{"setup":true}'` walks setup step by step, and `sweep-screens.mjs` runs it on every screen it visits.
