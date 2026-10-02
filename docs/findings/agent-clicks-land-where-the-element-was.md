# Agent clicks land where the element was, not where it is

**Status:** understood and worked around in the gateway; the root fix belongs in agent-browser.

## Symptom

An agent clicks a link with `agent-browser click @ref` or `find text … click`, gets `✓ Done`, and the page does not navigate. Nothing errors. On Wikipedia at the width of the 2.0 window's page pane (577px) this happened on about half of ref clicks and every `find text` click; the same pages at 1280px or 478px did not show it.

## What happens

agent-browser's click resolves a point and presses it:

1. `DOM.scrollIntoViewIfNeeded` (refs) or a script that scrolls with `behavior: 'instant'` (selectors and `find`).
2. `DOM.getBoxModel`, or the same script's return value, straight after the scroll.
3. `mouseMoved`, `mousePressed`, `mouseReleased` at that point.

Wikipedia's Vector skin observes the scroll and toggles classes on `<body>` and the title bar's table-of-contents label within a frame, which moves the article content up by about two lines (36px at 577px). The measurement in step 2 is taken before that reflow; the press in step 3 arrives after it. Instrumented in the guest: `pointermove` targets the link, and `pointerdown`, `mousedown` and `click` a few milliseconds later target the paragraph around it, at identical coordinates, with the link's rect 36.4px higher than when measured. A click on paragraph text does nothing, and the command reports success.

It is timing-dependent, which is why it looked like our proxy. In headless Chrome agent-browser's move and press are about a millisecond apart and usually beat the reflow; in a visible Studio guest the `mouseMoved` acknowledgement waits on a real frame (20 to 65ms), which leaves room for the reflow almost every time. Upstream headless at 577×805 misses too, just less often.

Ruled out along the way: host DOM covering the guest (CDP input dispatched through the guest's own debugger is not hit-tested against the host page), the pane resizing the guest (width held at 577 throughout), smooth scrolling, UI zoom, and our injected guest scripts.

## What the gateway does

In `dispatch-command.ts`:

- `DOM.scrollIntoViewIfNeeded` is answered once the node's box model holds still across two animation frames, so agent-browser's next `DOM.getBoxModel` sees the settled layout.
- agent-browser's scroll-and-measure script (recognized by the overlay check it carries) is re-run until two runs agree, and that answer is returned.
- Before a `mousePressed`, the last measurement is repeated; if the element has moved, the press is not sent and the agent is told to run the click again.

Each press is also logged as an `agent press` line naming the element under the point, so a miss shows up as `hit=p#… target=none` rather than having to be reproduced.

The second item matches agent-browser's internal script text, so it stops applying silently if that text changes; the third still catches the miss in that case. All three can go once agent-browser waits for a stable box before pressing.

## A separate limit found on the way

A guest in a window fully covered by another app's window rendered no frames while reporting `visibilityState: "visible"` (`setBackgroundThrottling(false)` keeps it saying so). Presses to it are never acknowledged and time out after 5s. Minimizing the 2.0 window or hiding the app did not stop its guest rendering; being covered did. Every `Input.*` command now waits up to 150ms for one animation frame and is refused with the reason when none comes, so the agent stops retrying and asks for the window.
