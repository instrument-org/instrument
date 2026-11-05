# Whether the Worked row's line earns its model call

**Status:** open · **Check after:** 2026-11-26 · **Last checked:** never

## What we're waiting to learn

A finished turn with work now makes one more model call, on the chat's own model at low effort, for the line its Worked row reads (`lib/chat/work-summary.ts`). We want to know what that costs across real use, how often the line lands before the turn folds at four seconds, and how often the row is left saying how long the work took. A bench on real turns put the call under a second at the median on Haiku 5.5 and about 3 seconds at the 90th percentile, but slower models and the Claude account's harness were not measured. The commit that adds it is `workspace: write the line a finished turn's work folds into`.

## The signal

- Activity rows with the purpose `work-summary`: their count, cost and duration, against the `chat` rows of the same chats. The Activity view has a column for the purpose, and each device's activity log records it.
- A `data-workSummary` part's `createdAt` against the `finishedAt` of the assistant message it sits on. Over four seconds means the row said "Worked for" first and changed under the reader.
- A finished turn whose rows fold with no `data-workSummary` part means the call failed or its answer was thrown away.
- No rows at all means no turn with work has finished on that build, which says nothing about what the call costs.

## Where to look

The Activity view and the `activity/` logs under `.instrument/devices/` in a workspace in daily use, and the records of its recent chats (the `chat-database-query` skill reads them).

## What each answer means

- The cost is a small share of the chat's own and the line usually lands in time: keep it as it is.
- The line is usually late on one provider: raise `FOLD_WAIT_MS` if the wait reads well, or move that provider's call to a faster model.
- The cost is noticeable on metered models: add the setting it was expected to need, or skip the call for a turn of a single step, where the activity's own words already say it.
- Turns often end with no line: read the failures in `captureException` under the `work-summary` area, and check whether answers are being thrown away by `summaryFrom`.

## Result

Not checked yet.
