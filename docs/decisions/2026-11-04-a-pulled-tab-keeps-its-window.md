# A pulled tab keeps its window

## Context

Each window is its own renderer, a tab's state lives in that renderer, and a `<webview>` cannot change renderers without reloading. So a tab torn off into a new renderer loses what a person cares about most, the words typed into its page, and the new window takes a moment to draw, which a picture of it can only partly hide.

## Decision

The tab stays and everything else moves. The pressed window goes with the pointer, renderer and all, and the other tabs reopen beneath it in a spare window kept booted and hidden, the same way they reopen after a launch. Nothing changes hands until the release, so going back to the row or Escape undoes all of it. Where this would lose more than it saves, because the tabs left behind have a used page and the tab has none, the direction flips and the tab rebuilds in the spare window.

## Alternatives

**A renderer per tab, each a native view.** Tabs tear off live and one crash takes one tab, but a window's floats, menus and dialogs have to draw over views they cannot share a surface with. Floats and Settings would become views measured and stacked by hand, which is what the app moved away from so that it could stay one web contents, reasonable to think about and able to run on the web and a phone. It also costs about 75% more memory at ten tabs than one process shared between them.

**One renderer drawing into several windows** (`window.open`). Tabs move without touching their state, but the code and every library in it read the global `document` and `window`, so all of it would have to be told which window it is in, and a `<webview>` still would not survive the move.

**A picture of the tab over a window loading behind it**, which the first version of tearing off did. The picture hides the wait and not the state: the page reloads and the keyboard and selection are put back by hand, and a person sees the moment it changes over.

**The page as a native view while it travels.** It moves live, and it cannot sit under a window's floats while it does.

## Consequences

- A hidden renderer is always running while the app is, about the cost of one more window with one quiet tab, so that a tear is ready when the press comes.
- A tab pulled out of a full-screen window, or with a used page left behind, still rebuilds. Used pages on both sides mean one reloads, the one not in the hand.
- Moving a live page between renderers needs a change in Electron. Chromium's Surface Embed allows a guest to detach and attach elsewhere, and if `<webview>` moves onto it the cases that reload go away with no change to this design.
