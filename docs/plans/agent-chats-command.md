Status: open.

# Agent `chats` command

Let the chat's agent organize the person's chats, so "tidy up my chats" or "file these under Travel" is something they can ask for. Every change shows up as a note in the chat that made it, with Undo.

## What exists

- The app already has the writes, as RPC routes in `packages/workspace/src/rpc/routes/chats.ts`: `rename`, `retitle`, `archive`, `unarchive`, `setProject`, `star`, `unread`, `trash`, `branch`. Each one wraps a function in `packages/workspace/src/lib/chat/chats.ts` (`renameChat`, `setChatProject`, `setChatStarred`, ...).
- The agent can only read chats, through the read-only records folder in `$INSTRUMENT_CHATS`, which it searches with its own tools. It has no command that changes a chat. The earlier `instrument chat` command (list, read, search) was deleted when the records folder replaced it, and a `chat` command was expected to come back for chat-to-chat messaging. This plan names the new command `chats`, so the two can't collide.
- Commands are capabilities: `defineCapability` in `packages/workspace/src/lib/capabilities/define.ts`, registered in `registry.ts` beside it. `memory.ts` there is the closest model: chat role only, with a role refusal for tasks.

## Commands

Each takes one or more chat ids, so one call can tidy many chats. Chat role only: a task reports back and its chat does the organizing.

| Command | Wraps | Prints |
|---|---|---|
| `chats list [--project <name>] [--archived] [--unnamed]` | `listChats` | One line per chat: id, title, project, last activity, newest first. `--unnamed` is chats whose title is still the placeholder. |
| `chats projects` | the projects list | Each project's name and id, so the agent files under one that exists without guessing names. |
| `chats rename <id> <title>` | `renameChat` | The title as stored, after `cappedTitle`. |
| `chats archive <id>...` / `chats unarchive <id>...` | `archiveChat` / `unarchiveChat` | |
| `chats project <project or none> <id>...` | `setChatProject` | A project the workspace doesn't have is refused, with the list. |
| `chats star <id>...` / `chats unstar <id>...` | `setChatStarred` | |

Left out on purpose:

- **Trash.** It is the only destructive one, and archiving covers organizing.
- **Retitle.** It is a title model call per chat, so tidying the whole list (hundreds of chats) would cost millions of tokens. The agent already has the conversation in hand and writes titles itself through `rename`.
- **Unread.** That mark belongs to the person's reading.

Renaming a chat that is working: when the route renames a working chat, its folder waits until the chat's turn ends before it moves (`followTitleBetweenTurns`, and `titlesToFollow` in `packages/workspace/src/lib/chat/retitle.ts`). The command has to take the same path; it must not call `renameChat` and then `followTitle` directly. That includes the agent renaming its own chat mid-turn.

## The note

Each change a command makes goes into a new `chatChanges` data part (an `event`, in `packages/workspace/src/schemas/session/message-data-part.ts`). It is written into the turn the same way `setupChanges` is, and drawn by `apps/studio/src/client/components/transcript/note-part.tsx`. Do not reuse `setupChanges`: its tracker (`packages/workspace/src/lib/setup-changes.ts`) works out what changed by comparing items in folders, while a chat command knows exactly what it set and what was there before.

- Each entry records the chat, the field, the value before and the value after. The note lists them grouped: "Renamed 12 chats · Archived 4 · Filed 9 under Travel". Each group opens the list of those chats, and a single chat opens the chat itself.
- **Undo** sets each field back to its value from before. It skips any field whose current value is no longer the "after" value, because the person or another device has changed it since. Settings are append-only `set` lines, so Undo just writes another one. Undo happens immediately and shows a toast, with no confirmation dialog. A title put back is settled like any typed one, since the records rank a settled title over one the app may still change: a chat the agent renamed before the app had named it keeps its old words after Undo and is not named again.
- Copy follows the UI copy rules in `CLAUDE.md`. Wireframe the note before building it (`wireframe` skill).

## Agent text

The command's `help` text says what the command is for. The chat prompt gets at most one line telling the agent that `chats` exists. Don't add guidance on how to organize; let evals show whether it's needed.

## Steps

1. `chats list` and `chats projects`, with tests over a fixture workspace.
2. The write commands, each going through the same function its RPC route calls, with a test per command (and the working-chat rename case).
3. The `chatChanges` part, written from the commands, with a schema test and a `note-part.test.tsx` case.
4. Undo: an RPC route that takes the note's entries, with a test for the skip-if-changed rule.
5. Drive the app: ask a chat to file three chats under a project and archive two, then check the note, its links and Undo (`validate-changes` skill).
6. Eval, only with approval: "file my trip chats under Travel" and "archive everything older than a month that I never came back to", on Haiku 5.5 with 3 repeats (`workspace-evals` skill).
