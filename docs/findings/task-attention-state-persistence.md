# Task attention state (unread / needs-input) must be persisted per task, not derived from live status

**Status:** open — design guidance. Recorded 2026-07-08 while building the
unread-indicators feature (FP-1161) and reviewing the `jmack/connectors-v1`
spike. Last updated 2026-07-08.

## Context

Two features want to surface a task's "attention" state in the sidebar/tab list
without opening the task:

- **Unread on completion** (this branch): show a dot when an agent finished a
  task the user hasn't looked at yet.
- **Needs input / paused** (`jmack/connectors-v1`): show that the agent is
  waiting on the user (e.g. a connector credential / OAuth prompt).

The question that came up: should that list-surfaced state be **derived from the
messages** (the conversation is the true record) or **read from a small
persisted per-task indicator**?

## What we found

- **Agent run/pause status is live-only.** `getTaskAgentStatus` reads in-memory
  `sessionRefsByTaskId`; on restart that map is empty and sessions are not
  rehydrated. So "running" / "paused" **does not survive an app restart**.
- **`connectors-v1` represents "needs input" from that live state** (an
  `agent.paused` tag + an interactive tool-call message part) and persists
  **nothing** queryable — no field on task settings, the `Task` schema, or the
  task-state store. Its in-task view survives restart (the prompt is a persisted
  message), but any **sidebar/list** surfacing built on the live pause tag would
  go blank after a relaunch.
- **Reading every task's message history to paint the sidebar is a non-starter**
  (cost). So the list needs a cheap, denormalized signal.

## Decision / guidance

- **Messages remain the source of truth** for what happened. The per-task
  indicator is a **denormalized projection** of that truth, existing only so the
  list can render done-unread / needs-input / error cheaply and durably.
- **Keep the projection persisted per task** (this branch: `unreadIndicator` on
  `settings.json`, the same per-folder pattern as pins). It survives restart and
  is an O(tasks) scan, not an O(messages) one.
- **Keep the discriminated shape** — `unreadIndicator: { kind: "completed" |
"question" | "error" }`. A review pass flagged `kind` as speculative (only
  `"completed"` is produced today) and suggested collapsing it to a boolean.
  We are **not** collapsing it: `connectors-v1` makes a second real kind
  (needs-input) imminent, and it belongs in this same store. The discriminator
  is the seam for that, not dead generality. "indicator" (a family of states) is
  the right vocabulary, not "unread".
- **Write the projection on the same server-side transition that changes the
  real state**, so it can't drift and outlives the process (done →
  `kind: "completed"` on the root `session.done`; pauses-for-input →
  `kind: "needs-input"`; user answers / resumes → clear). These transitions live
  in the session/workspace machines, which is exactly why they can write durably
  where the live tag cannot.

## Open problem (shared by both features)

**Restart while an agent was mid-run** — not paused, not done. Live status is
gone and there may be no terminal `session.done` to have written anything.
Decide what the projection should say then; likely reconcile on boot from the
last persisted turn/message state. This reconciliation is the genuinely hard
part and is shared by unread and needs-input — another reason for **one**
attention store rather than a second live-status-based mechanism on
`connectors-v1`.
