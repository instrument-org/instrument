# A pulled tab keeps its window

## Context

Each window is its own renderer, a tab's state lives in that renderer, and a `<webview>` cannot change renderers without reloading. So a tab torn off into a new renderer loses what a person cares about most, the words typed into its page, and the new window takes a moment to draw, which a picture of it can only partly hide.

## Decision

While a tab is held, nothing moves but a picture of it. Off its row it leaves its strip with the strip's own motion, the tab beside it comes up, and the picture goes with the pointer, so a drag that comes back to the row, or Escape, has nothing to undo.

On the release, the side with less to lose reopens. A tab with no page someone has used opens fresh in a spare window kept booted and hidden, and the window it came from stays as it is, every page in it included. A tab whose page has been used keeps its window: the pressed window goes to the pointer, renderer and all, and the other tabs reopen in its place in the spare, the same way they reopen after a launch.

## Alternatives

**A renderer per tab, each a native view.** Tabs tear off live and one crash takes one tab, but a window's floats, menus and dialogs have to draw over views they cannot share a surface with. Floats and Settings would become views measured and stacked by hand, which is what the app moved away from so that it could stay one web contents, reasonable to think about and able to run on the web and a phone. It also costs about 75% more memory at ten tabs than one process shared between them.

**One renderer drawing into several windows** (`window.open`). Tabs move without touching their state, but the code and every library in it read the global `document` and `window`, so all of it would have to be told which window it is in, and a `<webview>` still would not survive the move.

**The pressed window following the pointer through the whole drag**, which the second version did. It showed the real page under the pointer, and paid for it as soon as the tab left its row: the strip collapsed to one tab before the window could move, which showed as a flash, the tabs left behind appeared without closing up because the window beneath was drawn that way, and a drag meant as a reorder that wandered off the row cost a window. It also took a window standing in for another's strip, and opacity tricks for as long as the tab was held.

**Rebuilding every pulled tab**, which the first version of tearing off did, with a picture over a window loading behind it. The picture hides the wait and not the state: the page reloads and the keyboard and selection are put back by hand, and a person sees the moment it changes over. A picture is fine for carrying the tab. A used page still keeps its renderer, which is what this version does and that one did not.

**The page as a native view while it travels.** It moves live, and it cannot sit under a window's floats while it does.

## Consequences

- A hidden renderer is always running while the app is, about the cost of one more window with one quiet tab, so that a window is ready when the tab is let go.
- A tab with no used page rebuilds, with its scroll and focus put back, and an untouched page in it loads again in the new window. A tab pulled out of a full-screen window always rebuilds. Used pages on both sides mean one reloads, the one not in the hand.
- The pointer carries a picture of the window as it stands, not the tab, so floats that will stay behind are in it.
- Moving a live page between renderers needs a change in Electron. Chromium's Surface Embed allows a guest to detach and attach elsewhere, and if `<webview>` moves onto it the cases that reload go away with no change to this design.
