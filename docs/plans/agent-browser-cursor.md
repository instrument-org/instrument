# An agent pointer in the in-app browser

Status: open. The pointer is built; whether it ships is judged from use, and the checks below that never ran are still owed.

The in-app browser shows what the agent did to a page only after the fact. An arrow that moves to each point the agent presses, with a pulse where it clicks and an "Instrument" tag saying who is acting, makes its actions visible as they happen. The person's own OS cursor stays theirs.

## The pointer is drawn in the page

[`agent-pointer.ts`](../../apps/studio/src/electron-main/browser-view/agent-pointer.ts) draws it the standard way a browser extension's content script draws over a page: a script run from an isolated world of its own (`executeJavaScriptInIsolatedWorld`), so the page's scripts cannot reach its state, building an `aria-hidden` host with `pointer-events: none` and a closed shadow root, styled only through the CSSOM so a page's Content-Security-Policy or Trusted Types cannot refuse it, and shown as a manual popover so it stands in the top layer above the page's own dialogs.

Drawing in the page rather than over it settles placement by construction: the agent's mouse coordinates are the page's CSS pixels, so page zoom, app zoom, device preview and display density need no mapping. It also puts the pointer in the page thumbnails and recordings for free.

The cost is that the page can see it: a `MutationObserver` on the document element sees one `div` arrive, and a script reading `outerHTML` sees the host (the shadow contents stay closed). That is what every extension that draws on a page accepts. Hit testing (`elementFromPoint`), the accessibility tree agent-browser snapshots, and the page's text are unaffected.

A host overlay above the `<webview>` was the earlier plan. It kept the page from seeing anything, but needed coordinate mapping for each zoom and emulation mode and drew nothing into the thumbnails.

## How it moves

- Main reads the point each `Input.dispatchMouseEvent` to the page was delivered at, after `aimPressAtElement` and `releaseWherePressed`, in `forwardToDebugger`, and sends it without waiting: the command never waits on the pointer and the pointer never fails the command.
- One update is in flight per tab, and a newer one replaces any waiting, keeping a press it skipped over, so a drag never queues behind a slow page. A page that does not answer in a second is given up on.
- The arrow glides to a new point in 160 ms, and a press pulses a ring at the point once the arrow arrives. The pointer is raised in the top layer again on each press and release, so a dialog the click opens does not cover it.
- It fades five seconds after the agent's last mouse command. A document the tab loads within that time gets the pointer back at its last point for the rest of the time (`carryAgentPointer` on `dom-ready`), since a click on a link otherwise takes the pointer away with the old document.
- A frame's commands are in the frame's coordinates and do not move it. Wheel, keyboard and script commands give no point and leave it where it was.
- The agent's own `Page.captureScreenshot` hides it for the capture: in the agent's picture it would only cover what it is looking at.
- The tag sits in the arrow's notch and moves to the other side of the tip near the page's right or bottom edge. The chat card's thumbnail shows it too, a few pixels across at that size: keeping it out would mean hiding it for every thumbnail or drawing it outside the page, neither worth a smudge.

## Checked in the running app

Through agent-browser in a chat's sandbox, against a local test page and github.com, on macOS:

- Clicks, a drag through `mouse down/move/up`, a click after scrolling, a click opening a modal dialog (the pointer above its backdrop) and a click following a link (the pointer back on the new page) all drew at the delivered point, and the page received trusted events.
- At page zoom 1.5 the pointer still landed on the element, scaled with the page.
- On GitHub's sign-in page, whose policy requires Trusted Types, the pointer drew and typing went through.
- The page thumbnail showed the pointer; the agent's screenshot did not; the agent's snapshot listed nothing of it; it faded after five seconds.

## Still owed

- [ ] Device preview ("View as") and a cross-origin frame, both expected to be right by construction or left alone, never looked at.
- [ ] Windows and Linux.
- [ ] Whether the 160 ms glide, the five-second fade, the arrow's size and the tag read well while watching a real agent turn.
