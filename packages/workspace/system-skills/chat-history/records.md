# Chat records

A chat's folder holds JSON Lines files, one record per line, with `t` naming the record.

- `<session>.<device>.jsonl`: one session's log as one device wrote it (`.2` and on once it grew long). Its records, by `t`:
  - `message`: a message, with its `role` and `id`; its words are in the `part` records that name it
  - `part`: a piece of a message, which `part.metadata.messageId` names: `text` and `reasoning` hold words, `tool-<name>` a call with its `input` and `output`, `file` a file. The newest record of a part's id is the one that stands. A path the app wrote that starts `workspace:/` is from the workspace's top level
  - `retract`: the `messages` it names are no longer in the session
  - `rollover`: the context window was reset after message `after`; `windows` says, by model, whether that still holds (`lifted` when the model has room for everything). The newest record stands
  - `session`: the log's first line: `parent` and `forkedAt` on a task, a session the chat started, whose history is its parent's up to `forkedAt` (with the parent's baseline as the task began, wherever its id sorts), then its own, and `startedAs`, the title it was started with
  - `sites`: the hosts the session's browser has been on, oldest first, in `visited`; the newest record stands
  - `stop`: the turn was stopped, `by` saying who: `person`, `agent` (the chat's agent stopping its task) or `app` (it quit)
  - `ask`: something the chat waits on the person for, whole in `ask`: a `permission` for a folder, app or tab (`on`, `target`), a `question` (a `choose` call), or a `sign-in` (a `connect_app` call), written by the computer it belongs to (`ask.device`) and only there; the newest record of an ask's `id` stands, and its `stage` says where it is: `open`, `taken` (the answer it took), `waiting` on the system with the yes given, or `closed` with its `outcome` and whether its askers were `woken`
  - `answer`: a device's answer to the ask `ask` names, the device being the log's, in `given`: a permission's `allowed`, `always` or `declined`, a question's replies, a sign-in's Not now, the first fresh one in the logs winning, or `stopped`, a Stop that took the `askers` entries it names (each a `sessionId` and the `at` the ask gave it) off it
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
  - `project`: its project id, the `id` in the project's `AGENTS.md`, or `null` for none
  - `unread`: `new` or `marked` (the user marked it) while unread, `null` once read
- `blobs/`: bytes a tool returned, which its part names in a `blob` field (`sha256-<hex>.<ext>`).
  - `derived-sha256-<hex>-<how>`: an image as a request sends it, made once from the bytes `<hex>` names, so every later request sends the same bytes.
