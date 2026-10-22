# Plan: everything visible in the Instrument folder

Status: built and landed, apart from the items marked still to build in the table at [Phases](#phases). Follows the records phases of [chat-records.md](chat-records.md).

F1 is built, down to the delete screen's box and a sync engine's conflict copy of `CHAT.md` deleted on sight. F2 is built apart from `Drafts/` being a folder the agent reaches, which waits for every workspace to be a folder the person picked. F3 is built: an attachment is opened where it lies on all three systems, the copy and `$INSTRUMENT_ATTACHMENTS` are gone, and the migration moves what old chats hold. F4 is built apart from two paths still open inside `.instrument`, which the same wait closes; a test pins that set so it can only shrink deliberately. F5 and F6 are built, F6 down to every stored path being written where its folder went. What is left is per phase and in the table at [Phases](#phases): mostly the gestures each asks to be driven on the three systems.

The rehearsal over a real 1.x install passes whole, and Windows and Linux each migrated their own workspace at a first launch.

The Instrument folder becomes something a person can open in Finder, Spotlight or Obsidian: a folder per chat with its transcript as Markdown and what the agent made, their drafts, topics, memories, skills and apps as plain files. The app's records stay in the hidden `.instrument/`, which ends fully closed to the agent. Attachments stop being copies: what the person hands over from disk is opened to the chat where it lies.

Supersedes [chat-attachments-by-reference.md](chat-attachments-by-reference.md) (its finding that libuv does not clone on macOS still holds for the one copy left, pasted content). Folder choice at first launch belongs to [choose-where-instrument-keeps-files.md](choose-where-instrument-keeps-files.md) and the onboarding work; this plan keeps Settings › Storage's move as the way to choose for now.

## Decisions

- Six visible folders at the top: `Chats/`, `Drafts/`, `Topics/`, `Memory/`, `Skills/`, `Apps/`. Each is found by its name; a folder inside one is read through one capitalized file (`CHAT.md`, `DRAFT.md`, `TOPIC.md`, `SKILL.md`, `APP.md`), and a folder without it is not Instrument's.
- No `Archive/`: an archived chat's folder stays in `Chats/`, and archive stays a mark.
- The records stay in `.instrument/`, filed by id, and are the truth. Nothing in a visible folder is read back as a record, except the capitalized files the person may edit (`DRAFT.md`, `TOPIC.md`, `SKILL.md`, `APP.md`, memories).
- `.instrument/` is closed to the agent with no exceptions once this lands: no attachments, handoff notes, skills or apps inside it.
- Finder gestures never change a chat's words, its title or its marks. A chat folder renamed in place is followed, because its `CHAT.md` links to the chat, and the next write of the chat's folder and the shell's lookup of it read that link from any folder under `Chats/` no chat claims. A moved or deleted one is not followed, and the chat's next change makes a fresh one. Topic, draft, memory, skill and app folders keep working when renamed, because they are found by their capitalized file and its `id`.
- Attaching a file or folder from disk opens the original to that chat, whatever Settings says for it; so does a folder picked on a card. Asking in words still respects Not allowed. A file opened in the app's viewer is not granted.
- Pasted content (an image, a screenshot, a file a web page hands over as bytes) is saved once, and that file is the original.
- `Drafts/` is open to the agent like the rest of the folder: its path says what it is.
- Onboarding is out of scope.

## The tree

```
Instrument/
  Chats/<title>/
    CHAT.md                 the transcript, rewritten by the app when a turn ends and when the person sends a message
    attachments/            what the person pasted, saved on Send
    handoff-notes.md        the agent's notes for when its context runs out
    …                       what the agent and its tasks made ($INSTRUMENT_OUTPUT)
  Drafts/<date>/
    DRAFT.md                id, created, topic, chat (for a reply); the words below
    …                       what the person pasted into the draft
  Topics/<Name>/TOPIC.md    id, emoji, about, color, created, retired; the instructions below
  Memory/<name>.md          one memory per file
  Skills/<name>/SKILL.md    the workspace's own skills
  Apps/<name>/APP.md        the manifest as front matter; the guide and the person's instructions below
  .instrument/              records (chat-records.md), closed to the agent
```

On this computer, per workspace: a topic's granted folders and a chat's grants move into `permissions.json` (they name this computer's paths); `state.json` gains the key folders that should exist; window tab pointers to drafts go by draft id in the window's `layout.json`.

## `CHAT.md`

- Rendered from the fold, deterministically, so two renders of the same records are the same bytes. Written whole through a temp name (`.~CHAT.md.tmp`) and a rename, by the device running the chat, at the chunky moments only: when the agent's turn ends, when the person sends a message, and when a title settles. It is a convenience copy and may be a moment out of date; nothing at launch reads a chat to check it. Edits to it do not last, and a sync service's conflict copy of it is deleted when the folder is next written.
- Front matter: `started`, `topics` (names), and nothing listing files, pages or apps. First line of the body: an "Open this chat in Instrument" link, `instrument://chat/<id>`. No heading above it: the folder is named for the chat.
- A heading per day and per message. What a person sees in the chat stays visible: messages, cards with their answer, files, a model switch. The work between two visible messages folds into one HTML `<details>` whose summary says how long it ran to the second and what it did ("Worked for 14s · read kyoto.md · edited kyoto.md twice"), holding plain `<pre>` lines: reasoning, each call's label with what it touched under it (the command, the file from the workspace, the query and the sites, the address, a failed command's last lines), a task's steps indented. Never callouts; Obsidian does not render Markdown inside `<details>`.
- A message's heading says who said it and when, at the moment it was said rather than when its turn began, so a reply follows the fold of the work it came out of. A fold's minutes run to the end of the last call in it, since a fold holding one call that ran for two minutes took two minutes.
- The zone the days and times are written in is handed to the renderer, never read from the process, and the names of the days and the months are the renderer's own: only digits come from the system's calendar data, so an updated copy of it cannot move a heading. The device writing the file hands in its own zone.
- The agent may read and search it like any file; it is how one chat finds another's words without opening records.

## Chat folder lifecycle

What a person sees in the app and what they find on disk are meant to be the same thing. A chat's folder is named for the chat, a chat renamed in the app is renamed on disk, and where the two cannot both be had, the app's name wins and the folder carries the difference.

1. Created at Send of the first message, named by that message's first words (the words are final by then). The agent's output folder and pasted files need it during the first turn, so there is nothing to wait for and nothing timed: a pasted screenshot moves out of the draft folder into it before the first command runs.
2. Renamed to the title between turns, once the title settles, and again whenever the person renames the chat. Never renamed while a turn runs. `settings.json` in the record folder holds `folder`, the name it last gave the folder; references to pasted files are stored relative to the chat folder, so a rename breaks none.
3. Between turns is not a preference, it is the only time a rename works. Measured on a Windows host: renaming a folder succeeds when nothing holds it, and fails with an `IOException` when a file inside it is open for reading, when one is open for writing, and when any process has its working directory in it. macOS and Linux survive all three, since handles and working directories follow the inode, but our own sandbox mounts folders at their real paths, so a rename mid-command breaks path resolution everywhere.
4. The rename is best effort and never blocks anything. The shell is built per command, so between turns nothing of the agent's holds the folder, but a background job outlives its command and keeps running with the folder under it, and so can a sync engine, an app the person left open, or Explorer with the folder selected. When the rename fails, the folder keeps the name it has and the chat carries on: this computer's `chat-folders.json` holds the name we last used and `CHAT.md` holds the chat id, so nothing is lost. It is tried again at the next title change. No failure is surfaced, nothing is blocked, and no job is stopped for it. The visible consequence, on Windows only: a chat with a long-running background job keeps its first-words name until that job ends.
5. Names follow the sync rules: no `/ \ : * ? " < > | $`, no leading dot, no trailing dot or space, no reserved Windows names, at most 80 characters, a number (` 2`) only on collision. The `$` is ours rather than any system's: a title holding a price makes a path the shell expands. A name is taken by making the folder, which the system does in one step, rather than by listing what is there and picking what is free: two chats under one title, settling at the same moment or converted at one launch, would otherwise both pick that name and share a folder.
6. 80 characters is Windows' 260-character path limit, not a sync service's: OneDrive allows 400 with 255 per segment, so it is the looser of the two. The cap a person meets is smaller and comes from what the app can show, and the same cap applies to a title they type and one the model writes, so a title and its folder never diverge.
7. A collision in a title the model wrote is suffixed in both places, so the chat is "Weekly report 2" in the app and on disk. A collision in a title the person typed leaves their words alone and suffixes only the folder: changing what someone just typed is worse than one character of difference.
8. If the folder this computer recorded for a chat is gone, the next write of the chat's folder (and the shell, when it looks for the folder) looks for it: the chat adopts a folder under `Chats/` that no chat claims when exactly one of them holds its `CHAT.md` link, which is the Finder rename. The look costs nothing while the recorded folder is there, since it opens a `CHAT.md` only where that folder is missing. It refuses to guess when two unclaimed folders hold the same link (a copy, a conflict copy, a restore), when the chat's own folder is still there, and when the folder has no link to read. Any of those, and the chat's next change makes a fresh folder by the current title; the old one, wherever it went, is the person's.
9. Never deleted for being empty. Deleting a chat in the app opens a delete screen that shows what goes: the chat itself (its records and transcript) always, and its folder with what the agent made only if the person checks that option, which starts unchecked. An unchecked folder stays as the person's own files.
10. A chat the launch converter brings onto its records gets its folder and `CHAT.md` at that launch, once, built from the converter's fold; a later launch finds it converted and reads nothing. Any other chat without a folder gets one at its next turn or message. Files old chats already made stay where they are.
11. A folder renamed in Finder is adopted and keeps working, and the chat's title does not follow it. The name on disk has already been sanitized, so feeding it back would quietly strip characters out of what the person called the chat.
12. If the first message has no words at all, only an attachment, the folder falls back to the chat id until a title arrives. It is the one place an id appears under `Chats/`.

## One topic per chat

Settled 2026-10-16: a chat is filed under one topic, not several. The plural was never used for more than one in practice, and it is carried in 46 places across the two packages: an array on the session row and in the mark, a checkbox menu in two chat menus, a `data-topics` part, a filter that has to reason about overlap, and the front matter of `CHAT.md`.

Singular removes all of that rather than renaming it. The migration is one step, since a chat with several topics keeps the first and the rest are dropped; nothing on disk needs rewriting until the chat's next change, because the mark is newest-wins per field.

Built. A `topics` mark, a `chat.db` row's `topics` and a stored `data-topics` part each read as the singular one for their first topic. The column's filter still reads a list, as the app filter beside it does, since it only ever holds one.

## Naming a chat well enough to find it

The folder is only as good as the title, so the title is a product surface rather than a label. Three changes, each worth an eval:

- The model is given the titles of other recent chats when it names one, so it can see what it would collide with.
- It is told to be specific enough to be recognized later, with the example being that "Check the weather" could have been "Check the weather for Friday". Specific where it helps, not pedantic: a date on every title is the failure mode to eval against.
- A name that collides is handed back to it to try again, rather than silently suffixed.

Not proposed: giving the model tools to query other chats before naming. It turns a one-shot title into a session, and the cost is not worth it.

Built, at both moments a model names a chat (the first message, and the first exchange settling), in `lib/chat/chat-name.ts`:

- The titler sees the titles of the 20 most recently active other chats that have one, archived chats aside, newest first, and today's date beside them. Both go ahead of the message in its input, so the message is the last thing it reads and a "hey" is not taken for one more title to name.
- A collision is what the folder layer counts as one: the same name once spelled as a folder, in any case. A title collides with every other chat's title, archived ones included, and with every folder under `Chats/` but the chat's own.
- A colliding title is handed back once, as taken. A second answer that also collides, or fails, numbers the first one (`Weather 2`) before it is stored, so the app and the folder carry the same name (point 7 above). The current-title rule that keeps a settled name lets one go when it is taken or carries such a number.
- `pnpm eval:chat-titles` (`evals/chat-titles.ts`) measures it against seeded chats: "What's the weather?" beside earlier weather chats gets a name none of them has, a subject nothing shares gets no date, "hey" stays unnamed, and a name handed back as taken comes back different.

## Archiving

Archiving a chat moves its folder out of `Chats/`, because a person who archived something does not expect to still find it there.

A folder cannot move while a turn is running: the Windows result above applies exactly, and the agent's own mounts resolve through that path. Rather than stopping a turn to archive it, the control is disabled while a chat is working, with a tooltip saying why. That is a smaller promise than "are you sure", and it cannot race.

## Drafts

A new chat:

```
1. type in a new chat            nothing on disk until the first pause
2. first autosave                Drafts/2026-10-14/DRAFT.md   (id, created, topic; the words below)
3. paste an image                Drafts/2026-10-14/pasted-image.png   (the one copy)
   attach a file or folder       listed in DRAFT.md by its path, not copied
4. more typing                   DRAFT.md rewritten in place, through a temp name
5. Send
   a. records                    .instrument/chats/<id>/   first message, naming the draft's id
   b. chat folder                Chats/Find a quiet dishwasher/
   c. pasted files move          Chats/Find a quiet dishwasher/attachments/pasted-image.png
   d. originals opened           each attached path granted to the chat
   e. draft removed              Drafts/2026-10-14/ deleted
6. title settles after the turn  Chats/Quiet dishwashers under $900/
```

A reply to an existing chat:

```
1. type in that chat's box       nothing on disk until the first pause
2. first autosave                Drafts/2026-10-14 2/DRAFT.md   adds chat: <that chat's id>
3. paste or attach               as above; that chat's folder and records see nothing
4. Send
   a. records                    message appended to that chat's log, naming the draft's id
   b. pasted files move          Chats/Quiet dishwashers under $900/attachments/pasted-image 2.png
   c. originals opened           granted to that chat
   d. draft removed              Drafts/2026-10-14 2/ deleted
```

Rules:

- Every draft lives in `Drafts/`, new chats and replies alike, from any device. A chat may have several drafts, ready for queued messages later. A draft whose chat was deleted stays, so it can be salvaged.
- A draft is its `id`, never its folder name. Folders are named by the date the draft was started (`2026-10-14`, then `2026-10-14 2`), because a name from its words would rename while typing. A draft made all at once (a tutorial draft, one the agent writes) may be named by its words.
- Two `DRAFT*.md` files in one folder (two devices made the same date offline, or a sync conflict copy) are read as separate drafts; one with an id already seen is shown beside it, never dropped.
- Crash-safe Send: the message records `fromDraft`, on its metadata. A draft is pointed at its chat (`chat:`) before the message is written, since that message is in the chat's records and nothing could find it otherwise; a reply draft names its chat from its first autosave either way. On launch, a draft whose chat already holds a message naming it is finished (folder removed), and one whose chat does not is left to be sent again.
- The front matter also holds `updated`, which is what puts the newest of a chat's drafts in its box when the chat is opened, and `state`, where what the app knows about a draft besides the keys above is kept in one place rather than spread through the file. From there the box writes into the draft it took up, whatever arrives or is stamped since, until the person swaps another in, empties it or sends it.
- A draft with no words and nothing pasted or attached is deleted. Emptying a chat's box by hand is how one of its replies is deleted, and the box then writes into nothing: the next words typed are a reply of their own rather than words over a reply still waiting.
- The agent may read and write drafts as files.
- Front matter is plain YAML, as `SKILL.md`'s is, and the body is the person's own words, kept exactly as they typed them.

### A draft another device sends, reserved in the format

Not built in F2, but the keys are settled now, so a phone writing a draft today writes one a later release can send. Nothing waits in line: a message goes into a chat whenever it arrives, a turn already running included.

- `send: auto` means a computer running Instrument sends this draft as soon as it sees it. Without the field a draft is just a draft, and only the person sends it: a reply draft found at launch or arriving from another device goes into its chat's message box, ready to send, and is never sent on its own.
- Where a chat has more than one reply draft, the newest fills the box when the chat is opened and a small control above it says how many others there are and swaps one in. None is ever merged into another or dropped, and a draft arriving from another device never takes the box from the draft it is writing into.
- `sendOn: <device id>` names the one device that sends a `send: auto` draft, and such a draft always carries it: a phone names the computer the person picked. Nothing is inferred from which device wrote last, so two computers can never send one draft, and a draft whose computer is away simply waits, which the phone can say plainly.
- The sending device appends the message, naming `fromDraft`, before it removes the draft folder, so the records are what "sent" means. The message carries what was pasted with it, so there is nothing left to move once it is written; moving files after the append is what F3's `{pasted}` shape is for, since a path relative to the chat folder is what survives the move. Another device learns a draft was sent by finding the message that names it, which is also how a phone's own edit is reconciled when a send was already under way.
- `.instrument/devices/<device id>.json` (`{name, platform, app, seenAt}`) is written only by the device it names, at launch, at quit, and at most every quarter of an hour while the app runs. It is there so a phone can say "Sends on Jeremy's MacBook Pro", and it never decides anything: a stale `seenAt` must not strand a draft, and a send happens when the named device next runs.

## Attachments by reference

- A file or folder the person attaches (drop, paperclip, Finder's Ask or New Chat, a card's picker) is granted to the chat at its own path, read and write. Grants of a single file work in every layer: the rules take a file path like a folder's, Seatbelt's rule covers the file, bubblewrap binds the file, and on Windows the shell and file tools check the same rules.
- The message stores each attachment as either `{path}` (the original, absolute) or `{pasted}` (relative to the chat folder), with its name, media type and size. Pictures and PDFs the model was shown keep their bytes as blobs in the records, so the history the model saw never changes when an original does.
- The agent is told each attachment by its path. `$INSTRUMENT_ATTACHMENTS`, the record folder's `attachments/`, and `writeUploadedAttachments`' copy go away.
- At the update, an existing chat's record-folder `attachments/` moves to its chat folder's `attachments/`, and those messages' stored paths are rewritten once.
- Known limits to test: a program that saves by writing a temp file beside the original and renaming it over is refused under a single-file grant; macOS may raise its own prompt for a file in Downloads or Documents depending on how it arrived (system picker, drag from Finder, typed path), to be checked with a signed preview on the Mac VM.

## Topics, memory, skills, apps

- `TOPIC.md` replaces `instructions.md` plus a hidden `settings.json`. The folder name is the topic's name; renaming the folder renames the topic, and chats keep their tags by id.
- `Memory/` is today's `.instrument/memory/` moved; no index file. Built: `lib/memory/move.ts` moves it once at launch and never merges into a `Memory/` that is already there.
- `Skills/` is today's `.instrument/skills/` moved; the agent reads and writes it as today.
- `APP.md` replaces `app.json` plus `guide.md`. The agent edits it directly; `app` keeps its validation commands (`app test` and the request and connect checks). An app's approval hash covers the manifest in the front matter, parsed, not the file's bytes, so editing the guide or instructions never disconnects it and today's approvals carry over. A web app's account-specific URL stays in the connection record on this computer.
- How instructions reach the context: a topic's are inlined in the chat's topics note, and a connected app's in the session's apps note, each up to 20,000 characters and cut on a paragraph break past that, with the cut naming the file the rest is in (`Topics/<Name>/TOPIC.md`, `Apps/<Name>/APP.md`) so the agent reads it where the person does. One budget and one cut for both (`lib/instructions-in-context.ts`). An API app's guide also still meets the first request in a chat, which is the one route open to an app connected after the session's context was written.

## Missing folders

- `state.json` on this computer records which key folders should exist (`Chats`, `Drafts`, `Topics`, `Memory`, `Skills`, `Apps`). One non-recursive watch on the Instrument folder's top level notices one going away.
- The app says so in-app, over an empty list first and then in the notifications bell. The notice only informs: the person dismisses it (or says they meant to), and nothing is restored or recreated by it. The next thing the app writes there makes the folder again. Deletes below the key folders are the person's business.

## Migrations at the update

All after the records converter, each safe to run again, moving into a free name and never over a file:

- `.instrument/drafts/<id>/` to `Drafts/<date>/DRAFT.md` (the old `draft.md` and `settings.json` merged into front matter; window pointers were already by id, so nothing points at a folder). Every file the old folder held moves with the draft, named or not: the folder it is leaving is one nothing reads again.
- `.instrument/topics/<Name>/` to `Topics/<Name>/TOPIC.md`; granted folders into `permissions.json`.
- `.instrument/skills/` and `.instrument/apps/<slug>/` (to `Apps/<name>/APP.md`) out to the top. `.instrument/memory/` is done.
- A folder per existing chat, with `CHAT.md`; its record-folder `attachments/` and `handoff-notes.md` move into it.
- A top-level folder with one of the six names that Instrument did not make is used as is; nothing in it is moved or renamed.

## Machine-side cleanups

- One shared `browser/agent-browser-home/` instead of one per chat (every copy held the same empty `config.json` and provider plugin).
- No hidden attribute on `.instrument` on Windows, so OneDrive syncs it; the branch's `attrib +h` is undone at the update.
- `claude-account/` moves from this computer's root into the workspace's folder on this computer, beside `keys/`.
- The `downloads/` fallback at the Instrument folder's top goes; when the system's Downloads refuses a file, the app asks where to save.
- `features.json` merges into `preferences.json` in the machine folder, as the machine data move takes the preferences there.
- Dead files removed: root copies of 1.x and beta settings (`preferences.json`, `app-state.json`, `features.json`, `window-state.json`, `favorites.json`), `chatgpt-plan` and its copies, the 1.2 betas' `workspace.db` and `migrations.json`, stale Linux install scripts.
- The app's own stored path fields are rewritten once at the update.

## Phases

After records phases 1 to 5, since everything here reads and writes the new records.

| # | Phase | Done means |
|---|---|---|
| F1 | Chat folders: lifecycle, `CHAT.md` renderer and writer, output folder and handoff notes moved, folders for every existing chat | A converted clone of a real install has a folder and `CHAT.md` for every chat; renders are byte-identical across runs |
| F1, built since | The folder claimed when the chat is made rather than at the next launch; `CHAT.md` written at the end of every turn and when the person sends a message, and no launch pass over every chat; the folder following the title at the two moments one changes, best effort; `$INSTRUMENT_OUTPUT` and `handoff-notes.md` in the chat's folder, which the layout now carries as a mount; what the person sent moved out of the record folder; the delete screen's box that takes the chat's folder too, clear unless the person ticks it; a sync engine's conflict copy of `CHAT.md` deleted wherever the folder is already walked, by its name and by the chat its head names | Covered by tests in `chat-folders`, `conflict-copies`, `delete-chat-dialog`, `trash-chat`, `workspace-fs-layout` and `follow-title` |
| F2 | Drafts: `DRAFT.md`, both sequences, several per chat, crash-safe Send, migration | Both sequences driven in the app, with a crash injected between each step of Send |
| F2, built since | The control over a chat's box saying how many other replies are waiting and putting the one picked in it, words and attachments both, which is the only way to reach a chat's older reply drafts; the box writing into the draft it took up until the person swaps, empties or sends it, so an emptied box takes that draft away and writes into nothing rather than moving onto another reply waiting | Covered by tests in `replies-waiting` and `draft-words` |
| F2, still to build | `Drafts/` reached by the agent, which is the workspace's top level and so waits for the folder the person picks | The agent reads and writes a draft as a file |
| F3 | Attachments by reference: file grants on all three systems, pasted files, stored shape, the copy and `$INSTRUMENT_ATTACHMENTS` removed, migration | The agent edits an attached file in place on macOS and Linux, and on Windows through the shell and file tools |
| F4 | `TOPIC.md`, `Memory/`, `Skills/`, `APP.md`, instructions by threshold, `.instrument` closed with no exceptions | A test asserts a chat reaches nothing inside `.instrument`; approvals survive the move |
| F4, built since | All four folders out, each with its one capitalized file; an app's approval restamped by the migration so a connected app stays connected; instructions by threshold for a topic and for a connected app, the cut naming the file the rest is in | Covered by tests in `move-out-of-data-dir`, `topics-move`, `apps-move`, `topic-file`, `app-file`, `chat-topics-model-text` and `apps/context`, and by the rehearsal over a real 1.x install |
| F4, still to build | The last two things open inside `.instrument`: a chat's `attachments/`, read-only, for a chat whose move into its own folder was refused, and its `handoff-notes.md`, which the agent writes with nobody there to answer a card. `app-data-rules` pins both as the only paths in there a chat reaches, so the set only shrinks on purpose; they close once every workspace is a folder the person picked, where neither is in `.instrument` at all | That test's list is empty |
| F5 | Missing-folder notice | Deleting each key folder in Finder shows the notice, and dismissing it sticks |
| F5, built, since removed | Removed when the app began running only from a workspace the person chose: a deleted folder is the person's own doing, and a whole lost folder goes back to setup's folder step. Only a folder this computer made is looked for, so a workspace that never had one is not missing it; one non-recursive watch on the top level, with the launch check as the backstop; the notice in the bell, its id carrying the names so a second folder going is a notice of its own; and the line over an empty list, which says the folder rather than inviting the person to start a chat they already have | Covered by `missing-key-folders.test.ts`, including a name the person replaced with a file, two workspaces at once, dismissal sticking, and a folder coming back |
| F5, driven since | `Chats/` deleted under a running app on a disposable workspace: the watch noticed in about four seconds with no relaunch, the list said the folder was gone rather than offering to start a chat, the bell said which and that nothing is lost, the dismissal survived a relaunch, and making a chat again remade the folder and took the notice away | Deleting a key folder shows the notice, and dismissing it sticks |
| F5, still to build | The same from a file manager rather than a shell, on each of the three systems, which is what [Testing](#testing) asks of this phase. Note the line over the list only shows when the list is empty, and a chat lives in `.instrument/chats/`, so for anyone with chats the bell is the surface | Deleting each key folder in Finder shows the notice |
| F6 | Machine-side cleanups | Each covered by a migration test |
| F6, built since | All seven: one `agent-browser-home` for the workspace; no hidden attribute on Windows, and one already there taken off once; `claude-account/` beside the workspace's `keys/`; the `downloads/` fallback replaced by the system asking where to save, the empty folder removed; `features.json` merged into `preferences.json`; the dead root settings, `chatgpt-plan`, the 1.2 beta's `workspace.db` and `migrations.json` and a stale Linux install script removed; a stored path written where its folder went by the migration that moved it | Covered by tests in `machine-cleanups` and `rewrite-stored-paths`, and by the ones in `move-app-folders`, `workspace-move` and `workspaces` that now read the rewritten file |
| F6, built since | The three stored paths the lookup also served: a draft's attached file in its `DRAFT.md`, rewritten with the topics because the format is the workspace's own, and the Files addresses in the window's `layout.json` and the recent files in `history.db`, which the app brings to the rewrite as its own because they are its stores rather than the workspace's. A path in a chat's records is left alone on purpose, since the records are the chat's words rather than the app's fields | Covered by `workspace-move`, which moves a workspace and reopens the tab, the draft and the recents row, and by the unit tests in `rewrite-stored-paths`, `kept-state` and `history-store` |
| F6, still to build | A workspace folder the person moved by hand and the app then found again (`registerWorkspaceFolder`) carries its rules, topics and drafts over but not the window's tabs or the recent files, which it cannot reach from where it runs. Both go quiet rather than losing anything, and the move from Settings › Storage carries all five | A tab and a recents row survive a folder moved in Finder, too |

## Testing

Local first, and most of the time:

1. Unit tests per phase, including names that need sanitizing and collisions.
2. The app driven on a disposable workspace, a screenshot of every folder and draft flow: new chat with pasted and attached files, a reply, two drafts for one chat, Send with a crash, a title settling and the folder renaming, `CHAT.md` opened in a Markdown viewer.
3. Finder gestures: renaming, moving and deleting a chat folder, a topic folder, a draft folder; deleting a key folder.
4. A converted clone of a real install getting folders for all its chats, and the migrations of drafts, topics, memory, skills and apps.
5. File grants on the Linux VM (bubblewrap) and the Windows PC; macOS's own prompts with a signed preview on the Mac VM.
6. Syncing between devices last, with the records.

## Open items

- How an app's instructions show and are edited in the app's own interface.
- Whether Settings shows that a chat holds an attached item Settings says is Not allowed.
- The drafts migration publishes a draft before it moves what was pasted into it, and reads a published draft as one it has already done. A crash between the two therefore leaves a draft naming files by where they were, with no later launch to put that right; the files are on disk either way. Resuming it takes a claim that can be made again, which the folder claim is not.
