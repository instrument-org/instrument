# Workspace layout merge hunt

Reviewed: snapshot at `91b446747`

A retroactive review of the workspace-layout merge and what landed around it, read as the code stood at one commit rather than commit by commit. Four hunters each read the tree with one lens, looking for architectural choices that get expensive once 2.0 ships and for twins of recently fixed bugs. A separate verifier per lens tried to refute each finding, re-read every excerpt at its line, probed the topic-folder hole against the real permission rules, and timed the launch pass on a copy of a 688-chat workspace. Fifteen candidates went in; the ones below were delivered.

## Findings

### A. The agent can widen its own folder access by editing a topic file

- Status: fixed `5a3e53972`
- Where: [folder-reach.ts:130](/packages/workspace/src/lib/chat/folder-reach.ts#L130), [topic-file.ts:52](/packages/workspace/src/lib/chat/topic-file.ts#L52), [rules.ts:411](/packages/workspace/src/lib/permissions/rules.ts#L411)
- What: once the person picks a workspace folder, its top level is the agent's output folder, so the agent can add a `folders:` list to a `TOPIC.md`. The next command rereads it and the topic's folders become allow rules ranked as grants, above a Not allowed folder and the built-in places, with no card. The file also syncs, so a grant made on one computer opens the same-named path on another.
- Note: `0e8511308` closes the follow-on case of a computer new to the workspace importing every `folders:` key at launch.

### B. Two computers can give two different chats the same id

- Status: fixed `12e8fb3b9`
- Where: [chat-folder-name.ts:27](/packages/workspace/src/lib/chat-folder-name.ts#L27)
- What: a chat id was the date, up to 24 characters of the first words (or `chat`), and a counter over ids this computer can see, with no random part. Two unsynced computers mint the same id for chats that open with the same words, and every chat opened in CJK text, emoji or with only an attachment is `<date>-chat` on both. The id names the record folder, the work folder and the grants, so a clash merges two conversations or skips one.

### C. Every message rewrites a chat settings file every computer shares

- Status: fixed `890d02d62`
- Where: [chat-settings.ts:38](/packages/workspace/src/lib/chat-settings.ts#L38), [record-folders.ts:209](/packages/workspace/src/lib/record-folders.ts#L209)
- What: each send rewrote the whole `settings.json` (model, then an activity stamp), as did turn starts and wakes, so a model picked on one computer is overwritten by the other's next message before sync lands. The chat list found a chat only through the session id in that file, so a damaged or late file hid the chat though its records were intact. The chat-records plan specified per-device settings and was marked landed without them.
- Note: the per-device settings format landed in `41b385be1` and the model moved there in `a6dd21f9f`; `890d02d62` stops writing `settings.json` and derives the chat's session and activity from its logs. 2026-10-19-accept-the-staggered-upgrade-gap-for-chat-settings.md records the accepted gap for a computer still on the earlier build.

### D. Attached files are stored by this computer's full path, permanently

- Status: fixed `bbd89491e`
- Where: [write-uploaded-attachments.ts:188](/packages/workspace/src/lib/write-uploaded-attachments.ts#L188), [message-data-part.ts:121](/packages/workspace/src/schemas/session/message-data-part.ts#L121)
- What: a file attached by path went into the append-only, synced record as its absolute path, including files inside the workspace, and the stored-path rewrite on a workspace move skips records. On a computer with another user name, on Windows, or after the workspace moves, the chip and the model's note name a missing file.
- Note: `b94ee415b` extends the same `workspace:/` form to the other paths the app writes into message parts.

### E. Saving drafts deletes a draft that just arrived from another computer

- Status: fixed `8df5e5b90`
- Where: `drafts-folder.ts:129`
- What: the window saved all drafts as one list, and the save removed every `DRAFT.md` (pasted files included) whose id the list lacked. A draft synced in from another computer waits about 150 ms on disk before the window hears of it, and a save in that gap deletes it; the deletion then syncs back.

### F. Bookmarks saved on one computer overwrite the other's

- Status: fixed `574623fff`
- Where: [kept-state.ts:58](/apps/studio/src/electron-main/stores/workspace/kept-state.ts#L58)
- What: bookmarks were one array in a synced file, read once per launch and rewritten whole from memory, so each computer's next bookmark wipes what the other added.

### G. Two computers can run one chat's turn at the same time

- Status: declined
- Where: [message.ts:181](/packages/workspace/src/rpc/routes/message.ts#L181), [fold.ts:39](/packages/workspace/src/lib/records/fold.ts#L39)
- What: nothing tells one computer that the other is mid-turn, so a follow-up starts a second turn, and the transcript and later model requests interleave by each computer's clock. The fold computes a forked flag nothing reads. The review's argument for acting before 2.0: older builds skip record kinds they do not know, so a turn record added later is ignored by every build already installed.
- Declined because: two turns only overlap when a person sends a message on each computer while the other is mid-turn (nothing sends on its own), and multi-computer use is supported only as format compatibility, with no cross-computer experience; the chat-records plan chose no lease between devices in v1. Revisit when cross-computer use is built and tested, keeping in mind the record-kind argument above.

### H. Renaming a chat's folder while the app runs splits its work into two folders

- Status: fixed `cdf24d8fe`
- Where: [chat-folder.ts:66](/packages/workspace/src/lib/chat-folders/chat-folder.ts#L66), `sweep.ts:219`
- What: the app knew a chat's `Chats/` folder only by a stored name, and at the end of a turn a missing named folder was answered by claiming a fresh one from the title. A rename in a file manager while the app runs left finished work in two folders, and the launch adoption never reconnected the renamed one because nothing was missing any more. `CHAT.md` already carried the chat id to find it by.

### I. Every launch reads every chat's whole history before the window opens

- Status: fixed `18b015bd1`
- Where: `sweep.ts:207`, [create-workspace-actor.ts:164](/apps/studio/src/electron-main/lib/create-workspace-actor.ts#L164)
- What: boot awaited a pass that read, folded and rendered every chat's logs and every `CHAT.md`, even when nothing changed, while its comments claimed it cost a folder listing. Measured at about 300 ms for 688 chats, growing linearly.

### J. REVIEW.md protects files the app no longer has

- Status: fixed `f191c99aa`
- Where: [REVIEW.md:12](/REVIEW.md#L12)
- What: the data-loss rule named `chat.db`, lowercase `topics/` and `.instrument/window.json` (which launch deletes) and said nothing of state files, settings logs or `TOPIC.md`; the containment line called the workspace root read-only while it is the output folder. REVIEW.md calibrates automated review, so the drift steers every later reviewer.

### K. The layout module and the guides still point at the old folders

- Status: fixed `6083b3926`
- Where: [workspace-layout.ts:112](/packages/workspace/src/lib/workspace-layout.ts#L112), [AGENTS.md:15](/packages/workspace/AGENTS.md#L15), [threat-model.md:33](/docs/architecture/threat-model.md#L33)
- What: `workspaceLayout` still mixes migration-only `.instrument/` entries (skills, topics, drafts, memory) with live ones, so nothing says which paths are live. The package guide cites `Store.getMessagesWithParts`, `.instrument/skills/` and `chat.db`; the system overview and sandbox docs name `.instrument/apps/` and `.instrument/skills/`; the threat model cites a `chat` command that no longer exists. Agents build from these docs.

## Not covered

MXC and the Windows sandbox, the AI gateway, the in-app browser, and most UI. The review read the tree at one commit, so it did not re-read individual commits or mark findings as old or new.
