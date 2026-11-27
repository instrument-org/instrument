# A scroller fades out at an edge with more past it

Anything that scrolls softens the edge that has more content past it, so a cut-off row reads as continuing rather than ending on a hard line. The fade shows only while there is something to scroll to on that side: none at the top until the reader has scrolled down, none at the bottom once they reach the end, and none at all on a list that fits.

The fade is the `scroll-fade-y` or `scroll-fade-x` utility (`apps/studio/src/client/styles/globals.css`) and nothing else. Adding the class is the whole job: `watchScrollFades` (`apps/studio/src/client/lib/scroll-fades.ts`) marks each scroller while it overflows, so no component measures its own. The utility is a mask, so it goes on a scroller that paints no surface of its own: where the scroller draws a background, border or shadow, that surface moves to a box around it and the fade goes on the scroller inside (`MenuScrollArea` is the menu's version of this).

`studio/scroll-fade` (`apps/studio/oxlint-rules.ts`) asks every class list that scrolls (`overflow-auto`, `overflow-y-scroll` and so on) to choose: a fade, or `scroll-fade-none` for an edge that should stay hard.

**Applies when:** adding or changing anything that scrolls in the app: a pane, a list, a popover body, a block of code or log text.

**Not:**

- A fade over a sticky header, a frozen grid row or column, or a control pinned to an edge: the mask would dim it. Those take `scroll-fade-none` until the sticky part moves outside the scroller.
- A fade on a document page shown as pages (a Word or Pages file) or on a data grid.
- A reason to fade a scroller another mechanism already fades: the transcript's overlays, the tab strip's `useEdgeFade`, an editor table's.
- A fade drawn as a background gradient where a mask works, since a gradient needs to know the color behind it.

**Sources:**

- Edge fades were being added one prompt at a time, with three separate measuring hooks and about 80 scrollers without one; unified on the utility and the watcher, and the lint rule added, 2026-11-27.
