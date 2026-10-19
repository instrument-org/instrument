# Drafts

A draft is a chat not yet started, or a reply waiting in a chat. Both live in the workspace's `Drafts/`, a folder per draft holding a `DRAFT.md` (plain YAML front matter over the person's words) and whatever was pasted into it. A reply names its chat (`chat:`); a new chat's draft does not. A draft being sent names the chat it is going into as `sending:`, whichever kind it is. The folder is the record: a file manager, a sync engine bringing another device's edit, or a newer build can change it, and every window has to follow.

## Layers

| Layer | Where | Owns |
| --- | --- | --- |
| Format and folder | [`packages/workspace/src/lib/drafts/`](../../packages/workspace/src/lib/drafts/) | `DRAFT.md` parsing and rendering, folder naming, atomic writes, keeping front matter another program wrote, the launch sweep that finishes interrupted sends |
| Store | [`electron-main/drafts/draft-store.ts`](../../apps/studio/src/electron-main/drafts/draft-store.ts) | the drafts while the app runs: the one writer of `Drafts/`, applying ops, watching the folder, staging pastes |
| Record | [`electron-main/drafts/draft-record.ts`](../../apps/studio/src/electron-main/drafts/draft-record.ts) | the translation between a window's `Draft` and a `DraftFile`, checking what is read from `state` |
| Ops | [`shared/drafts.ts`](../../apps/studio/src/shared/drafts.ts) | the `Draft` type, the `DraftOp` union, and `applyDraftOps`, which main and every window run |
| Window mirror | [`client/drafts/store.ts`](../../apps/studio/src/client/drafts/store.ts), over [`client/lib/op-mirror.ts`](../../apps/studio/src/client/lib/op-mirror.ts) | what a window shows: main's snapshot with its own unacknowledged ops applied over it; the bookmarks share the mirror |
| Chat box | [`client/drafts/chat-box.ts`](../../apps/studio/src/client/drafts/chat-box.ts) | which reply each chat's box writes into, and a reply's send |
| Composer words | [`client/drafts/settle-words.ts`](../../apps/studio/src/client/drafts/settle-words.ts), [`client/atoms/prompt-value.ts`](../../apps/studio/src/client/atoms/prompt-value.ts) | the words being typed, written into the draft a beat after the typing settles |

## One writer, ops in, snapshots out

Main is the only thing that writes `Drafts/` while the app runs. A window never sends a whole list of drafts: it sends a batch of `DraftOp`s (`create`, `update` with fields set and cleared, `remove`, `claim`, `release`, `sent`) over `drafts:apply`. Main applies them with `applyDraftOps`, writes each changed draft's file at once (a file is made only once a draft has something in it), and sends every window a `DraftsSnapshot`: the drafts, plus, for each window, the number of the last batch it applied.

A window shows that snapshot with the batches main has not yet acknowledged applied over it. Its own change shows the moment it is made, and a snapshot main sent before applying it cannot undo it: the batch stays applied until a snapshot acknowledges it, and by then main's drafts include it. Because both sides apply ops with the same function, the window's guess and main's answer agree.

`update` ops carry only the fields that changed (`draftUpdateOf`). So a change made elsewhere to another field, such as a topic picked on another device, survives a window's words still being sent.

The preload reads the snapshot synchronously before the first render (`drafts:load`), because a chat's box reads its reply as it first draws.

## The folder changing under the app

The store remembers, for each draft, the file it is in and that file as the store last wrote or read it. On a watch event it reads the folder. A file that reads the same is its own write. A file that reads differently is taken in, a missing file means the draft is gone, and an unknown id is a new draft. A file that is still there but can't be read for the moment (an editor partway through a save, a sync engine's placeholder) leaves its draft as it was. Before applying ops, the store rereads the files of the drafts they touch, so an edit from another device that the watcher hasn't reported yet is taken in instead of written over. Nothing in main writes a draft's file behind the store's back: pastes are staged through it (`drafts:stage`), and so is a send's claim.

When the same id appears in two files (a sync engine's conflict copy beside its original), the draft is the file the store has been writing, else the one named `DRAFT.md`. The copy is left for the person, and goes when the draft is thrown away.

## Sending

A message names the draft it came from (`fromDraft`), and that message is what says the draft was sent ([`send.ts`](../../packages/workspace/src/lib/drafts/send.ts)). A send is three steps, and the person loses nothing whichever step the app stops at:

1. **Claim.** `claim` gives the draft `sendingTo` and the words it is being sent with. Its file says `sending:` the chat, so a launch after a crash knows where to look for the message, and another device treats the draft as on its way. The window waits for main's answer before it writes anything in the chat. While `sendingTo` is set, the draft is neither a reply waiting (`repliesOf`) nor a draft in the inbox list. It is the message on its way. A file read meanwhile does not take a draft this app is sending off its way.
2. **Message.** The message is appended with `fromDraft`.
3. **Sent or released.** On success, `sent` removes the draft, and the store refuses to take that id back for as long as it runs, so a sync engine bringing the file back cannot offer it again. On failure, `release` clears `sendingTo`, and the draft is the person's again, as it was. A new chat's draft goes back to naming no chat.

A launch finishes any send step 3 never reached (`finishSentDrafts`). A draft still marked `sending:` whose chat has no message from it was never sent: the launch clears the mark, and the draft is the person's again, as the kind of draft it was.

## A chat's box

Each chat's box writes into one reply at a time (`chatBoxesAtom`, per window, in memory). A box takes up the reply it shows as it first draws (the chat's newest), or nothing where there is none, so a reply that arrives later from another window or device waits beside it instead of receiving the box's next words. Typing settles into that reply after `WORDS_SETTLE_MS`, or makes a new one where the box writes into none. Emptying the box removes its reply, unless something is attached, and the box then writes into nothing, so the next words start a new reply instead of landing in another one waiting. Submitting claims the reply and points the box at nothing, so what is typed while the send is in flight is a reply of its own. A failed send first writes any words typed since, then puts the reply back in the box only if those made no reply of their own.

The composer holds the words being typed. The draft gets them a beat later, and the inbox and the Drafts list read the draft. A composer that unmounts or moves to another draft writes its waiting words at once, and so does anything that adds to a draft with no composer showing it, so the next reader starts from them. Nothing else holds a copy of the typed words that could outlive its composer.

## What a draft does not do yet

- An open composer does not follow an edit made elsewhere to the words it is showing: its next write replaces them. Words changed elsewhere reach a composer as it next mounts.
- `send: auto` and `sendOn` are carried through as found. No build sends a draft on its own.
