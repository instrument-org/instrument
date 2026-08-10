# The transcript column jumps while a turn runs

**Status:** open, instrumented but not diagnosed. Recorded 2026-08-10. The measurement below exists and is committed; the cause has not been isolated and nothing fails when it happens.

## Context

While a turn runs, the transcript follows its own end. Watching a real session, the column visibly jumps up and down as steps arrive — reported as worst on **runs of tool calls the agent never named**, not on declared activities ([grouped-activities.md](../plans/active/grouped-activities.md) is the design those two shapes come from).

The important thing to be clear about: **the end of the transcript is pinned, so the end is not what moves.** Everything above it moves to keep it pinned. A frame that draws *less* than the frame before it pulls the whole column down, and a frame that draws more pushes it back. So the symptom is a scroll position oscillating, and the cause is a height oscillating.

Recorded because the instrument is worth knowing about before anyone re-derives it, and because the obvious detection rule is wrong in a way that is not obvious.

## What is built

**A bottom-edge marker on the playback page**, `/debug/components/playback`, behind the "Edge" toggle ([use-transcript-edge.ts](../../apps/studio/src/client/routes/_app/debug/-playback/use-transcript-edge.ts), [transcript-edge.tsx](../../apps/studio/src/client/routes/_app/debug/-playback/transcript-edge.tsx)). It draws a line where the last row ends and reports three numbers, in the overlay and again in the sidebar:

- the height of everything the transcript drew, the scroll frame's own padding aside
- what that height did **since the previous frame**, keyed by frame index rather than by the last resize — a frame measures several times as fonts, images and the scroller settle, and only the last of those is that frame's answer
- the gap from the last row to the bottom of the frame, which is what "scrolled to the end" actually means

A negative delta is the event being hunted. It is coloured for that reason and nothing else.

Two things about the measurement that cost time to find:

- **It reads the content box less its own padding, not the last child.** The scroller puts elements of its own at the end of the content, so `lastElementChild` is not the last row. The first version did that and reported a height of `-24px`.
- **Its tests are browser tests, not jsdom.** jsdom has no layout engine, so every box is zero tall and every measurement agrees with every other: a jsdom test here passes whether or not the code works. This is the case `apps/studio/CLAUDE.md` reserves the browser project for, and it caught the bug above on first run.

**A finished turn's footer can be drawn rather than revealed on hover**, via `alwaysShowFooter` on `ChatStream` threaded to `alwaysVisible` on `AssistantMessagesFooter`. The playback page sets it. The product still reveals on hover — this is a prop and not a change of behaviour, because a page measuring column height cannot hover, and a band of blank it cannot fill in reads as a bug in the transcript.

## What is suspected, and not yet shown

The footer is the leading candidate. `shouldRenderFooter` in [chat-stream.tsx](../../apps/studio/src/client/components/chat-stream.tsx) depends on `lastAssistantMessageHasVisibleParts`, which is computed from the last assistant message's *visible* parts — and in an unannounced run the fold changes which of those are visible. So the footer can appear and vanish between consecutive frames, which would oscillate the height by its own height. That matches the report being about unannounced runs specifically.

**This is a hypothesis with an instrument pointed at it, not a diagnosis.** Nobody has yet stepped a scenario frame by frame and confirmed the delta flips sign as the footer comes and goes.

## The detection rule that looks right and is not

The tempting invariant is "the column never gets shorter". It is wrong: **the transcript shrinks on purpose.** An unannounced run collapsing to its generated heading is a deliberate reduction, and so is a phase folding away when the next one starts. Asserting a monotonic height fails on the feature working correctly.

The usable rule has to separate a fold from a defect. Two candidates, neither tried:

- a shrink must coincide with a group settling, which the layout pass already knows
- a shrink of about one row is a fold; a shrink of several is not

Getting that boundary right is most of the work in any automated check, and it should be decided deliberately rather than by picking a threshold that makes the current scenarios pass.

## Where detection would go, cheapest first

**At the layout level, in node.** `buildTranscriptLayout` already decides what is visible for every frame and `buildFrames` already produces every frame, so a plain test can walk consecutive frames and ask whether anything visible in frame N is missing from frame N+1. That covers the whole class described here — a footer flipping, a fold flipping, the planning row flapping — in milliseconds, with no DOM, and it names the row that vanished rather than reporting a pixel count. This is where to start.

**At the pixel level, in the browser project.** Playing every frame through Chromium and checking the height catches what the layout pass cannot see: spacing, a wrapper's margin, a row that renders taller than its rules imply. It is the expensive tier — five scenarios, several hundred frames each — and worth reaching for only once the cheap one is exhausted.

**A recorded trace, in the page itself.** Watching a number at 25 steps/s does not work, and scrubbing backwards compares against a frame that may never have been visited. Recording the height for every frame on one play-through and marking the shrink frames in the timeline would turn a scenario into a map of where it misbehaves: play once, then jump to each offender. It is also most of what the two tiers above need, since by then the per-frame trace exists.

## Related

- [grouped-activities.md](../plans/active/grouped-activities.md) — the folding rules the heights come from, and the playback page itself
- [full-height-transcript-scrollbar.md](../plans/active/full-height-transcript-scrollbar.md) — separate goal, same scroller, and it carries the constraint that follow-bottom behaviour must not regress
