# Edit a user message in place (rewind + rerun)

## Goal

Let a user edit one of their own past messages in the chat. Saving rewinds the conversation to that message and re-runs the agent from it, **in the same task** (not a fork). Assistant messages are not editable.

## Behavior (shipped)

- Hover a user prompt bubble → subtle ring + pencil in the top-right.
- Click / activate the whole bubble → the bubble becomes the shared `PromptInput` composer (model picker, attachments, skills, etc.), prefilled with the message text and its attachments.
- Near the send button: **Discard N messages** when anything after this turn will be removed. No confirm dialog.
- Escape cancels the edit.
- Submit stops a running turn if needed, deletes this message and everything after it, creates a replacement user message, and starts a fresh agent turn.
- Files on disk are **not** rolled back (same tradeoff as branch).

## Key pieces

- RPC `workspace.message.restartFrom` → `packages/workspace/src/lib/restart-from-message.ts`
- UI: `user-message.tsx` + `PromptInput` (`discardCount`, `initialItems`, `enableWindowFileDrop`, `onCancel`) wired from `task/chat.tsx` through `chat-stream.tsx`

## Verification

- Edit a mid-conversation user message → subsequent messages disappear, agent re-runs from the edited text, task id unchanged.
- Escape writes nothing.
- Editing while the agent is running stops it, then restarts.
- Discard count matches the number of messages after the edited one.
