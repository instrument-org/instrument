# Each device writes its chat list into the workspace, for a phone to open it from

Date: 2026-10-26

## Context

The workspace index ([plan](../plans/chat-list-index.md)) was kept out of the workspace on purpose: a SQLite file in a synced folder invites conflict copies, and "a derived file has no reason to travel with the workspace." A phone reading the workspace through iCloud Drive is that reason. It has no agent and no index of its own, and listing a chat means listing its folder, which waits on the sync engine folder by folder.

Timed on an iPhone opening a workspace it had never seen, from a folder picked in iCloud Drive (the iOS prototype's `scripts/icloud-trial.sh`):

| | 400 chats | 1,000 chats |
| --- | --- | --- |
| Every chat listed, from the chats' folders | 93 s | 202 s |
| Every chat listed, from one file of every row | 4.8 s | 4.5 s |
| That file's size | 288 KB | 747 KB |

Listing the folders is the cost: once they were listed, the 800 record files of 400 chats downloaded in about five seconds. A change written on a computer reached an open chat on the phone in four to six seconds either way, so the file is for the first open, not for keeping up.

## Options

- **Every chat's row, written whole by each device into its own folder.** One writer per file, as everything in the folder has, so the sync engine never chooses between versions. A reader takes the newest by `writtenAt`. Its size is the list's, whatever the history.
- **A synced store of rows** (`chatlist.jsonl`, a key per chat), reusing `SyncedFold`. Changes are small appends, but a first open reads every change ever made, which grows without end, and the phone would have to carry the fold.
- **A row per chat beside its records.** Still one file per chat to list and download, which is the cost being removed.
- **The app's own iCloud container**, where one metadata query lists every file. Timed slower than a picked folder, and a person's workspace lives where they put it.

## Decision

Each device writes `.instrument/devices/<device>/chat-list.json`: every chat's row as the live chat list has it (`ChatSchema`), less what only the running process knows and the opening message, written once the list is first read and then at most every ten seconds while it moves (`chat/chat-list-file.ts`). It is derived and disposable. The records stay the truth, and a reader shows the file's rows only until it has read the chats themselves.

A row is the desktop's own shape, so the phone ports reading it rather than inventing a list of its own, and a field this build does not write survives a newer build's write (`updateJsonRecord` carries it forward).

## Consequences

- Each write sends the whole file to the sync engine: about 750 KB for 1,000 chats, at most every ten seconds while a chat is busy, and nothing while every row stays as it was.
- The list a phone first shows can be a few seconds behind the records, and from whichever computer wrote last. It catches up as the phone reads the chats.
- A second subscriber to the live chat list runs in the workspace process. Rows come from the index, so a move reads only the chats it touched.
