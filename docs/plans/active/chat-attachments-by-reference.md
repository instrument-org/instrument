# Chat attachments by reference

**Status:** proposed, 2026-10-02. Nothing built. Held back while the window and Finder code is churning; written down so it lands before public chats pile up data in the old shape.

## Why

A file the person drops on a chat's composer, or picks with the paperclip, is copied into the chat's `attachments/` on send (`writeUploadedAttachments`). That copy is a holdover from when a task was sandboxed from the person's computer and a copy was the only way to hand it anything. In 2.0 the chat is the one deciding what a task gets, and the copy no longer protects anything:

- **The chat already reaches the file.** `folderReach` gives every chat the home folder and the Instrument folder, plus the folders sent in it and its topics' folders. A dropped file under home is already readable at its mount path; the copy is a second path to the same bytes.
- **The chat cannot change it.** The chat agent has no file tools and a shell that refuses to write (`message.ts`, the `throughTasks` comment). Tasks write, and a task sees only what the chat hands it. The original is not at risk through the chat.
- **The model gets paths, not bytes.** Attachments reach the model as an `<uploaded_files>` list of paths, so a reference that later goes stale costs a stale path, not an unsendable history.
- **The copy is not free.** Measured on this Mac (2026-10-02, Electron 42.3.3 / Node 24.15 / libuv 1.51): `fs.copyFile(..., COPYFILE_FICLONE)` wrote a full 1042 MiB for a 1024 MiB file. libuv does not clone on macOS (`COPYFILE_FICLONE_FORCE` is `ENOSYS`), so `93ab69d71`'s "copy-on-write where the filesystem allows" never took effect here. `cp -c` cloned a 2 GiB folder in 0.36 s with no space used.

## What already exists

2.0 has two ways for a message to carry a file, built at different times:

| | `chosen` (by reference) | Composer attachments (by copy) |
| --- | --- | --- |
| Filled by | Ask / New Chat from the Finder, the Finder selection or file tab a draft was opened over, what is in view behind a draft (`draft-context.ts`) | Drop on the composer, the paperclip, paste (`prompt-input.tsx` `processFiles`) |
| Shown as | a context chip (`ContextChip`, `IncludedChip`) | an attachment pill |
| Stored as | `data-viewContext.chosen`: kind, host path, name, and the mount path the chat reaches it at | `data-attachments.files`: a path relative to the task folder |
| Reach | `mountOfHostPath` against `state.attachedFolders`, which the state route fills from `folderReach`: the chat's real mount table, not a guess | n/a, it is a copy |
| Out of reach | `chosenNote` tells the agent "no folder you can reach covers it: ask for it with request_folder" | n/a |

The by-reference path is the right one and already has the behavior wanted for a file the chat cannot reach: no copy, and the agent negotiates access through `request_folder` (`878caf134`), which parks the turn on the system folder picker. Nothing in it is a heuristic about where people keep files; reach is path containment in the mount table the sandbox itself enforces, so it holds the same for `C:\Users\…` versus `D:\…` on Windows and for any Linux layout.

## Shape

### 1. Disk-backed items go as `chosen`, not as attachments

In a chat (an orchestrator task), a dropped or picked item that has a path on disk is added to the draft's `chosen`, shown as a context chip, and sent by reference. Files and folders alike: a dropped folder today becomes a folder grant through `onFoldersDropped`; it becomes a chosen folder instead, which the chat reaches if it is in reach and asks for with `request_folder` if not. That replaces a silent grant with an explicit one, which is the direction `agent-requested-folder-access.md` already took.

What still becomes an attachment, written to `attachments/` on send: content with no path on disk. A pasted image, pasted text, a file the browser hands over as bytes. That write is the only copy left in the chat path.

Tasks are unchanged. A task started directly (not a chat) keeps copying attachments, and the chat's `task new --file` still hands a task a copy in its own `attachments/`: that copy is the containment the orchestrator model relies on, and a task that should work on the original in place is handed the folder with `--folder`.

The Finder's drop on the composer (`finder-moving-files.md`, phase 3) goes through the same route, so a file dragged from our Finder into the chat is a chosen item, not a copy.

### 2. A dropped item opens where the draft can show it

The draft window is built around gathering tabs: it opens on the new-tab page, and the tab it was opened over and the tab in view behind it already go with the message. A dropped file can use that to show what is being sent and to teach that the computer is browsable from here.

| Where it is dropped | One file | One folder | Several items |
| --- | --- | --- | --- |
| A draft (compose window) | chip, and the file opens as a tab in the draft | chip, and a Finder tab opens on that folder | a chip each, and each opens as its own tab, up to five; past five, chips only |
| An existing chat's composer | chip only | chip only | chips only |
| Either, pasted content | attachment pill | n/a | attachment pills |

The chip is what goes; the tab is a preview of it. That split matters: the draft's own rules send the tab it was opened over and the tab in view, so a dropped file's tab alone would stop going the moment the person clicked to another tab. With the chip carrying it, closing or leaving the tab changes nothing, and `includedItemsOf` already leaves out anything the draft holds by name, so the same file is never said twice.

An existing chat does not open its pane on a drop: a reply is a quick act, and a pane sliding open beside the transcript moves the thing being typed in. Clicking a chip opens its item in the chat's pane instead, which gives the same "you can look around from here" on demand.

Several dropped items open as tabs, the same as one, since a tab per thing is what the draft already does when the person opens files and folders in it by hand. The cap is so a drop of forty photos is forty chips rather than forty tabs to close; five is a guess to revisit once it is used. A Finder tab showing them selected was considered and dropped: the Finder has no multiple selection yet, and selection is not a thing anyone reads as "these go with my message".

### 3. Clones for the copies that remain

`writeUploadedAttachments` copies on macOS with `cp -c` (the system's `clonefile(2)`) in a child process, falling back to `fs.copyFile` when the clone fails (another volume, a disk that is not APFS). `clonefile` refuses rather than silently byte-copying, so the fallback is exactly today's behavior and the clone path cannot be worse. Linux keeps `COPYFILE_FICLONE`, which libuv honors there (Btrfs, XFS). Windows copies (only ReFS can clone). The child process reads under the same macOS privacy grants as the app, so permissions do not change.

This covers `task --file` hand-offs and attachments to tasks started directly, the two copies that stay. It is independent of the rest and the smallest piece.

### 4. The stored shape

Chats stop writing `data-attachments.files` for disk-backed items; their files ride in `data-viewContext.chosen` with the host path, so the transcript draws them by host path (`files-grid` already draws a file by host path alone). `data-attachments` in a chat carries only pasted content and stays task-relative, since that content lives in the chat's folder.

No migration. Old messages keep their copies and render as they do. An old chat whose referenced file has moved, or whose folder is no longer in reach, asks for it again through `request_folder`; that is expected, not a regression.

Consumers to update with it: `attachments-card.tsx` and the chip row in `chat-stream.tsx`, `handedFiles` in `task.ts`, the files list in `orchestrator/chats.ts`, `session-to-markdown.ts`, `generate-title-from-user-message.ts`, `message-gap.ts`, the `<uploaded_files>` text in `message.ts` (pasted content only, for chats), and the test helpers and debug scenarios.

## Open issue found on the way

`chosenNote` writes each chosen item's **host path** into the model's context (`` the file `${entry.path}` ``) beside its mount path. `agent-requested-folder-access.md` rests on the main agent never learning host paths, since one written into a `python -c` is a capability the sandbox cannot take back. Routing every drop through `chosen` would put many more host paths in front of the chat. Before this lands, `chosenNote` should name an item by its mount path alone when it has one, and by its name alone (plus the `request_folder` ask) when it does not.

## Verifying

- Unit: the drop routing (a path in reach becomes a chosen item with a mount; out of reach, a chosen item without one; a pasted image an attachment), and `chosenNote` naming no host paths.
- Unit: the clone helper against a temp folder: clone on APFS, fallback on a mounted non-APFS disk image, sizes match either way.
- Evals (`pnpm eval run`, several models): attach a file under home and ask about it (read in place at its mount, no copy in the chat folder); attach one from a mounted disk image (the agent asks with `request_folder`, then reads it); ask for a task to edit an attached file (`task new --file` gives the task a clone, the original untouched); attach a folder (chosen, then reached or asked for).
- The running app: drop one file, one folder and several files on a draft and on an existing chat, and check the chips, the tabs opened, and what the transcript draws after sending.

## Order

| Step | Ships | Size |
| --- | --- | --- |
| 1. Clones | `cp -c` with fallback in `writeUploadedAttachments` | Small |
| 2. `chosenNote` without host paths | mount path or name only | Small |
| 3. Drops and picks as `chosen` in chats | routing, chips, the stored shape, consumers | Medium |
| 4. Tabs on drop in a draft | the open rules in the table above | Small |

Step 1 can ship alone. Step 2 goes before step 3, since step 3 multiplies what step 2 fixes. Step 4 is the most optional: steps 1 to 3 are the correctness change, step 4 is the teaching one.
