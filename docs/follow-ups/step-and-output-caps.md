# Whether the unattended-step and output-limit caps ever trip

**Status:** open · **Check after:** 2026-11-21 · **Last checked:** 2026-10-24

## What we're waiting to learn

Two caps were set by judgment, and only a run that reaches one can say whether it was set right:

- A run may take 500 unattended steps before it stops to ask (`UNATTENDED_STEPS`, `packages/workspace/src/machines/session.ts`, e7fa1dc9c). Its commit: "whether 500 is far enough out, which only a run that reaches it will say".
- A reply cut off by the provider's output limit continues at most twice (`MAX_OUTPUT_LIMIT_REPLIES`, `packages/workspace/src/lib/output-limit-run.ts`, 1dfcaa39e). No real provider had been seen cutting a reply off when it shipped.

## The signal

In chat records, a part of type `data-maxSteps` (the step cap hit) or `data-outputLimit` (the continuation bound hit), and assistant messages whose `finishReason` is `length`. Scan every session file under the workspace's `.instrument/chats/`, read-only.

## Where to look

The primary Mac's workspace records, and any beta tester's records offered for a report.

## What each answer means

- **`data-maxSteps` in a run that was doing useful work:** 500 is too low for that kind of task. Read the run before raising it.
- **`data-maxSteps` in a run that was looping:** the cap did its job. Note what the loop was.
- **`finishReason: length` that continued and finished:** the continuation works. Record which model and provider cut it off.
- **`data-outputLimit`:** a reply needed more than three pieces. Read whether a third continuation would have finished it.
- **Nothing by the check date:** close it. Both caps stay in place as backstops.

## Result so far

2026-10-24, the primary Mac's 398 chats: no `data-maxSteps`, no `data-outputLimit`, and no `finishReason` of `length`. The caps were only a week old, so this says little yet.
