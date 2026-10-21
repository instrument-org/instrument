# Chat records

A chat's folder holds JSON Lines files, one record per line, with `t` naming the record.

- `<session>.<device>.jsonl`: one session's log as one device wrote it (`.2` and on once it grew long). Its records, by `t`:
  - `message`: a message, with its `role` and `id`; its words are in the `part` records that name it
  - `part`: a piece of a message, which `part.metadata.messageId` names: `text` and `reasoning` hold words, `tool-<name>` a call with its `input` and `output`, `file` a file. The newest record of a part's id is the one that stands. A path the app wrote that starts `workspace:/` is from the workspace's top level
  - `retract`: the `messages` it names are no longer in the session
  - `rollover`: the context window was reset after message `after`
  - `session`: the log's first line: `parent` and `forkedAt` on a task, a session the chat started, whose history is its parent's up to `forkedAt`, then its own
  - `sites`: the hosts the session's browser has been on, oldest first, in `visited`; the newest record stands
  - `stop`: the turn was stopped, `by` saying who: `person`, `agent` (the chat's agent stopping its task) or `app` (it quit)
  - A message's `role`:
    - `assistant`: you
    - `session-context`: what the app told you at the start, the same in every chat and no part of the conversation
    - `system`: a note the app added for you
    - `user`: the user
- `settings.<device>.jsonl`: `set` records, one per change a device made to a session, the newest of each `session` and `field` standing:
  - `archived`: whether it is archived
  - `model`: the model the chat runs on, as a model URI, set on the chat's own session
  - `starred`: whether it is starred
  - `title`: its title, in `value.text`; `value.auto` is true while the app may still rename it
  - `topic`: its topic id, the `id` in the topic's `TOPIC.md`, or `null` for none
  - `unread`: `new` or `marked` (the user marked it) while unread, `null` once read
- `blobs/`: bytes a tool returned, which its part names in a `blob` field (`sha256-<hex>.<ext>`).
