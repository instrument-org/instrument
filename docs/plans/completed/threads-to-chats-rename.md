# Plan: rename threads to chats

Status: landed. The code says chat wherever the product does; what real workspaces and older transcripts still hold under the old word is migrated or read under both names, as listed below.

## Why

The product calls a conversation a **chat** everywhere the person looks, but the code said **thread**, left over from the channels-to-threads change: `orchestrator.threads.*` RPC routes, `Thread`/`ThreadSchema`, `lib/orchestrator/threads.ts`, `thread-*.tsx` components in `apps/studio/src/client/components/orchestrator/`, atoms and hooks, task state keys (`threadSeen`, `taskThreads`, `appThreads`), and text the agent reads ("Other threads in the user's chat", the Threads prompt section, `running[].thread`). Two words for one thing made every change in this area harder to read, and the agent-facing wording reaches the model.

## What was done

- One pass over routes, schemas, types, files, components, atoms, hooks, tests, and comments. "Thread" stays only where it means something else: a worker or main thread, an email or forum thread.
- The per-chat record already had the word: `lib/orchestrator/chats.ts` (making and listing a chat's record folder) became `chat-records.ts`, and the list, state, and marks of the chats took `chats.ts`. `Chat.taskId` names the chat's record, which is a task; a chat's own id is its session id.
- The RPC routes merged into one `orchestrator.chats` router: `list`, `live.list`, `archive`, `unarchive`, `star`, `seen`, `unseen`, `rename`, `retitle`, `setTopics`, beside the record's `ensure`, `of`, and `trash`.
- The screen is at `/orchestrator/chats/$id`, and a Tasks screen names its chat with `?chat=`.
- Agent-facing text: the Chats prompt section, the other-chats and topics notes, the view note, and the `chat` command, whose listing is `chat list` (it was `chat threads`). Checked on three Workers AI models (GLM 5.3 Flash, Qwen3.8 27B, Kimi K2.6) with an ad-hoc orchestrator eval asking what other chats the user has: each reached for `chat list` on its first step.

## What is migrated, and what is read under both names

- **Stored message parts** (`store-migrations.ts`, "chat parts say chat"): `data-threadContext` becomes `data-chatContext` with `threads` renamed `chats`, `data-threadTopics` becomes `data-chatTopics`, and a view note's `screen: "thread"` and `thread` field become `chat`.
- **Task state** (`migrateTaskState`): `threadSeen` and `appThreads` are read as `chatSeen` and `appChats` and written back under the new names only. `taskThreads` keeps its name: it is the one-conversation layout's map, which nothing writes and only `migrate-to-chats` reads, and the schema carries it so a write does not drop it before that migration finishes.
- **Memory files**: a memory saved before the rename names its chat as `thread:` in its frontmatter; the reader takes either key, and a save writes `chat:`.
- **Links in transcripts**: `instrument://thread/<id>` still opens the chat, as an alias beside `instrument://chat/<id>`, because replies written before the rename carry it.
- **The 2.0 window's `localStorage`** (`client/lib/rename-chat-storage.ts`): saved tab addresses, `?thread=` queries, and small views' `kind: "thread"` under `orchestrator.*` keys are rewritten before the window's atoms load.

## Left for later

- `chat list` includes the chat it is run from, and all three models in the eval paused over their own chat in the listing before concluding it was the only one. Marking the current chat in the listing, or leaving it out, would save that step.
