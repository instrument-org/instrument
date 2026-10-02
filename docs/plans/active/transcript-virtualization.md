# Plan: virtualize the transcript

Status: proposed. Phase 0 (tail-first rendering) has landed (`5c745cfd0`); phases 1 through 3 are not started (checked 2026-10-02: no long-chat fixture, no placeholders).

## Why

Opening a chat draws its whole transcript, and in the 2.0 window every switch between chats opens one, since a tab keeps only the chat it shows. The cost is mounting and laying out every turn, not scrolling: in a dev build, an 80-message chat held the window for 206-278ms per switch, a 30-message one for 120-140ms, and a CPU profile of the switch was mostly native style and layout rather than JavaScript. It grows with the conversation, so the long chats people actually keep are the ones that feel stuck.

`chat-stream-turn-model-refactor.md` rules out a custom virtualizer on the grounds that the scroller "stays fast into the thousands of turns". That holds for scrolling a transcript already on screen. It does not hold for putting one on screen, which is the cost measured here.

## What landed: phase 0, tail-first rendering

`TailFirst` in `chat-stream.tsx` mounts a transcript's last 12 turns on arrival and puts the older ones back above them 6 at a time on idle callbacks. The scroller's prepend handling (`preserveScrollOnPrepend`, on by default in the primitive) keeps whatever is on screen still while they arrive. The 80-message chat went to 93-103ms per switch, most of it the rest of the screen, and filled in within about 600ms.

What it does not fix: once filled, every turn is mounted, so a very long transcript still costs its full layout, just spread over idle time, and keeps all of it in the DOM for as long as the chat is open.

## The shape: placeholders, not a virtual list

Two ways to virtualize, and the choice decides most of the risk:

- **A virtual list** (TanStack Virtual): rows absolutely positioned inside a spacer, only the visible range in the DOM. It fights the scroller. The primitive walks the content element's direct children for `data-message-scroller-item` rows, in document order, to follow the end, anchor a submitted turn (`scrollAnchor`), restore position on prepend, and track what is visible. Absolute rows and a range that changes under it break all four, and the fork we carry for `releaseAutoScroll` would grow into a rewrite.
- **Placeholders** (recommended): every turn stays a `MessageScrollerItem` in document order, so the scroller sees exactly what it sees today. A turn far from the viewport renders a box of its last measured height instead of its content. The scroller's logic is untouched; only what is inside a far item changes.

The placeholder shape is also what phase 0 already is, taken to its end: `TailFirst` decides which turns are mounted by position from the end, and this decides it by distance from the viewport.

## Phases

### Phase 1: a fixture to measure against

A seeded workspace (`fixtures/workspaces/`) holding one chat with several hundred turns of realistic content: long replies with tables and code, file cards, grouped steps, images. Without it every number depends on whichever chats a dev workspace happens to have, which is how this plan's numbers come from 80 messages. Add a `studio-drive` sequence that switches into it and reports long tasks and landing position, the one `long.mjs`/`switch2.mjs` pair used for phase 0, committed beside the skill.

Exit: the fixture seeds, and the sequence reports numbers for the current build to compare against.

### Phase 2: far turns become placeholders

- One `IntersectionObserver` on the viewport, `rootMargin` about two viewport heights, observing each item. Only a turn outside that band is a candidate.
- A turn's height is recorded while it is mounted with `offsetHeight` or a `ResizeObserver` box size, never `getBoundingClientRect`: the window is scaled with CSS `zoom`, and a rect is on-screen px while the scroller works in layout px (`docs/findings/css-zoom-rect-vs-layout-px.md`).
- A far turn renders `<div style={{ height }} />` inside its item, with the item's key, `data-message-id` and `scrollAnchor` unchanged.
- Always mounted, whatever the distance: the last turn (it streams, and follow-bottom reads it), a turn holding an anchor the scroller is settling on, any turn containing the current selection or focus, and any turn with an open popover or menu.
- Native scroll anchoring (`overflow-anchor`, which the scroller does not disable) absorbs a placeholder turning back into content of a slightly different height above the viewport. Verify that under zoom rather than assume it.

Exit: in the fixture, switching into the long chat costs what switching into a short one does; scrolling top to bottom and back shows no jumps at 1x, 0.75x, and 1.5x zoom; follow-bottom, jump-to-end, turn anchoring, and opening a step (`useHoldRowInPlace`) all still work.

### Phase 3: arrive without drawing what is off screen

With placeholders in place, the far turns a chat opens with need never mount at all. Replace `TailFirst`'s idle fill with placeholders sized from a height cache:

- Heights cached per message id in a module-level map bounded by an LRU, so a chat come back to opens with real heights and an accurate scrollbar.
- A turn never measured gets an estimate from its content (a short user message, a reply's length in characters, a group's step count), refined when it first mounts.
- A reader who drags the scrollbar to the top of a never-seen chat gets placeholders mounting as they arrive, corrected by scroll anchoring.

Exit: switching into the fixture's longest chat is flat in its length; the cache survives switching between chats.

## What each phase must not break

- **Open state.** Which groups and steps are open is already held above the rows, in `ChatStream` (`TranscriptExpansion`), so it survives a turn unmounting. Anything a turn keeps in its own state does not survive: an image's loaded flag, a reply quote's hover, a Markdown source popover. Audit for state the reader would notice losing, and lift it the way expansion was lifted.
- **Self-opening steps.** `selfOpenedRowIds` is also held in `ChatStream`, so a step that opened itself does not open again when its turn remounts. Keep it there.
- **Links into a turn.** `use-hash-link-scroll` finds a heading by id in the DOM. A heading in a placeholder is not there. Route it through the message id: `scrollToMessage` in the primitive already waits for a message that has not registered yet, and placeholders keep their registration.
- **Selecting and copying.** A selection that runs through turns keeps them mounted (above), but a selection made by Select All or a drag across the whole transcript would copy placeholders as nothing. Decide whether Select All in the transcript is worth supporting; today it selects the window.
- **Find.** There is no find in the transcript today (Cmd+F reaches only a browser guest). A future one has to search the messages, not the DOM, and scroll to the match by message id.
- **Screen readers.** The transcript is a `role="log"`; far turns stop being readable in place. Acceptable for a log, since new content is what is announced, but say so where accessibility is reviewed.
- **Tests.** jsdom has no layout, no `IntersectionObserver` and no `ResizeObserver` sizes, so every assertion about which turns are mounted and where the view lands belongs in `*.browser.test.tsx`.

## Not in this plan

- **The pane beside the chat.** A chat's tab pane is rebuilt on every switch too, and a very large Markdown file open in it is drawn whole each time. That is the document viewer's cost, and its own plan: keep a chat's pane mounted per chat, or render long Markdown incrementally the way `block-split-markdown.md` does for streaming.
- **Keeping recent chats mounted.** Removed on purpose: a tab keeps what it shows and nothing more. Revisit only if phase 3 leaves switching slow.
