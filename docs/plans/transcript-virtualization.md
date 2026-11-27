# Plan: virtualize the transcript

Status: done. Built 2026-11-27 (checked then): far turns are boxes of their last height (`FarRows`, [far-rows.ts](../../apps/studio/src/client/components/ui/scroll-owner/far-rows.ts)), measured on the `long-work-chat` fixture with `perf-long-transcript.mjs`. Where the build differs from the plan below is under [As built](#as-built).

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

## As built

### Numbers

`long-work-chat` (300 turns of tool work, tables, code and file cards), `perf-long-transcript.mjs` in a dev build, counts first. Before is the build without boxes, after the one with them.

| Phase | DOM nodes (transcript) | Heap | Fibers per commit | Long frames |
| --- | --- | --- | --- | --- |
| Open (last 20 turns) | 2,805 → 736 | 228 → 214 MB | 289 → 273 | 1 → 1 |
| Wheeled to the top (300 turns) | 42,844 → 2,086 | 496 → 234 MB | 1,041 → 222 | 15 (6.1 s) → 14 (2.4 s) |
| Streaming a reply, followed at the end | 42,910 → 1,624 | 500 → 232 MB | 203 → 16 | 61 (14.4 s) → 5 (0.4 s) |
| Streaming a reply, read from above | 42,956 → 1,670 | 498 → 233 MB | 190 → 16 | 63 (14.8 s) → 3 (0.3 s) |

Timed again with each build's app pinned to the efficiency cores (`taskpolicy -c background`), without the zoom walk, long frames as count, total and worst:

| Phase | Before | After |
| --- | --- | --- |
| Wheeled to the top | 356, 82.6 s (20.3 s blocking), worst 4.6 s | 599, 123.1 s (17.9 s blocking), worst 0.9 s |
| Streaming, followed at the end | 26, 21.6 s (19.6 s blocking), worst 2.5 s | 83, 16.3 s (4.1 s blocking), worst 0.26 s |
| Streaming, read from above | 621, 152.9 s (34.3 s blocking), worst 14.8 s | 77, 15.1 s (3.5 s blocking), worst 0.26 s |

Scrolling all the way back costs more in all on slow cores, since every page still mounts whole before its far turns box and each turn draws again as the reader passes it, but no frame there blocks for long.

Both builds: no step in the probe's walk down to the end and back (587, 407 and 1,164 steps at 1x, 0.75x and 1.5x) left the row in the middle of the view off where the step put it, and the debug page's trace counted no unasked move while either reply streamed. Wheeling to the top took 13 nudges down before (each page loaded at a scroll position of 0 pushed the reader down by its height, and the loader stayed in view) and none after. Scrolling a long way back now commits more often (each turn coming near is drawn, each going far is boxed), with smaller commits and no long frame while stepping.

With room for the turns not loaded yet (`OlderTurns`), on a fresh seed of the fixture, before is the build with boxes alone:

| Measure | Before | After |
| --- | --- | --- |
| Column at opening, against every turn in (169,602 px) | 10,806 px | 158,076 px |
| Column length changes wheeling to the top | 25, 158,804 px in all, at most 11,430 | 25, 12,618 px in all, at most 10,813 |
| Frames the scrollbar thumb moved down while wheeling up | 14 | 0 |
| Scrollbar dragged to the very top | after 60 s, 2 pages in, 11,388 px under the top | after 2.2 s, every page in, on the first turn at the top |
| Efficiency cores, wheeled to the top: long frames | 587, 158.9 s (57.5 s blocking), worst 26.3 s | 578, 121.4 s (25.2 s blocking), worst 2.8 s |

The column changes about as often as before, since each page still lands and the room is taken again from more turns, but by a twelfth as much, and no step of the walks at 1x, 0.75x and 1.5x missed, nor did anything move unasked while a reply streamed. The drag is the probe's stand-in for a thumb (a press on the scroller, then the position stepped to 0 over ten frames), since synthesized drags do not reach the overlay scrollbar of a window off screen.

### What was taken from where

- **TanStack Virtual** (`virtual-core`): heights from the `ResizeObserver` entry's box sizes, never a rect, and a size cache that outlives the row (here the row never unmounts, so its height stays on it). Not taken: its own scroll corrections, which the browser's anchoring does here.
- **opencode's timeline virtualizer**: the find order. Search the data (`message.find`), bring the row into view, then find the range in what was drawn and refine there. Also its lesson that heights read under zoom must be layout px.
- **t3code with `@legendapp/list`**: keeping the first and last rows always drawn (`alwaysRender`) became `keepDrawn` on the last turn and the card's; its minimap reading row positions by index became `FarRows.places()`. Not taken: `maintainVisibleContentPosition` with `overflow-anchor: none`, which legend-list forces because Chrome's anchoring would correct a second time.
- **VS Code's chat list**: heights cached per element outside the row, and a prompt rail that places unmeasured turns from estimates, the precedent for a table of contents reading `places()`.
- **bb's timeline**: in-flow spacers with remembered heights, the closest shape to boxes. bb turns anchoring off and keeps the position itself; here anchoring stays on, which is safe because `ScrollOwner` writes whole positions, never size deltas, so the two never correct the same change.

### Where it differs from the plan

- **A turn is boxed whole.** Its opener row and its body row go far and come back together (`turnId` on both items), so a turn never shows its question without its answer.
- **The band has two edges.** Drawn within two viewport heights, a box only past three: one edge would box and draw a row at the edge on every small scroll.
- **The box is a child of the row.** The row keeps its own style and holds one empty `div` as tall as its content was; Chrome stops anchoring for a layout in which the anchor node's own style changed, and a jump to a box landed 21 px off when the box was the row's own height.
- **A jump to a box needs no correction from the owner.** `scrollToMessage` lands on the row, the row draws as it comes near, and anchoring keeps it where it landed while the rows above draw at their new heights.
- **The owner keeps the place at the very top.** Chrome anchors nothing at a scroll position of 0, so a page of older turns loading there pushed the reader down by its height. The owner notes the first message row and its top while the view is at the very top, and puts that row back where it was once rows are added above it, the loader going with the last page included (`keepPlaceAtTop`). It notes the row only while the row is in view: with the room for older turns filling the view, the position stays at 0 as pages land, so a drag of the scrollbar to the very top ends on the first turn.
- **The turns not loaded yet have room of their own.** Not in the plan: a long chat opened with a scrollbar for its last 20 turns, which grew by a page at a time as the reader went up, and a fast scroll up hit the top and bounced. The feed counts the session's own turns above what it sends (`olderTurns`, from the messages that open a turn, so a task's turns from its chat count none), and `OlderTurns` above the first turn held is that count times the average height of the turns held, taken again only when the count changes (a send leaves it as it was). It is the only spacer: no turn is measured offscreen or guessed at, and the room carries `overflow-anchor: none`, so the browser anchors on a turn row and a page landing in the room's place moves nothing on screen. It asks for the next page as it comes within 600 px of the view, and again after each page while it is still near, so a drag to the top keeps loading until real turns fill the view; a page that fails or adds nothing is not asked again until the room comes near anew.
- **The reader's open controls are lifted** (`KeptOpen`, by turn): the Worked row, activity and step rows, a long bubble and a long code block (by its language and first line, which stay put while it streams), and a code block's line wrapping, show as they were left when a turn is drawn again.
- **The log reads out only the turns kept drawn.** The column is `role="log"`; rows of any other turn carry `aria-live="off"`, so a turn drawn again, or a page of older ones, is not read out as news.
- **An open menu holds a turn; an open disclosure does not.** Only a popup's button (`aria-haspopup` with `aria-expanded="true"`) keeps its turn drawn.
- **A chat out of sight is not kept.** Chat screens are drawn afresh each time they come up ([kept-screens.ts](../../apps/studio/src/client/components/window/kept-screens.ts)), so switching tabs unmounts the transcript; the freeze while hidden (`setShown`) covers a transcript kept drawn behind the window's tab up.
- **A quote or a link into a box draws it first.** The composer's quote chip and a `#heading` link in a reply search what is drawn; `FarRows` notes a turn's element ids and its replies' words as it boxes, so one that finds nothing drawn takes the boxed turn that had them and draws it as the find does (`keepDrawn`). Nothing else names a turn or message: chat links and routes, the activity feed and branched-from lines name a chat.
- **A width change rescales the boxes.** A box whose width changes (a zoom, a narrower window) takes the height its row measured at that width before, else grows or shrinks by the ratio the rows drawn in the same resize did. On the fixture, back at 1x after the walk at 1.5x, the column is 172,000 px against 171,500 drawn whole; left at their old heights the boxes made it 19,000 px long, and scaled as words alone would wrap, 45,000 px short, since tool rows, tables and code keep their height. Anchoring absorbs the rest as each box draws again.

## Not in this plan

Virtualizing inside a turn (a long run of activity rows): its work folds once the turn ends, and a turn the reader opens is the one they are reading.
