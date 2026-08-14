# Edit a user message in place (rewind + rerun)

## Goal

Let a user edit one of their own past messages in the chat, Save or Cancel. Saving rewinds the conversation to that message and re-runs the agent from it, **in the same task** (not a fork). Assistant messages are not editable.

Behavior:

- Hover a user message -> pencil affordance. Click -> the bubble becomes an editable field prefilled with the message's current text; Save / Cancel.
- **Save**: overwrite that user message's text in place (keep its id), delete every message after it, then start a fresh agent turn from it.
- **Cancel**: discard the edit, no writes.
- Only allowed when the agent is idle for that session.

## Decided scope

- **Rewind-in-place**, not fork. (Fork already exists as "branch"; see the branch feature in `packages/workspace/src/lib/branch-task.ts` and the footer action in `apps/studio/src/client/components/assistant-messages-footer.tsx`, commits `e30d6c917` / `51dbb81df`.)
- **Files on disk are NOT rolled back.** The rerun happens against the current working tree, same accepted tradeoff as branch. No snapshot/restore work.
- Edit text only. Keep the message's attachments and existing parts.

## Why this is mostly easy

The data model is a flat, ULID-ordered linear list of messages per session in `task.db` (KV store). Because we truncate everything after the edited message first, that message becomes the tail again, so ordering stays valid with no schema changes. The truncation primitives already exist and are proven by the branch feature.

## Key files & primitives

Store (all in `packages/workspace/src/lib/store.ts`):

- `Store.getMessageWithParts({ messageId, sessionId, taskId })` — read current text.
- `Store.getMessageIdsAfter(sessionId, messageId, taskId)` — messages after M.
- `Store.removeMessage(messageId, sessionId, taskId)` — delete a message + parts.
- `Store.saveMessageWithParts(message, taskId)` / `Store.savePart` / `Store.updatePart` — overwrite the edited message's text part in place.

Schema: `packages/workspace/src/schemas/session/message.ts` (user role, parts), `.../message-part.ts` (text part), `.../store-id.ts` (ids).

Send / agent-start path (the piece to decouple):

- RPC `message.create` in `packages/workspace/src/rpc/routes/message.ts` (~L47) — today this builds a NEW user message (`packages/workspace/src/lib/new-message.ts`) AND kicks off the agent turn.
- Session machine `packages/workspace/src/machines/session.ts` runs the agent; `packages/workspace/src/lib/prepare-model-messages.ts` builds model messages from stored messages. Find the event that starts an agent run for the current tail.

UI:

- `apps/studio/src/client/components/user-message.tsx` — user bubble; already has a per-message hover row (~L105-120: RelativeTime + CopyButton). Add the edit affordance here.
- Inline-edit reference: `useInlineRename` (`@/client/hooks/use-inline-rename`) + `InlineRenameInput`, used for task-title editing in `nav-task-item.tsx` / `project-task-row.tsx`. Consider reusing the composer/prompt input for a nicer multiline edit.
- Retry precedent: `handleRetry` in `apps/studio/src/client/components/task/chat.tsx` -> `createMessage.mutate` -> `message.create`.

## Implementation steps

1. **Backend RPC** `message.editAndRerun` (or `message.update` + a rerun) taking `{ taskId, sessionId, messageId, text }`:
   - Guard: session must be idle.
   - Overwrite the message's text part(s) in place (same message id).
   - `getMessageIdsAfter(sessionId, messageId)` -> `removeMessage` each.
   - Start an agent turn from the current tail. **This is the one non-trivial part**: `message.create` couples message-creation with turn-start, so factor out (or find) a "start turn on existing tail" path into the session machine and call it here. Investigate how `message.create` signals the machine and reuse that signal without creating a new message.
   - Decide whether to recompute the per-turn data parts on the edited message (paneTabs / projectContext / browserStatus from `new-message.ts`). Leaving them stale is acceptable for v1.

2. **UI** in `user-message.tsx`:
   - Add an edit (pencil) button to the hover row, gated on session idle.
   - Local `isEditing` state -> render an editable field prefilled with the text; Save calls the RPC, Cancel resets.
   - On Save success the live message stream will re-render the truncated conversation and the new streaming turn; no manual cache surgery needed (mutations publish `message.updated` / `message.removed`).

## Verification

- Edit a mid-conversation user message -> everything after it disappears, agent re-runs from the edited text, task id unchanged.
- Cancel writes nothing.
- Edit disabled/hidden while the agent is running.
- Files on disk are untouched by the rewind (expected).

## Open decisions for the implementer

- New dedicated RPC vs. extend an existing message route.
- Whether to recompute per-turn data parts (default: no).
- Multiline editor: reuse the composer vs. a lightweight inline textarea.
