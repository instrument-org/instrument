# The browser guest stacks under the renderer's own layers

**Status:** verified on macOS. The 2.0 window no longer parks the pane's page under a draft window or a thread's small view. The classic window's dialog coverage is left as it was.

## The belief

For most of the product's life the browser was treated as something nothing in the window could draw over. A draft window opening over a page hid the page and put a placard where it had been; every app-wide dialog in the classic window parks the guest first; the pool's own header said two guests could never be shown at once. The belief had a real origin and outlived it:

- The browser began as a main-process `WebContentsView`, a native view attached to the window. Such a view sits above everything the renderer draws, so a modal over it had to hide it. That was true.
- The guest moved into the renderer as a `<webview>` element on `document.body` (see [in-app-browser](../architecture/in-app-browser.md)). The next day's commit made the pool enforce a single visible guest, described as restoring the guarantee the native view had implicitly given.
- A later fix reported that app-wide dialogs drew their dim layer under the guest and added the coverage count that parks a guest while any overlay is open.
- The draft windows inherited the reflex whole: a window over the pane parked the pane's page, on the stated grounds that a guest paints over everything in the window.

## What is true

A shown guest is a positioned element in the renderer's DOM with a `z-index` the pool sets from the `layer` its host hands `showOverSlot` (zero for the pane's page, above the draft windows for a draft's own page). Anything the renderer draws above that layer in the same stacking context covers the page, the way it covers any other element. Tested by switching the parking off and looking:

- A draft window (`z-40`) drew over the live page in the pane, with the page in view around it.
- A page opened inside the draft was a second shown guest, on the draft's layer, over the first.
- The address row's menu (`z-50`) drew over both.
- In the classic window, with the coverage count ignored, the Settings dialog drew over the task's browser panel.

Covering a guest with the renderer's own content does not disturb the agent: `capturePage` reads the guest's own surface, which is composited whole regardless of what the embedder lays over it (the same reason a scaled tile captures at full size, see [browser-guest-as-a-scaled-tile](browser-guest-as-a-scaled-tile.md)).

## What still needs care

Stacking works within one stacking context. An overlay whose ancestor forms a stacking context of its own that paints below a body-level element loses to the guest no matter how high its own `z-index` is; that is the [leaking-z-index-stacks](leaking-z-index-stacks.md) rule from the other side, and the likeliest shape of the dialog problem once reported, though it did not reproduce. Keep the compose layer and the portal target out of any wrapper that makes a stacking context (`isolate`, `transform`, `contain`, `opacity`, a `container-type`).

Two shown guests both register for the Cmd+F and Cmd+R chords; the registry keeps the last one, so with a draft's page open the chord reaches the draft's page rather than the pane's.

The classic window's coverage count still parks its guest under every dialog. It is not needed for stacking, and it is harmless, so it stays until that window is next worked on.
