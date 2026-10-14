# Plan: everything visible in the Instrument folder

Status: approved to build on branch `chat-records`, after the records phases of [chat-records.md](chat-records.md); nothing built.

The Instrument folder becomes something a person can open in Finder, Spotlight or Obsidian: a folder per chat with its transcript as Markdown and what the agent made, their drafts, topics, memories, skills and apps as plain files. The app's records stay in the hidden `.instrument/`, which ends fully closed to the agent. Attachments stop being copies: what the person hands over from disk is opened to the chat where it lies.

Supersedes [chat-attachments-by-reference.md](chat-attachments-by-reference.md) (its finding that libuv does not clone on macOS still holds for the one copy left, pasted content). Folder choice at first launch belongs to [choose-where-instrument-keeps-files.md](choose-where-instrument-keeps-files.md) and the onboarding work; this plan keeps Settings › Storage's move as the way to choose for now.

## Decisions

- Six visible folders at the top: `Chats/`, `Drafts/`, `Topics/`, `Memory/`, `Skills/`, `Apps/`. Each is found by its name; a folder inside one is read through one capitalized file (`CHAT.md`, `DRAFT.md`, `TOPIC.md`, `SKILL.md`, `APP.md`), and a folder without it is not Instrument's.
- No `Archive/`: an archived chat's folder stays in `Chats/`, and archive stays a mark.
- The records stay in `.instrument/`, filed by id, and are the truth. Nothing in a visible folder is read back as a record, except the capitalized files the person may edit (`DRAFT.md`, `TOPIC.md`, `SKILL.md`, `APP.md`, memories).
- `.instrument/` is closed to the agent with no exceptions once this lands: no attachments, handoff notes, skills or apps inside it.
- Finder gestures never change a chat. A renamed or moved chat folder is not followed; the chat's next change makes a fresh one. A deleted one comes back on the chat's next change. Topic, draft, memory, skill and app folders keep working when renamed, because they are found by their capitalized file and its `id`.
- Attaching a file or folder from disk opens the original to that chat, whatever Settings says for it; so does a folder picked on a card. Asking in words still respects Not allowed. A file opened in the app's viewer is not granted.
- Pasted content (an image, a screenshot, a file a web page hands over as bytes) is saved once, and that file is the original.
- `Drafts/` is open to the agent like the rest of the folder: its path says what it is.
- Onboarding is out of scope.

## The tree

```
Instrument/
  Chats/<title>/
    CHAT.md                 the transcript, rewritten by the app at the end of each turn
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

- Rendered from the fold, deterministically, so two renders of the same records are the same bytes. Written whole through a temp name (`.~CHAT.md.tmp`) and a rename at the end of each turn, by the device running the chat. Edits to it do not last, and a sync service's conflict copy of it is deleted on sight.
- Front matter: `started`, `topics` (names), and nothing listing files, pages or apps. First line of the body: an "Open this chat in Instrument" link, `instrument://chat/<id>`.
- A heading per day and per message. What a person sees in the chat stays visible: messages, cards with their answer, files, a model switch. The work between two visible messages folds into one HTML `<details>` whose summary is "Worked for N minutes", holding plain `<pre>` lines: reasoning, a step's label and short detail, a task's steps indented. Never callouts; Obsidian does not render Markdown inside `<details>`.
- The agent may read and search it like any file; it is how one chat finds another's words without opening records.

## Chat folder lifecycle

1. Created at Send of the first message, named by that message's first words (the words are final by then). The agent's output folder and pasted files need it during the first turn.
2. Renamed to the title between turns, once the title settles. Never renamed while a turn runs. `settings.json` in the record folder holds `folder`, the name it last gave the folder; references to pasted files are stored relative to the chat folder, so a rename breaks none.
3. Names follow the sync rules: no `/ \ : * ? " < > |`, no leading dot, no trailing dot or space, no reserved Windows names, at most 80 characters, a number (` 2`) only on collision.
4. If the folder `settings.json` names is gone (deleted, renamed or moved in Finder), the chat's next change makes a fresh one by the current title. The old one, wherever it went, is the person's.
5. Never deleted for being empty. Deleting a chat in the app opens a delete screen that shows what goes: the chat itself (its records and transcript) always, and its folder with what the agent made only if the person checks that option, which starts unchecked. An unchecked folder stays as the person's own files.
6. At the update, every existing chat gets its folder and `CHAT.md`, built from the converter's fold. Files old chats already made stay where they are.

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
- Crash-safe Send: the message records `fromDraft`. On launch, a draft whose id a message already names is finished (files moved, folder removed), not sent again.
- A draft with no words and nothing pasted or attached is deleted.
- The agent may read and write drafts as files.
- Front matter is plain YAML, as `SKILL.md`'s is, and the body is the person's own words, kept exactly as they typed them.

### A draft another device sends, reserved in the format

Not built in F2, but the keys are settled now, so a phone writing a draft today writes one a later release can send. Nothing waits in line: a message goes into a chat whenever it arrives, a turn already running included.

- `send: auto` means a computer running Instrument sends this draft as soon as it sees it. Without the field a draft is just a draft, and only the person sends it: a reply draft found at launch or arriving from another device goes into its chat's message box, ready to send, and is never sent on its own.
- Where a chat has more than one reply draft, the newest fills the box and a small control above it says how many others there are and swaps one in. None is ever merged into another or dropped.
- `sendOn: <device id>` names the one device that sends a `send: auto` draft, and such a draft always carries it: a phone names the computer the person picked. Nothing is inferred from which device wrote last, so two computers can never send one draft, and a draft whose computer is away simply waits, which the phone can say plainly.
- The sending device appends the message, naming `fromDraft`, before it moves files or removes the draft folder, so the records are what "sent" means. Another device learns a draft was sent by finding the message that names it, which is also how a phone's own edit is reconciled when a send was already under way.
- `.instrument/devices/<device id>.json` (`{name, platform, app, seenAt}`) is written only by the device it names, at launch, at quit, and at most every quarter of an hour while the app runs. It is there so a phone can say "Sends on Jeremy's MacBook Pro", and it never decides anything: a stale `seenAt` must not strand a draft, and a send happens when the named device next runs.

## Attachments by reference

- A file or folder the person attaches (drop, paperclip, Finder's Ask or New Chat, a card's picker) is granted to the chat at its own path, read and write. Grants of a single file work in every layer: the rules take a file path like a folder's, Seatbelt's rule covers the file, bubblewrap binds the file, and on Windows the shell and file tools check the same rules.
- The message stores each attachment as either `{path}` (the original, absolute) or `{pasted}` (relative to the chat folder), with its name, media type and size. Pictures and PDFs the model was shown keep their bytes as blobs in the records, so the history the model saw never changes when an original does.
- The agent is told each attachment by its path. `$INSTRUMENT_ATTACHMENTS`, the record folder's `attachments/`, and `writeUploadedAttachments`' copy go away.
- At the update, an existing chat's record-folder `attachments/` moves to its chat folder's `attachments/`, and those messages' stored paths are rewritten once.
- Known limits to test: a program that saves by writing a temp file beside the original and renaming it over is refused under a single-file grant; macOS may raise its own prompt for a file in Downloads or Documents depending on how it arrived (system picker, drag from Finder, typed path), to be checked with a signed preview on the Mac VM.

## Topics, memory, skills, apps

- `TOPIC.md` replaces `instructions.md` plus a hidden `settings.json`. The folder name is the topic's name; renaming the folder renames the topic, and chats keep their tags by id.
- `Memory/` is today's `.instrument/memory/` moved; no index file.
- `Skills/` is today's `.instrument/skills/` moved; the agent reads and writes it as today.
- `APP.md` replaces `app.json` plus `guide.md`. The agent edits it directly; `app` keeps its validation commands (`app test` and the request and connect checks). An app's approval hash covers the manifest in the front matter, parsed, not the file's bytes, so editing the guide or instructions never disconnects it and today's approvals carry over. A web app's account-specific URL stays in the connection record on this computer.
- How instructions reach the context: today a topic's instructions are inlined in the chat's topics note up to 20,000 characters and cut on a paragraph break past that, with a note saying so (`lib/chat-topics-model-text.ts`); nothing points at a file, since the file was hidden. An API app's guide is handed to the first request in a task, and an MCP app's is not handed at all (`lib/apps/store.ts`). To build: the cut note names the visible file (`Topics/<Name>/TOPIC.md`) so the agent can read the rest, and an app's instructions section reaches the context by the same rule as a topic's when the app is connected to the chat.

## Missing folders

- `state.json` on this computer records which key folders should exist (`Chats`, `Drafts`, `Topics`, `Memory`, `Skills`, `Apps`). One non-recursive watch on the Instrument folder's top level notices one going away.
- The app says so in-app, over an empty list first and then in the notifications bell. The notice only informs: the person dismisses it (or says they meant to), and nothing is restored or recreated by it. The next thing the app writes there makes the folder again. Deletes below the key folders are the person's business.

## Migrations at the update

All after the records converter, each safe to run again, moving into a free name and never over a file:

- `.instrument/drafts/<id>/` to `Drafts/<date>/DRAFT.md` (the old `draft.md` and `settings.json` merged into front matter; window pointers by id).
- `.instrument/topics/<Name>/` to `Topics/<Name>/TOPIC.md`; granted folders into `permissions.json`.
- `.instrument/memory/`, `.instrument/skills/`, `.instrument/apps/<slug>/` (to `Apps/<name>/APP.md`) out to the top.
- A folder per existing chat, with `CHAT.md`; its record-folder `attachments/` and `handoff-notes.md` move into it.
- A top-level folder with one of the six names that Instrument did not make is used as is; nothing in it is moved or renamed.

## Machine-side cleanups

- One shared `browser/agent-browser-home/` instead of one per chat (every copy held the same empty `config.json` and provider plugin); the per-chat copies are deleted.
- No hidden attribute on `.instrument` on Windows, so OneDrive syncs it; the branch's `attrib +h` is undone at the update.
- `claude-account/` moves from this computer's root into the workspace's folder on this computer, beside `keys/`.
- The `downloads/` fallback at the Instrument folder's top goes; when the system's Downloads refuses a file, the app asks where to save.
- `features.json` merges into `preferences.json`.
- Dead files removed: root copies of 1.x and beta settings (`preferences.json`, `app-state.json`, `features.json`, `window-state.json`, `favorites.json`), `chatgpt-plan` and its copies, the 1.2 betas' `workspace.db` and `migrations.json`, stale Linux install scripts.
- The app's own stored path fields are rewritten once at the update, and `moved-paths.json` and its lookup go.

## Phases

After records phases 1 to 5, since everything here reads and writes the new records.

| # | Phase | Done means |
|---|---|---|
| F1 | Chat folders: lifecycle, `CHAT.md` renderer and writer, output folder and handoff notes moved, folders for every existing chat | A converted clone of a real install has a folder and `CHAT.md` for every chat; renders are byte-identical across runs |
| F2 | Drafts: `DRAFT.md`, both sequences, several per chat, crash-safe Send, migration | Both sequences driven in the app, with a crash injected between each step of Send |
| F3 | Attachments by reference: file grants on all three systems, pasted files, stored shape, the copy and `$INSTRUMENT_ATTACHMENTS` removed, migration | The agent edits an attached file in place on macOS and Linux, and on Windows through the shell and file tools |
| F4 | `TOPIC.md`, `Memory/`, `Skills/`, `APP.md`, instructions by threshold, `.instrument` closed with no exceptions | A test asserts a chat reaches nothing inside `.instrument`; approvals survive the move |
| F5 | Missing-folder notice | Deleting each key folder in Finder shows the notice, and dismissing it sticks |
| F6 | Machine-side cleanups | Each covered by a migration test |

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
