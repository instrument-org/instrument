# Agent clicks land where the element was, not where it is

**Status:** fixed in agent-browser, which from 0.44.0 waits in the page for an element to hold still, presses the center of its largest content quad, and refuses a press the browser says would land elsewhere. The gateway (`apps/studio/src/electron-main/browser-view/dispatch-command.ts`) no longer settles the layout itself. It keeps one check, on ref clicks: the element is measured once more as the press arrives, and a press on one that moved is refused.

## Symptom

An agent clicks a link with `agent-browser click @ref` or `find text … click`, gets `✓ Done`, and the page does not navigate. Nothing errors. On Wikipedia at the width of the 2.0 window's page pane (577px) this happened on about half of ref clicks and every `find text` click; the same pages at 1280px or 478px did not show it.

## What happened

Through agent-browser 0.39, a click resolved a point and pressed it:

1. `DOM.scrollIntoViewIfNeeded` (refs) or a script that scrolls with `behavior: 'instant'` (selectors and `find`).
2. `DOM.getBoxModel`, or the same script's return value, straight after the scroll.
3. `mouseMoved`, `mousePressed`, `mouseReleased` at that point.

Wikipedia's Vector skin observes the scroll and toggles classes on `<body>` and the title bar's table-of-contents label within a frame, which moves the article content up by about two lines (36px at 577px). The measurement in step 2 was taken before that reflow; the press in step 3 arrived after it. Instrumented in the guest: `pointermove` targets the link, and `pointerdown`, `mousedown` and `click` a few milliseconds later target the paragraph around it, at identical coordinates, with the link's rect 36.4px higher than when measured. A click on paragraph text does nothing, and the command reported success.

It is timing-dependent, which is why it looked like our proxy. In headless Chrome agent-browser's move and press are about a millisecond apart and usually beat the reflow; in a visible Studio guest the `mouseMoved` acknowledgement waits on a real frame (20 to 65ms), which leaves room for the reflow almost every time. Upstream headless at 577×805 missed too, just less often.

A second way to the same result: a link broken across two lines has a box whose center can fall between its pieces, on the text around them.

Ruled out along the way: host DOM covering the guest (CDP input dispatched through the guest's own debugger is not hit-tested against the host page), the pane resizing the guest (width held at 577 throughout), smooth scrolling, UI zoom, and our injected guest scripts.

## What agent-browser does now

Read from the 0.44.0 source (`cli/src/native/element.rs`, `click_point.rs`):

- One script scrolls the element into view and, when the scroll moved it, measures again after two animation frames (or 100ms where none come) until two measurements agree, up to five rounds. Ref clicks run it with `Runtime.callFunctionOn`, selector and `find` clicks with `Runtime.evaluate`, both awaiting its promise. `DOM.scrollIntoViewIfNeeded` and `DOM.getBoxModel` are no longer part of a click.
- A ref click then takes `DOM.getContentQuads` and presses the center of the largest quad, rounded to a whole pixel, so a wrapped link is pressed on one of its pieces. It asks `DOM.getNodeForLocation` what that point would hit, and refuses the click unless that is the element, something inside it, a label that activates it, or the frame it embeds.
- A selector or `find` click presses the point the script measured, and the same script refuses when `elementFromPoint` there is an unrelated element.

## What the gateway still does

- Before a `mousePressed`, the last `DOM.getContentQuads` is repeated when the press is aimed at the point it gave; if the element has moved or gone, the press is not sent and the agent is told to click again. Upstream's own check runs before `mouseMoved`, and in a visible guest the press follows it by a rendering probe, the agent's pointer and a rendered frame, which is the gap the original miss came through. Selector and `find` clicks carry no node to measure again, so they rest on upstream's script alone.
- Each press is logged as an `agent press` line naming the element under the point, so a miss shows up as `hit=p#… target=none` rather than having to be reproduced.

The gateway used to answer `DOM.scrollIntoViewIfNeeded` only once the box held still, re-run agent-browser's scroll-and-measure script until two runs agreed, re-aim a press at where a moved element had settled, and aim a wrapped link's press into its first line. All four went with 0.44.0: the first two would repeat a wait upstream now does itself, and a re-aimed press would go to a point upstream never hit-tested.

## A separate limit found on the way

A guest in a window fully covered by another app's window rendered no frames while reporting `visibilityState: "visible"` (`setBackgroundThrottling(false)` keeps it saying so). Presses to it are never acknowledged and time out after 5s. Minimizing the 2.0 window or hiding the app did not stop its guest rendering; being covered did. Every `Input.*` command now waits up to 150ms for one animation frame and is refused with the reason when none comes, so the agent stops retrying and asks for the window.
