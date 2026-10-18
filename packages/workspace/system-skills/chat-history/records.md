# Chat records

A chat's folder holds JSON Lines files, one record per line, with `t` naming the record.

- `<session>.<device>.jsonl`: one session's log as one device wrote it (`.2` and on once it grew long). Its records, by `t`:
  - `message`: a message, with its `role` and `id`; its words are in the `part` records that name it
  - `part`: a piece of a message, which `part.metadata.messageId` names: `text` and `reasoning` hold words, `tool-<name>` a call with its `input` and `output`, `file` a file. The newest record of a part's id is the one that stands
  - `retract`: the `messages` it names are no longer in the session
  - `rollover`: the context window was reset after message `after`
  - `session`: the log's first line: `parent` and `forkedAt` on a task, a session the chat started, whose history is its parent's up to `forkedAt`, then its own
  - `state`: a standing fact the app keeps, `what` naming it
  - `stopped`: the turn was stopped, `by` saying who stopped it
  A message's `role`:
    - `assistant`: you
    - `session-context`: what the app told you at the start, the same in every chat and no part of the conversation
    - `system`: a note the app added for you
    - `user`: the user
- `marks.<device>.jsonl`: `mark` records, the newest of each `field` standing:
  - `archived`: whether it is archived
  - `starred`: whether it is starred
  - `stoppedAt`: when the user stopped its turn
  - `title`: its title, in `value.text`
  - `topics`: its topic ids, the `id` in each topic's `TOPIC.md`
  - `unread`: whether it is unread
- `blobs/`: bytes a tool returned, which its part names in a `blob` field (`sha256-<hex>.<ext>`).
