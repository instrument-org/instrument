# Plan: run the transcript scrollbar the full height of the pane

Status: proposed, not started. Cosmetic goal with a load-bearing constraint: it must not cost anything in the transcript's follow-bottom behavior, and it must not introduce JS layout measurement. Turn anchoring has landed since this was written and moves where the composer has to go; see "What anchoring costs this plan".

---

## Background / why

The task pane stacks three boxes vertically: the toolbar ([sidebar.tsx](../../../apps/studio/src/client/components/task/sidebar.tsx)), the transcript scroller, and the composer ([chat.tsx](../../../apps/studio/src/client/components/task/chat.tsx)). A scrollbar is painted on its scroll container's box, so the transcript's scrollbar starts below the toolbar and stops above the composer. It reads as a short track floating in a well rather than an edge of the window.

The composer used to be a sticky footer *inside* the scroll viewport, which gave a full-height track. `studio: keep the chat composer out of the scroll viewport` moved it to a flex sibling below the scroller, on the diagnosis that the composer's height became scrollable space the scroller never measured and that the "at the bottom" band spanned the whole composer, re-arming follow-bottom right after a scroll-up.

## Key insight

Two things have to be true at once, and they are less in tension than they look.

**1. `position: sticky` is a layout reserve, not a measurement.** A sticky element keeps its height in normal flow and is painted pinned. The browser does the reserve. The only reason a full-height scroll region seems to require a `ResizeObserver` and a CSS variable is the variant where the composer is pulled *out* of flow, which forces us to re-derive by hand what flow already knows. Sticky avoids that entirely: no observer, no variable, no measure-write-relayout cycle.

**2. The scroller's follow contract is scroll-extent arithmetic, not content enumeration.** In `@shadcn/react`'s message scroller:

- "At the bottom" is `scrollHeight - spacerHeight - clientHeight - scrollTop > scrollEdgeThreshold` (default 8px). A sticky child's height is inside both `scrollHeight` and max scroll, so "at the bottom" stays exactly max scroll.
- `scrollToEnd` targets `scrollHeight - clientHeight`.
- Every helper that enumerates messages (visible-range, content-end, first-visible, the visibility observer) walks the **Content** element's children. A sibling at the viewport level is invisible to all of them.

So a sticky composer as a sibling of `MessageScrollerContent`, inside `MessageScrollerViewport`, is arithmetically inert to the follow math. That is a structural property of where the library reads from, not a coincidence.

This held while the transcript was pinned to its own bottom. It stopped holding when [anchor-the-submitted-turn.md](../completed/anchor-the-submitted-turn.md) landed, and the fix is to put the composer one level lower; see below.

The corollary is that the reverted diagnosis does not survive reading the library: the band is 8px, not composer-height. A likelier account of what we hit is that `autoScroll` was unconditional at the time (it is `isAgentAlive` now), and the release from follow-bottom is gated behind a 180ms `autoscrolling` flag that is nearly always set during streaming, so a scroll-up often could not release before the next follow-scroll re-armed it. That is the mode reducer, not the layout, and part of it has already changed.

## What anchoring costs this plan

An anchored turn reserves room below itself with a **tail spacer**, and the spacer is what makes the composer's position matter. `getTailSpacerHeight` is `scrollTop + viewport.clientHeight - getContentBottom(...)`. The two terms have to measure the same box, and a sticky composer decides whether they do:

- `viewport.clientHeight` always includes the band the composer is painted over.
- `getContentBottom` walks `getMessageScrollerItems(content, spacer)`, which is the **Content** element's children less the spacer.

So a composer that is a *sibling* of Content is inside the first term and outside the second, and the reserve comes out one composer-height too tall. Working it through: a 400px viewport, a 100px composer, the last message ending at 1000, the turn anchored at scroll 844. The spacer is set to 244, and `getMessageScrollerScrollable`'s `distanceToEnd` reduces to `composerHeight - spacerHeight`. Two visible consequences, both mid-turn and neither self-correcting:

- Once the reply has drained the spacer below 100px, `distanceToEnd` goes positive and the scroll-to-latest button lights up while the reader is sitting exactly where the scroller put them.
- The handoff back to follow-bottom waits for the spacer to reach zero, which is now 100px of reply later than it should be, so the tail of the reply grows behind the composer before following resumes.

**Put the composer inside `MessageScrollerContent` as its last child instead** — before the spacer, which the Content component appends itself — and both terms measure the same box again. `getContentBottom` then includes the composer, so the reserve is measured from the composer's top edge rather than the viewport's bottom, and the same worked example gives a spacer of 144, a `distanceToEnd` of -144 with the button correctly dark, and a handoff that leaves the last message's bottom flush with the composer's top.

Being enumerated as an item is safe, and that is worth checking rather than assuming, because it is the whole reason this works. Every other helper that walks those children either skips anything without a `data-message-id` (`getMessageScrollerVisibilityState`, `getFirstVisibleMessageItem`) or looks for `data-scroll-anchor="true"` (all four anchor scans). A composer has neither attribute. It is a stable child, so the content `MutationObserver` never sees it, and `items.length` gains a constant that the append and equal-count branches both difference away.

None of this needs a library change, which is the good news: the plan's price did not go up, its DOM position moved by one level. It is also derived from reading the geometry rather than measured, so step 1 below is what confirms it.

## Approach

Move the composer back inside the scroller as `position: sticky; bottom: 0`, the last child of `MessageScrollerContent` (see above for why not a sibling of it). Nothing else about the scroller changes: same provider, same `autoScroll`, same `defaultScrollPosition`, no fork, no new props.

`MessageScrollerContent` carries `gap-2` and `pb-8` today. The gap applies to the composer like any other child, and the bottom padding becomes space between the last message and the composer rather than space above the fade, which is roughly what it was doing anyway. Both want a look rather than a calculation.

Consequences to design for, not to avoid:

- The transcript passes behind the composer while scrolling up. Unavoidable for any full-height scroll region, and fine. The composer needs a backdrop for it: either an opaque surface or a gradient fading from the surface color at the bottom to transparent at the top, which is the same single element as today's bottom fade, moved inside the scroller and made taller.
- The scroll-to-latest button and the fade are already absolutely positioned in the scroller root and keep working as-is.

Two cheap CSS borrowings while in there, each independently justified:

- `overflow-anchor: none` on the viewport. Chrome's native scroll anchoring competes with a JS-driven follow, and disabling it removes a real source of the scroller and the browser fighting over the same scroll position.
- `scrollbar-gutter: stable` so the centered content column stops shifting when the scrollbar appears.

The toolbar edge is the same change at the top (toolbar overlays the scroller, matching `padding-top` on the content) and is deliberately out of scope until the bottom edge is proven.

## Migration path

Test first. This is layout and scroll behavior, so jsdom cannot see any of it: the assertions belong in the browser project (`*.browser.test.tsx`, real Chromium).

1. Write the follow-bottom contract as browser tests against **today's** layout and confirm they pass. This is the deliverable that keeps the change from being reverted a third time, and it is worth having whether or not the layout moves.
   - Streaming appends keep the view pinned to the bottom.
   - Scroll up ~40px mid-stream, then keep appending: the view stays put, no re-arm.
   - Scroll back to the bottom: follow re-arms.
   - Composer grows several lines while pinned: still pinned, no yank.
   - Composer grows while scrolled up: the view does not move.
   - Submit lands the view at the bottom.
   - Typing in the composer never scrolls the transcript (see risks).
   - An anchored turn holds the reading line, the scroll-to-latest button stays dark while it does, and the reply hands off to follow-bottom with its last line clear of the composer. This is the set the composer's DOM position decides, and `chat-stream-anchoring.browser.test.tsx` is the harness to extend rather than a new one.
2. Flip the layout: composer becomes a sticky child of the viewport, with its backdrop. Add `overflow-anchor: none` and `scrollbar-gutter: stable`.
3. Re-run the same tests unchanged. Green means the contract held; red names the actual mechanism instead of another round of reasoning about a commit message.
4. Check the pane under UI zoom and on Windows, where scrollbar metrics and the gutter differ.

## Fallback

If step 3 goes red for a reason that cannot be fixed without touching the scroller, render a synthetic scrollbar instead: hide the native one on the viewport and paint a thumb in an element spanning the full pane, positioned from `scrollTop` / `scrollHeight`.

This reads scroll state and never writes back into layout, so there is no feedback loop and it is structurally incapable of affecting the scroller. The cost is owning a scrollbar widget: drag, wheel, hover, hide-when-not-scrollable, and a look that will not match the platform's own across macOS overlay scrollbars, Windows, and CSS `zoom`. Real cost, but bounded, which is what makes attempting the sticky version safe.

## Risks / open questions

- **Editor scroll-into-view reaching the transcript.** ProseMirror's `scrollIntoView` walks scrollable ancestors, so an editor inside the transcript's scroll container could in principle scroll the transcript while typing. The editor already owns its own `overflow-y-auto` box ([prompt-editor.tsx](../../../apps/studio/src/client/components/prompt-editor.tsx)), and sticky keeps it in view of the outer container, so the outer scroll should always compute as already visible. Covered by the last test case rather than assumed.
- **Focus revealing the composer.** Focusing an element inside a scroll container can make the browser scroll to reveal it. Sticky should make this a no-op for the same reason; worth watching for a one-frame jump on first focus.
- **Composer growth while pinned.** Growth does not change `scrollTop`, and release from follow-bottom requires `scrollTop` to decrease, so growth cannot drop the reader out of follow. The library is not told about the growth either way, but today's layout has the identical blind spot: a growing composer shrinks the scroller's `flex-1` viewport and the library does not observe that either.
- **Queued prompts and the tutorial card** sit in the same composer column and change its height. They ride along with the sticky reserve, but they are the most likely source of a visible jump and should be exercised by hand.

## Non-goals

- Not the toolbar edge. Same technique, separate change, only after the bottom edge is proven.
- Not an inverted (`column-reverse`) scroll container. Putting the scroll origin at the bottom would make the follow math independent of content and viewport height, which is a genuinely better foundation, but it means replacing the scroller and is the wrong price for a scrollbar.
- Not a change to the scroller's mode reducer or any of its thresholds.
