# Plan: virtualize the transcript

Status: open. Not started (checked 2026-11-26). Phase 0's tail-first rendering is gone: a chat now opens on its last 20 turns from the server (`lastTurnsOf`) and loads older pages as the reader nears the top. The per-update render cost raised alongside this plan (every loaded turn redrawing per streamed token or draft write) is fixed without it (the commits "keep earlier turns' separators and file maps while a reply streams" and "hold a chat's transcript props steady while it streams and settles"); phases 1 and 2 below are not built.

## Why, and what is left to win

A chat opens on its last 20 turns (`TURNS_PER_PAGE`, [feed.ts](../../packages/workspace/src/lib/transcript/feed.ts)), and `OlderTurns` asks for the page before as the reader nears the top. Nothing unmounts a turn after that: a reader who scrolls back through a long chat ends with every turn mounted, each with its folded work, cards and Markdown, for as long as the tab is open, and a kept tab stays open across switches.

What virtualizing buys is DOM size, memory and layout for a chat scrolled far back. It is not a per-token render win: React skips every turn but the one changing (`memo(TurnView)` with identity-stable props), so a streamed token renders the last turn whatever the chat's length. On the `long-chat` fixture after those fixes: 27-30 fibers per commit while streaming into a 60-turn chat, 24 in a new one; 1,150 transcript DOM nodes for the first page of 20 short turns and 2,350 with 40 loaded. A chat of tool-heavy turns is several times that per turn, which is where this plan pays.

## The shape: placeholders, not a virtual list

- **A virtual list** (`@tanstack/react-virtual`, as opencode and the chat list use): rows positioned by the virtualizer, only a range in the DOM, the browser's scroll anchoring turned off (`overflow-anchor: none`) because it fights the virtualizer's own offset corrections. The transcript already has one writer of its scroll position, `ScrollOwner` ([scroll-owner.ts](../../apps/studio/src/client/components/ui/scroll-owner/scroll-owner.ts)), which follows the end, holds a sent message with room under it (the spacer), slides the content on a send, holds a turn's answer still while its work folds (`ScrollPin`), and leaves the reader's place to the browser's anchoring. A virtual list would make the virtualizer a second writer and take anchoring away: everything the owner leaves to the browser it would have to do itself. Note `virtual-core` keeps the reader's place on a prepend only with `anchorTo: 'end'`, and corrects a resize above the fold only for rows wholly above it; opencode patches the first and wraps it in 1,300 lines of its own (`packages/app/src/session/timeline/virtualizer.tsx`), and t3code uses a different list (`@legendapp/list`) for `maintainVisibleContentPosition`.
- **Placeholders** (recommended): every turn stays a `MessageScrollerItem` in document order, so the owner and the browser see what they see today. A turn far from the viewport renders a box of its last measured height in place of its content. The owner's logic is untouched; only what is inside a far item changes, and the browser's anchoring absorbs a placeholder turning back into content of a slightly different height above the viewport.

Rows deliberately avoid `content-visibility` (it clips what overflows a row sideways, see `MessageScrollerItem`), which is why the placeholder is an explicit box rather than the CSS property.

## Phases

### Phase 1: a fixture that costs what real chats cost

`long-chat` is sixty short text turns, built for find. Add a fixture of a few hundred turns with tool work, file cards, tables and code, and a `studio-drive` probe that reports, for opening it, scrolling to the top and streaming into it: DOM nodes, heap, fibers per commit and long animation frames. The perf audit's probes (a paced stand-in model on loopback, CDP key events) are the starting point.

Exit: numbers for the current build to compare against.

### Phase 2: far turns become placeholders

- One `IntersectionObserver` on the viewport, `rootMargin` about two viewport heights, observing each item. Only a turn outside that band is a candidate.
- A turn's height is recorded while mounted from `offsetHeight` or a `ResizeObserver` box size, never a rect: the window is scaled with CSS `zoom`, and a rect is on-screen px while the owner works in layout px.
- A far turn renders `<div style={{ height }} />` inside its item, with the item's key, `data-message-id` and `scrollAnchor` unchanged, so `scrollToMessage` still finds it.
- Always mounted, whatever the distance: the last turn (it streams, and following the end reads it), the turn a `ScrollPin` holds, the turn a sent message's slide is settling on, any turn holding the selection, focus, an open popover or menu, and while the find is up, the turns with matches near the active one.

Exit: scrolling top to bottom and back shows no jumps at 0.75x, 1x and 1.5x zoom; the checks below pass.

## What it has to keep

- **Following the end while a reply streams**, with no frame drawn off it: the transcript debug page's trace of moves the reader did not ask for stays at zero.
- **The reader's place** while a reply streams below and while an older page loads above.
- **Folded work changing height**: a fold closing at a turn's end holds the answer still (`ScrollPin` reads where it was in `getSnapshotBeforeUpdate`, so the pinned turn is mounted), and a Worked row the reader opens is on screen and mounted.
- **Scroll position across tab switches.** A kept tab is `invisible opacity-0` ([group-view.tsx](../../apps/studio/src/client/components/window/group-view.tsx)), so its viewport keeps its size and offset and nothing re-measures. A hidden transcript must not turn rows into placeholders because its observer reads nothing as intersecting: freeze the set while the tab is not up.
- **Jumping to a turn**, from the chat list, a link or a find step: `scrollToMessage` lands on the placeholder's item, which mounts as it comes into the band, and the owner corrects once when it measures.
- **Find.** `ChatFind` searches the drawn DOM and paints with the CSS Custom Highlight API, and turns not loaded are searched in the records (`message.find`) and loaded when a step reaches one. A placeholder joins "not loaded" for counting: matches in it come from the records search, a step to one scrolls to its item first, and `FindScrollMarks` places its marks from the item's offset. opencode and t3code both search data, scroll to the row, then find the range in the mounted DOM.
- **What else reads rows from the DOM.** The developer notes layer anchors each note with CSS anchor positioning on `data-transcript-row` (a note for a placeholder is not drawn until it mounts); quote selection and copy work on a DOM selection (a drag across placeholders copies them as nothing, as Select All does in any virtualized reader); `use-hash-link-scroll` finds a heading by id (route a link into a placeholder through its message id).
- **State a turn keeps itself.** A turn's Worked row open state is `useState` in `TurnBody`; anything like it is lost when the turn becomes a placeholder. Lift what a reader would notice losing above the rows, the way `FoldsOpenedByFind` is.
- **Tests.** jsdom has no layout, observers or sizes, so which turns are mounted and where the view lands belong in `*.browser.test.tsx`.

## Not in this plan

Virtualizing inside a turn (a long run of activity rows): its work folds once the turn ends, and a turn the reader opens is the one they are reading.
