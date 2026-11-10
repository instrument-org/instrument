# An agent pointer in the in-app browser

Status: open. The pointer is built; whether it ships is judged from use, and the checks below that never ran are still owed.

The in-app browser shows what the agent did to a page only after the fact. A teal dart with a tag saying what it is doing, in the page for as long as the agent works there, moving to each point it clicks, types or scrolls, makes its actions visible as they happen. The person's own OS cursor stays theirs.

## The pointer is drawn in the page

[`agent-pointer.ts`](../../apps/studio/src/electron-main/browser-view/agent-pointer.ts) draws it the standard way a browser extension's content script draws over a page: a script run from an isolated world of its own (`executeJavaScriptInIsolatedWorld`), so the page's scripts cannot reach its state, building an `aria-hidden` host with `pointer-events: none` and a closed shadow root, styled only through the CSSOM so a page's Content-Security-Policy or Trusted Types cannot refuse it, and shown as a manual popover so it stands in the top layer above the page's own dialogs. The tag's words are a constructed stylesheet's `content`, so find-in-page never matches them.

Drawing in the page rather than over it settles placement by construction: the agent's mouse coordinates are the page's CSS pixels, so page zoom, app zoom, device preview and display density need no mapping. It also puts the pointer, tag included, in the page thumbnails and recordings for free.

The cost is that the page can see it: a `MutationObserver` on the document element sees one `div` arrive, and a script reading `outerHTML` sees the host (the shadow contents stay closed). That is what every extension that draws on a page accepts. Hit testing (`elementFromPoint`), the accessibility tree agent-browser snapshots, and the page's text are unaffected.

A host overlay above the `<webview>` was the earlier plan. It kept the page from seeing anything, but needed coordinate mapping for each zoom and emulation mode and drew nothing into the thumbnails.

## When it is there

- It comes in with the agent's first work in the page (`isPageWork`: input, a navigation, a script, a snapshot or a read, not agent-browser attaching to every tab it can see): at the middle of the page, popping up from small, or at the first point it clicks.
- It stays, at the last place it acted, for as long as an agent with a turn running has driven the tab (`isDrivenByWorkingAgent`, asked once a second), through the agent's thinking between steps. While idle it breathes and wanders a few pixels around that place, so it reads as waiting rather than gone.
- A document the tab loads meanwhile gets it back at the same point (`carryAgentPointer` on `dom-ready`), since a click on a link takes the old document, and the pointer drawn in it, with it.
- It shrinks and fades out once no agent at work drives the tab: when the turn ends.
- Claude in Chrome's pointer was the closest reference: it shows for the whole run, travels curved paths timed by distance, holds the click until it lands, and names the action on a label.

## How it moves

- A move glides along a curve that bows to one side, alternating, in 140 to 380 ms growing with the distance as a hand's does, leaning into its travel and overshooting a few pixels before it settles.
- Main holds each `Input.dispatchMouseEvent` move until the pointer has arrived, at most 450 ms, so the page sees the move, and the press after it, as the pointer lands. Nothing else waits on it, and it never fails a command.
- A press squeezes the dart and pulses a ring; the release lets it bounce back. Typing glides it to the focused field and taps it per key; a wheel glides it to the scroll point and nudges it the way the page went. The tag names the act ("Clicking", "Typing", "Scrolling", "Dragging") for a moment, then reads "Thinking" until the next act.
- The tag sits in the dart's notch and moves to the other side of the tip near the page's right or bottom edge.
- One act is in flight per tab, and a move replaces a move waiting, so a drag never queues behind a slow page. A page that does not answer in a second is given up on.
- A frame's commands are in the frame's coordinates: they keep the pointer in the page but do not move it.
- The agent's own `Page.captureScreenshot` hides it for the capture: in the agent's picture it would only cover what it is looking at.
- With reduced motion it jumps rather than glides and does not wander.

## Checked in the running app

On macOS, against a local test page, github.com, Wikipedia and a form:

- Clicks, a drag through `mouse down/move/up`, a click after scrolling, a click opening a modal dialog (the pointer above its backdrop) and a click following a link (the pointer back on the new page) all drew at the delivered point, and the page received trusted events.
- At page zoom 1.5 the pointer still landed on the element, scaled with the page.
- On GitHub's sign-in page, whose policy requires Trusted Types, the pointer drew and typing went through.
- The page thumbnail showed the pointer; the agent's screenshot did not; the agent's snapshot listed nothing of it.
- Real agent turns, recorded from the app window: the pointer came in with the agent's first command, stayed through its thinking across link hops, a scroll, a search and a form filled field by field, and went once the turn ended.

## Still owed

- [ ] Device preview ("View as") and a cross-origin frame, both expected to be right by construction or left alone, never looked at.
- [ ] Windows and Linux.
- [ ] Whether the idle wander and the verbs on the tag stay welcome over many turns, or want to be calmer.
