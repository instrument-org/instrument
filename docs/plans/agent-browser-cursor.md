# A host cursor for Agent Browser

Status: open. Not started; a spike comes first, to judge whether watching the agent's pointer helps.

The in-app browser shows what the agent did to a page only after the fact. A cursor that moves to each point the agent presses, drawn by Studio over the guest, makes its clicks visible as they happen. The page never sees it, and the person's own OS cursor stays theirs.

## The cursor lives in the host, not the page

Draw an inert arrow in Studio's renderer, as a child of the guest's pool container in [`browser-pool.ts`](../../apps/studio/src/client/lib/browser-pool.ts), with `pointer-events: none` and no focusable children. That container is already where the pool settles everything the cursor needs:

- `placeGuest` sets it to the winning slot's bounds and layer, with `overflow: hidden` and the slot's bottom corners, so the cursor is clipped and stacked with the page, and the frontmost of several panels claiming one guest is the one that shows it.
- `applyPaintHost` parks it at `opacity: 0.001`, so a parked guest's cursor is hidden with it.
- A device preview centers the `<webview>` inside it at `renderedSize`; the cursor takes the same offset.

Nothing is injected into the guest: no page script, extension or Agent Browser fork. Agent Browser's own `record start --cursor` and the browse extension's ghost cursor both append an element to the page's DOM, which the page can find and which lands in its screenshots. A hidden Electron probe (Electron 45.2.3) confirmed the separation for a host element over a `<webview>`: absent from the guest's capture, invisible to its DOM queries and mutation observer, while CDP mouse events still reached the page as trusted input.

## Coordinates come from what Studio sent

In [`forwardToDebugger`](../../apps/studio/src/electron-main/browser-view/dispatch-command.ts), a press is re-aimed by `aimPressAtElement` and its release follows it through `releaseWherePressed`, so the point the page receives can differ from the one Agent Browser asked for. The cursor reads `delivered`, just before `sendToDebugger`, never the incoming params.

Main posts each `Input.dispatchMouseEvent` straight to the guest's host window (its `hostWebContents`): target id, x, y, button state and type. It is fire and forget. It goes out before the CDP acknowledgment, which can hang after the page already has the event, and it can never delay or fail the command. It stays off the browser event stream and out of chat records.

The renderer keeps the latest point per target, coalescing moves to one per frame while keeping presses and releases in order. A press shows as a short pulse held locally, since a press and release can arrive within one frame.

Only root-frame commands move the cursor (`frameSession` undefined). An out-of-process iframe's coordinates are frame-local, and drawing them as page coordinates would put the cursor in the wrong place.

## Placement

`hostPoint = webviewOffsetInContainer + guestPoint × displayScale`, in CSS px of the host document. The container lives on `document.body`, outside `ZoomRoot`, in on-screen px, so app zoom is already in its bounds. `displayScale` is the device preview's emulation `scale` (`device-emulation.ts`) and the guest's page zoom; whether CDP mouse coordinates are in pre- or post-zoom CSS px under `setZoomFactor` is unverified and is the first thing the spike measures.

## When it shows

- It fades after a few seconds with no agent mouse command, and clears on navigation, guest teardown and a destroyed guest's late events.
- Typing, scrolling and script give no new point; the cursor stays where it was until it fades.
- It hides while the guest is in HTML full screen, where the `<webview>` stands in the top layer above any sibling.
- No guess at human takeover: the idle fade covers a person reaching for the page.
- Real eased mouse movement in Agent Browser would change the page's input and timing; smoothing, if any, is visual only and short enough never to lag the real click.

## Captures

The cursor is absent from everything taken from the guest's own contents: the page thumbnails (`capturePageThumbnail` captures the guest through `captureFrame`), the agent's own `Page.captureScreenshot`, and the guest screencast. The agent never sees its own cursor, which is what we want. A capture of the whole app window includes it: the tab-drag picture (`tab-picture.ts`) and any screen recording.

A thumbnail or a transcript step that should show where the agent clicked would keep the last point beside the picture and draw the same arrow over the `<img>` at display time, never bake it into the image. That is separate from this plan.

## Spike

- [ ] Move an arrow to each delivered root-frame mouse point on visible guests, pulse on press, fade when idle.
- [ ] Measure placement at app zoom 1x and 1.5x, guest zoom 1x and 1.5x, and in a device preview, by pressing known elements and comparing the arrow with the element's box.
- [ ] Check a re-aimed press pulses at the corrected point, and a guest moved to another window or split view shows the cursor only in the winning slot.
- [ ] Decide from use whether it ships; then check Windows and Linux, where the probe never ran.
