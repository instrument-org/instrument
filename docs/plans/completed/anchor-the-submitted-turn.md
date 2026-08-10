# Plan: anchor the turn you just sent at the top of the transcript

Status: landed. The three fork changes shipped as `@shadcn/react` 0.2.3 and all four Studio changes are in. Two details came out differently from the plan and are marked below: how anchors are marked as handled, and the reading line's value.

---

## Background / why

When the user submits, their message should move to the top of the transcript and the reply should fill in beneath it, against space the scroller reserves for exactly that. It is what other agent UIs do, and the reason to want it is not novelty: a transcript pinned to its own bottom moves on every frame the agent draws, and a transcript pinned to the turn you sent holds still while the reply grows into reserved space. It absorbs the height oscillation described in [transcript-column-jumps-while-a-turn-runs.md](../../findings/transcript-column-jumps-while-a-turn-runs.md) rather than requiring each source of it to be found and removed.

The scroller we already ship implements the whole behaviour. We have it turned off, on the strength of a diagnosis that turns out to be wrong.

## What the primitive already does

In `@shadcn/react`'s `message-scroller`, marking a `MessageScroller.Item` with `scrollAnchor` makes the controller, on that item's arrival:

- place the row at the top of the viewport less `scrollPreviousItemPeek` (default 64px, so the previous turn peeks above it)
- inflate a **tail spacer** at the end of the content, so the row can physically reach the top even though nothing follows it yet
- enter mode `anchored-to-message` and re-run the placement on every resize, so content growing or folding below does not move the anchored turn
- hand back to follow-bottom on the spacer's `>0 → 0` transition, that is, the moment the reply has consumed the reserved space and the reader is genuinely at the live edge

`defaultScrollPosition="last-anchor"` reopens a saved transcript on the last anchor, falling back to the end when the last turn already fits.

None of this needs to be built. There is also nothing to gain by updating: upstream's `message-scroller` is identical to the source our pin is built from, except for the zoom fix we already carry.

## Why it is off today, and what is actually wrong

[chat-stream.tsx](../../../apps/studio/src/client/components/chat-stream.tsx) opts out with a comment blaming the spacer: "opting into the primitive's per-turn anchor-to-top inflates a spacer and jumps the view up mid-stream as tool-call DOM churns in". The spacer is innocent. Three separate defects account for the symptom, and each is fixable.

### 1. The equal-count branch jumps to the wrong anchor

`handleContentChange` has a branch for an anchor that appears without the item count changing (a placeholder row replaced in place). It calls `getUnanchoredScrollAnchor`, which scans **from the top** for an anchor not in `handledScrollAnchorsRef`, and nothing seeds that WeakSet on the first content pass. So it lands on the first user message in the transcript.

Studio hits this on every single turn: the `TURN_WORDMARK_ID` item is removed in the same commit the first assistant item is added, and the content `MutationObserver` sees one batch with an unchanged child count.

Measured in the library's own jsdom harness, six rows with three anchors, opened at the end:

| step | scrollTop | anchored row |
| --- | --- | --- |
| opened at the end | 200 | n/a |
| user message + wordmark appended | 236 | 64px from the top, correct |
| wordmark swapped for the assistant row | **0** | 300px below the fold |

It reproduces both on a transcript that mounts with history in it and on a session streamed from empty, because an anchor arriving in the first-content pass is never marked handled either.

### 2. The anchor placement is not zoom-correct

`getElementTop` feeds `getElementScrollTop`, whose result goes to `scrollTo`, and `getContentBottom` feeds the tail-spacer height. Both add a `getBoundingClientRect` delta (on-screen px) to `scrollTop` (layout px). This is the hazard class in [css-zoom-rect-vs-layout-px.md](../../findings/css-zoom-rect-vs-layout-px.md), in different functions from the one the fork already fixed. `getMessageScrollerVisibilityState` has it too: its reading line is `viewportRect.top + scrollMargin + scrollPreviousItemPeek`, an on-screen origin plus two layout-px constants.

Measured in real Chromium, appending an anchored row to an 8-row thread in a 200px viewport:

| ancestor zoom | anchor lands at | correct |
| --- | --- | --- |
| 1 | 64px on-screen | 64 |
| 1.5 | 126px on-screen | 96 |

The error is `(zoom - 1) x distance below the fold`, so on a real pane at 2x it is tens to hundreds of pixels and can put the anchored turn well off the reading line. Studio's whole main window is under CSS `zoom`, so this blocks the feature.

### 3. Growth from a user gesture is treated as new output

Expanding a tool group while a turn runs grows the content, follow-bottom reads that as output, and the row the user just clicked is scrolled away. The fork already carries the fix for this as an unlanded commit adding `releaseAutoScroll`, and it is not in the pinned build.

## Separately: the footer at the end of a turn

The last row of a finished turn is not scrolled fully into view. The mechanism is structural, not a race:

- `AssistantMessagesFooter` is added to the DOM exactly when `!isAgentRunning`
- `autoScroll` is `isAgentAlive || isFollowingSubmit`, which drops at the same moment
- the follow path is `handleResize -> if (mode === "following-bottom" && autoScrollRef.current) scrollToEnd()`

So the footer's growth is the first growth nobody follows. It takes its height whether or not it is hovered (the reveal is opacity-only), so a row's worth sits below the fold and the scroll-to-latest button lights up at the end of every turn.

This is in scope here because anchoring changes when it matters: a turn still in `anchored-to-message` absorbs the footer into the tail spacer, so only turns that outgrew the viewport are affected. Fix it either way.

## Approach

Keep the declarative `scrollAnchor`. The anchoring decision has to run at DOM-commit time, which is where the library already sits; driving it from Studio means racing the same commit from a `useLayoutEffect`, and the imperative `scrollToMessage` gives neither the hold nor the handoff (it enters `settling-jump`, not `anchored-to-message`). Fix the library, then opt in.

### Fork: three commits, then bump the pin

The fork is `github:mutewinter/ui`, pinned by sha in [apps/studio/package.json](../../../apps/studio/package.json). Each commit needs a changeset, matching the ones already there.

**Commit 1: only jump to an anchor that arrived in place.** In `packages/react/src/message-scroller/use-message-scroller-controller.ts`, inside `handleContentChange` and after `firstItemRef` is updated:

```ts
// Anchors this pass has accounted for, so a later pass that finds an anchor
// it has never seen knows the row arrived in place rather than as an append.
const markAnchorsHandled = (from: number) => {
  for (let index = from; index < items.length; index++) {
    const item = items[index]

    if (item?.dataset.scrollAnchor === "true") {
      handledScrollAnchorsRef.current.add(item)
    }
  }
}
```

In `geometry.ts`, walk `getUnanchoredScrollAnchor` from the end instead of the start: a row that turned into an anchor in place is the turn just opened, and an older unhandled one is history the reader has scrolled past.

**What landed instead**, as `58e535765`: one `markAnchorsHandled()` with no argument, called once after `reconcileScrollPosition()` rather than at the top of two branches. The set then means exactly what the equal-count branch reads it as — every anchor this controller has already seen — so the prepend branch and the pending-scroll-flush early return are covered too, and the two `handledScrollAnchorsRef.current.add(anchor)` calls that followed a `scrollToElement` both go. The equal-count branch reads the set before the marking runs, which is what keeps the one case it exists for working.

The `geometry.test.ts` case pinning the old scan direction was rewritten to assert the last unhandled anchor.

**Commit 2: zoom-correct the rest of the geometry.** Convert rect-derived values to layout px before they meet `scrollTop`, `clientHeight`, `scrollTo`, or a spacer height. `element.currentCSSZoom` gives the effective ancestor zoom with no wiring (the same lever `patches/sonner@2.0.7.patch` uses); fall back to `rect.width / element.offsetWidth` where it is unavailable. Sites:

- `getElementTop` and `getElementViewportTop`, whose deltas are added to `scrollTop`
- `getContentBottom`, which feeds `getTailSpacerHeight` and therefore the spacer's `style.height`
- the `getBoundingClientRect().height` element heights in `getElementScrollTop`, which are subtracted against `viewport.clientHeight`
- the reading line in `getMessageScrollerVisibilityState`

Computed-style padding is already layout px and needs no correction, and a rect-minus-rect delta that never meets a layout value is safe.

Cover it with browser tests at 1, 1.5, and 2, asserting the appended anchor lands at `peek x zoom` on-screen. The 1.5x number today is 126 against a correct 96, so the test fails before the fix.

**Commit 3: `releaseAutoScroll`.** Already written on the fork as an unlanded commit (`git log --all --grep=releaseAutoScroll`). It exposes the internal user-scroll-intent transition on `useMessageScroller()`. Land it as-is.

Then push, update the sha in `apps/studio/package.json`, `pnpm install` outside the sandbox, and confirm `releaseAutoScroll` is in the installed `dist` before starting the Studio work.

### Studio: four changes

**1. Mark user messages as anchors.** In [chat-stream.tsx](../../../apps/studio/src/client/components/chat-stream.tsx), in the `renderAsItems` branch, pass `scrollAnchor={message.role === "user"}` on the per-message `MessageScrollerItem` and replace the comment that explains the opt-out. The trailing wordmark item is not an anchor. A turn is one message per step, so the user message is the only row per turn that means "a new turn starts here".

**2. Tune the reading line.** On the provider in [chat.tsx](../../../apps/studio/src/client/components/task/chat.tsx), set `scrollPreviousItemPeek` and, if needed, `scrollMargin`. The default 64px peek was chosen for a generic thread; the transcript already has 16px of content padding (which the placement math accounts for) and a 24px top fade over it.

Landed at 40, with `scrollMargin` left alone. The placement adds the content padding, so a turn comes to rest 56px from the top of the viewport: the 24px fade band, then 32px clear. The previous turn showing through the fade is what the band is for, and more than that is just a gap above the turn being read. Measured on screen at 0.5x, 1x, 1.5x and 2x as 28, 56, 85 and 112.

**3. Release follow on a user gesture.** Call `releaseAutoScroll()` from `toggleGroup` in `ChatStream`, and from any other expansion driven by a click. `ChatStream` also renders outside a scroller (nested tool-agent streams), and `useMessageScroller()` throws outside the provider, so the command cannot be read by a hook in `ChatStream` itself. `TaskChat` renders the provider, so its own hooks are above it too. Pass it down: a small component rendered inside `MessageScrollerProvider` reads `useMessageScroller()` and hands `ChatStream` an optional callback, the same shape as the existing `ScrollToEndBridge`.

**4. Give the turn a moment to settle.** Keep `autoScroll` armed briefly after `isAgentAlive` goes false, so the footer arriving at the end of a turn is followed like any other growth. Mirror the existing `SUBMIT_FOLLOW_TIMEOUT_MS` shape with a second flag and a much shorter constant. With change 3 in place, a user expanding something during that window still releases follow, which is what makes the window safe.

## Verification

jsdom cannot see any of this: no layout engine, so every box is zero tall and a test passes whether or not the code works. Everything below is the browser project (`*.browser.test.tsx`, real Chromium), per [apps/studio/CLAUDE.md](../../../apps/studio/CLAUDE.md). Confirm each test fails against the unfixed code before keeping it.

In the fork: the zoom placement tests above, plus the existing suite green.

In Studio:

- submitting places the user message at the reading line
- the wordmark-to-assistant swap does not move it (the regression this plan exists for)
- a group folding mid-turn does not move it
- a reply that outgrows the viewport hands off to follow-bottom, and keeps following after that
- at the end of a turn the footer is fully within the viewport
- expanding a tool call mid-turn leaves the clicked row where it is

By hand, once, in one session rather than six: a real turn at zoom 0.5, 1, and 2; a reopened task; a queued follow-up dispatching while the previous turn ends. See [.agents/skills/validate-changes/SKILL.md](../../../.agents/skills/validate-changes/SKILL.md) for which harness answers what.

### What is covered, and what is not

`chat-stream-anchoring.browser.test.tsx` covers the placement and the wordmark swap together, in real Chromium. It was confirmed to fail against the previous build, where the turn goes from 80px below the top of the viewport to 1197px below it. Its row-count assertion is load-bearing: an unchanged count is what sends the change through the in-place branch, so without it the test would pass by exercising the append path instead.

`chat-stream.test.tsx` covers which rows carry the anchor, and that a group toggle releases follow before it grows anything. Both are DOM facts rather than measurements, so they belong in jsdom.

A real turn was driven in the running app at 1x and 2x and held at the reading line while the reply streamed; the placement alone was probed at 0.5x and 1.5x. Not covered by a test: the handoff to follow-bottom when a reply outgrows the viewport, and the footer at the end of a long turn. Both are the scroller's own behaviour and both have coverage in the fork's suite, but neither has been seen through Studio's wiring.

## Risks and open questions

- **A short reply leaves reserved blank below it.** That is the feature working, and it is what makes the turn hold still, but it is the most likely thing to read as a bug in review. The spacer collapses on the next content change, on `scrollToEnd`, and on the scroll-to-latest button.
- **The composer moving inside the viewport now conflicts.** [full-height-transcript-scrollbar.md](full-height-transcript-scrollbar.md) proposes a sticky composer inside `MessageScrollerViewport`. This landed first, so that plan is the one that has to account for it, and the arithmetic is worked out under "What anchoring costs this plan" there.
- **A batch of user messages.** `hasMultipleNewScrollAnchors` deliberately keeps following the end rather than anchoring the first of a batch. Worth confirming that a queue dispatch that lands two prompts in one commit behaves sensibly.
- **`ScrollToEndBridge` on submit.** It forces the end (spacer to 0, mode to following-bottom) and then the arriving user message anchors, so there are two movements in quick succession. Keep it at first, since it is the only thing that recovers a reader scrolled far back if the message never arrives, and watch whether the double move reads badly.
- **`defaultScrollPosition="last-anchor"`.** Reopening a task on the last turn rather than the last pixel is a real improvement and is one prop, but it changes restore behaviour for every task. Take it as a follow-up with its own look, not folded in here.
- **Turn model.** [chat-stream-turn-model-refactor.md](chat-stream-turn-model-refactor.md) would make a turn a single row, at which point the anchor is the turn rather than the user message inside it. Nothing here blocks that, and the `scrollAnchor` opt-in moves with the row.

## Non-goals

- Not an imperative anchoring API. Add one only if anchoring on the store round-trip proves visibly late, and then as "anchor this message and hold it", not as a raw `scrollToMessage`.
- Not the height oscillation itself. Anchoring absorbs it; the finding stays open and the instrument stays useful.
- Not the composer or the scrollbar edge. Separate plan, same scroller.
