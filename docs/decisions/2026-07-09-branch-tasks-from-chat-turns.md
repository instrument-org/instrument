# Branch tasks from chat turns

## Context

Duplicating an entire task could not express the common intent to continue from
an earlier point in its conversation. It also made branching look like a task
management action instead of a choice made at the relevant assistant turn.

## Decision

Task branching starts from an assistant message. The new task keeps the source
conversation through that message and receives a copy of the source task's
working files and state. The source remains unchanged.

The UI exposes this as "Branch from here" on assistant turns, not as a
whole-task duplicate action.

## Consequences

The branch operation copies the task database, removes later messages, and
clears file-index baselines so the branched task establishes its own first-turn
file state. Task-private files are not copied wholesale.

## Implementation

- [Branch task operation](../../packages/workspace/src/lib/branch-task.ts)
- [Assistant message footer](../../apps/studio/src/client/components/assistant-messages-footer.tsx)
- [Commit 73a76c106](https://github.com/instrument-org/instrument/commit/73a76c1064ac582a027479332ff3080107c6d53a)
