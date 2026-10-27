# Drafts

A draft is a chat not yet started, or a reply waiting in a chat. Both live in the workspace's `Drafts/`, a folder per draft holding a `DRAFT.md` (plain YAML front matter over the person's words) and every file and folder that goes with its message. A reply names its chat by its address (`chat: instrument://chat/<id>`; a bare id reads the same); a new chat's draft does not. A draft being sent names the chat it is going into as `sending:`, whichever kind it is. The folder is the record: a file manager, a sync engine bringing another device's edit, the phone app, or a newer build can change it, and every window has to follow.

The front matter is `id`, `created` and `updated` (ISO 8601 UTC to the second), `chat`, `send`, `sending`, `topic` (the topic's id, written only when the person picked one), and `context`. Every key but `id` is optional: a `DRAFT.md` with no `id`, or with no front matter at all, is a draft someone wrote by hand, and the first read gives it an id and writes it into the file (`readDrafts`). An empty file is not a draft, since that is what an editor partway through a save leaves. A key this build does not write is kept as it was found.

## Layers

| Layer | Where | Owns |
| --- | --- | --- |
| Format and folder | [`packages/workspace/src/lib/drafts/`](../../packages/workspace/src/lib/drafts/) | `DRAFT.md` parsing and rendering, folder naming, atomic writes, keeping front matter another program wrote, the launch sweep that finishes interrupted sends |
| Store | [`electron-main/drafts/draft-store.ts`](../../apps/studio/src/electron-main/drafts/draft-store.ts) | the drafts while the app runs: the one writer of `Drafts/`, applying ops, watching the folder, staging pastes, moving what is taken out of a draft's folder to the Trash |
| Context lines | [`packages/workspace/src/lib/drafts/context-line.ts`](../../packages/workspace/src/lib/drafts/context-line.ts) | how one thing that goes with the message is written as a line of `context`, and read back |
| Record | [`electron-main/drafts/draft-record.ts`](../../apps/studio/src/electron-main/drafts/draft-record.ts) | the translation between a window's `Draft` and a `DraftFile`: the draft's folder into the composer's files, and what came from elsewhere and the chips into `context` and back |
| Ops | [`shared/drafts.ts`](../../apps/studio/src/shared/drafts.ts) | the `Draft` type, the `DraftOp` union, and `applyDraftOps`, which main and every window run |
| Window mirror | [`client/drafts/store.ts`](../../apps/studio/src/client/drafts/store.ts), over [`client/lib/op-mirror.ts`](../../apps/studio/src/client/lib/op-mirror.ts) | what a window shows: main's snapshot with its own unacknowledged ops applied over it; the bookmarks share the mirror |
| Chat box | [`client/drafts/chat-box.ts`](../../apps/studio/src/client/drafts/chat-box.ts) | which reply each chat's box writes into, and a reply's send |
| Composer words | [`client/drafts/settle-words.ts`](../../apps/studio/src/client/drafts/settle-words.ts), [`client/atoms/prompt-value.ts`](../../apps/studio/src/client/atoms/prompt-value.ts) | the words being typed, written into the draft a beat after the typing settles |

## One writer, ops in, snapshots out

Main is the only thing that writes `Drafts/` while the app runs. A window never sends a whole list of drafts: it sends a batch of `DraftOp`s (`create`, `update` with fields set and cleared, `remove`, `claim`, `release`, `sent`) over `drafts:apply`. Main applies them with `applyDraftOps`, writes each changed draft's file at once (a file is made only once a draft has something in it), and sends every window a `DraftsSnapshot`: the drafts, plus, for each window, the number of the last batch it applied.

A window shows that snapshot with the batches main has not yet acknowledged applied over it. Its own change shows the moment it is made, and a snapshot main sent before applying it cannot undo it: the batch stays applied until a snapshot acknowledges it, and by then main's drafts include it. Because both sides apply ops with the same function, the window's guess and main's answer agree.

`update` ops carry only the fields that changed (`draftUpdateOf`). So a change made elsewhere to another field, such as a topic picked on another device, survives a window's words still being sent.

The preload reads the snapshot synchronously before the first render (`drafts:load`), because a chat's box reads its reply as it first draws.

## What goes with the message

A draft's message goes with two kinds of thing besides its words: what the person chose, which the file keeps, and what is on screen, which it never does. The chip row shows what is on screen first, then what was chosen (`draftContextItems`), and at Send both go into the message's `data-viewContext`, with the files in the draft's folder in `data-attachments`. The window's list of attachments is not the authority on what goes: the message route reads the draft's folder itself at the moment of sending (`withDraftFolder`), so a file that landed a beat before the press goes too.

The draft's folder is what its composer was given. Every file and folder in it besides its `DRAFT*.md` goes with the message, whoever put it there: a paste the app wrote, or a file the person dropped in through Finder, File Explorer or the app's Files view. The system's clutter does not (`isSystemClutter` in `packages/workspace/src/lib/system-clutter.ts`): dotfiles such as `.DS_Store`, AppleDouble `._*` files and `.localized`, `desktop.ini`, `Thumbs.db`, `ehthumbs.db`, the Mac custom-icon file `Icon\r`, Office lock files (`~$*`), and downloads or saves still in progress (`*.crdownload`, `*.part`, `*.download`, `*.tmp`). Nothing in the folder is written as a line of `context`, and a line naming something there is read as the folder's, once.

A folder holding two different drafts cannot say which of them a loose file is for (`ownsDraftFolder`). There each draft has only what its own lines name inside the folder, by its path there (`receipt.png`), and a file no line names goes with neither. A sync engine's conflict copy is the same draft again, so it shares nothing.

`context` lists everything else the person chose, one line each: a file or folder in the workspace as `workspace:/<place>` (the form chat records use), anything else on this computer at its absolute path, another chat by its address, and a web page or an app's front by its own address (`https://…`, `instrument://app/<slug>`). A folder's line ends in `/`.

It holds what was pasted or dropped into the composer, the files and folders the draft was opened on by name, and chats the person added. Asks marked in files go with the message as pills of their own. Taking one of those chips off takes its line out of the file, so a no is a line that is not there, and dismisses it as well, so a screen chip does not name it again: a Finder whose selection it was goes back to standing for its folder. A page's chip reads the words of the window's own tab at that address while there is one.

The screen's chips are worked out live from what the window shows (the tab the draft's own band has up, and what the window has in view: an open file, a folder, a page, an app's front), so they follow the screen while the person writes. The chat on screen is never one of them: a reply already names its chat as `chat:`. Dismissing a screen chip is kept in the window's memory by draft and chip (`dismissedChipsAtom`), never on disk, so it holds while the person moves around and may come back after a relaunch.

Read back, the folder is the composer's again, each file with its type read from its name; every line is a chip. What the composer was given by its path from elsewhere comes back as a chip. A topic the decision model suggested (`topicSource: "suggested"`) is kept only while the app runs, and is offered again after a relaunch rather than written as the person's choice.

## The folder changing under the app

A draft carries `inFolder`, what its folder had when main last read it, which only main sets. An open composer follows it: a file that turns up there is added to the box, and one that leaves is taken out of it (`useFolderItems`). Taking a chip off asks main to move that file to the Trash (`drafts:trash`), since a file dragged in may be the person's only copy; main refuses anything but an entry directly in that draft's folder, and in a folder two drafts share, one the other draft still names.

The store remembers, for each draft, the file it is in and that file as the store last wrote or read it. On a watch event it reads the folder. A file that reads the same, beside a folder listing the same, is its own write; a folder whose listing alone changed updates the draft's `inFolder`. A file that reads differently is taken in, a missing file means the draft is gone, and an unknown id is a new draft. A file that is still there but can't be read for the moment (an editor partway through a save, a sync engine's placeholder) leaves its draft as it was. Before applying ops, the store rereads the files of the drafts they touch, so an edit from another device that the watcher hasn't reported yet is taken in instead of written over. Nothing in main writes a draft's file behind the store's back: pastes are staged through it (`drafts:stage`), and so is a send's claim.

When the same id appears in two files (a sync engine's conflict copy beside its original), the draft is the file the store has been writing, else the one named `DRAFT.md`. The copy is left for the person, and goes when the draft is thrown away. A thrown-away draft's folder goes to the Trash with whatever it had in it.

## Sending

A message names the draft it came from (`fromDraft`), and that message is what says the draft was sent ([`send.ts`](../../packages/workspace/src/lib/drafts/send.ts)). A send is three steps, and the person loses nothing whichever step the app stops at:

1. **Claim.** `claim` gives the draft `sendingTo` and the words it is being sent with. Its file says `sending:` the chat, so a launch after a crash knows where to look for the message, and another device treats the draft as on its way. The window waits for main's answer before it writes anything in the chat. While `sendingTo` is set, the draft is neither a reply waiting (`repliesOf`) nor a draft in the inbox list. It is the message on its way. A file read meanwhile does not take a draft this app is sending off its way.
2. **Message.** The message is appended with `fromDraft`. Each file in the draft's folder is copied into the chat's `attachments/`, and so is each folder in it, which the chat is then granted at that copy. Once the message is written, what was sent is taken out of the draft's folder (`removeSentFromDraft`).
3. **Sent or released.** On success, `sent` removes the draft. Whatever its folder still has was never sent (it arrived after the send read the folder), so it goes to the Trash rather than being deleted, and the store refuses to take that id back for as long as it runs, so a sync engine bringing the file back cannot offer it again. On failure, `release` clears `sendingTo`, and the draft is the person's again, as it was. A new chat's draft goes back to naming no chat.

A launch finishes any send step 3 never reached (`finishSentDrafts`), moving what the draft's folder still has to the Trash. A draft still marked `sending:` whose chat has no message from it was never sent: the launch clears the mark, and the draft is the person's again, as the kind of draft it was.

### A reply another device asks this one to send

A phone cannot run the agent, so its Send leaves the draft with `send:` naming a computer (its device id): for a reply, the computer that last worked in its chat; for a draft that opens a chat of its own, the computer that last wrote the chat list. That computer sends it as soon as it has it, through the same three steps (`electron-main/drafts/send-asked-drafts.ts`), making the new chat first where there is none, on the chat's own model or else the default, under the draft's topic. The agent can read `Drafts/` and never write it (`layoutRules` in `workspace-fs-layout.ts`), so a draft it wrote can never ask for a turn nobody started. Naming one device keeps two computers from both sending it. The ask holds for ten minutes from the draft's `updated`: one found later, by a launch the next day say, or one whose send fails, loses its `send` and waits in the chat's box like any other reply, so nothing goes out long after it was written or more than once.

## A chat's box

Each chat's box writes into one reply at a time (`chatBoxesAtom`, per window, in memory). A box takes up the reply it shows as it first draws (the chat's newest), or nothing where there is none, so a reply that arrives later from another window or device waits beside it instead of receiving the box's next words. Typing settles into that reply after `WORDS_SETTLE_MS`, or makes a new one where the box writes into none. Emptying the box removes its reply, unless something is attached, and the box then writes into nothing, so the next words start a new reply instead of landing in another one waiting. Submitting claims the reply and points the box at nothing, so what is typed while the send is in flight is a reply of its own. A failed send first writes any words typed since, then puts the reply back in the box only if those made no reply of their own.

The composer holds the words being typed. The draft gets them a beat later, and the inbox and the Drafts list read the draft. A composer that unmounts or moves to another draft writes its waiting words at once, and so does anything that adds to a draft with no composer showing it, so the next reader starts from them. Nothing else holds a copy of the typed words that could outlive its composer.

## What a draft does not do yet

- An open composer does not follow an edit made elsewhere to the words it is showing: its next write replaces them. Words changed elsewhere reach a composer as it next mounts.
