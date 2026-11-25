# Edit a user message in place

Status: done. Built as below.

A person edits a message they sent where it stands. Sending it takes the old message and everything after it out of the conversation, and the agent answers the new one in the same chat. The old message and what followed it can still be looked at, and a reply in it can be branched into a chat of its own.

## How it works

- The new version is an ordinary new message. Its metadata's `earlierVersions` lists each message it was before, oldest first.
- A `retract` record whose `edited` names the old message takes out that message and all that followed it. A build that does not know `edited` still takes them out.
- The fold hands out only the conversation as it stands, so its readers need no change. What an edit took out is in `FoldedSession.earlierVersions` by the edited message. A context rollover at a message an edit took out no longer counts, and the newest one left stands.
- The current version is always the newest edit, so nothing records which version is up: looking back is the window's own state.
- `beginEdit` (`packages/workspace/src/lib/chat/edit-message.ts`) stops the chat's turn and the tasks started since the message, closes their asks, and waits for them to wind down. Background processes, files and anything sent stay as they are, and the new message carries a note telling the agent so.
- The new message is built with the chat read as though the old ones were gone (`asThoughTakenOut`), so it tells the agent again what only they told it.

## Limits

- A message the agent has not read yet cannot be edited.
- Two computers that edit the same message before reading each other's records leave both new versions in the conversation, as two sends do.
- Only this computer's turns are stopped. Work another computer is doing in the chat goes on.
- Handoff notes written at a rollover that an edit took out stay as written.
- A task started after the message reads less of its chat's history once the edit takes it out, since a task reads its chat's messages as they stand.
