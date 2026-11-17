# The workspace folder kept to Files, Projects, Memory and Skills

Reviewed: `a7ae5541f^..a7ae5541f` (PR #209, one squash commit; 310 files, +7,812/−7,839, of which 178 files and +4,407/−4,103 outside tests, evals and fixtures)

A review of the merged workspace folder change, asked for after it had already been reviewed on its branch. Four readers worked blind (given `REVIEW.md` and the code at the merge, not the PR text or this folder), one per area: the launch migrations (`chats-folder/`, `legacy-outputs`, `drafts/move-in`, `upgrade-workspace`, the path resolver), the projects and memory stores (`chat/projects.ts`, `project-file`, `projects-move`, `memory/store`, `synced-store/synced-files`), apps (`apps/store`, `apps-move`, `capabilities/apps-setup`, Studio's apps routes), and the Studio side with the shell-call file watch (`written-folders`, the chat folder button, `tools/bash.ts`, `transcript/file-changes.ts`, the prompt). Every finding below was re-traced against the code at `a7ae5541f` and checked against the trailers on the branch commits that wrote those lines. Nothing was run: the review tree had no `node_modules`, so all of these are static traces. Calibration is `REVIEW.md`; each finding also carries a severity (S1 fix now, S2 fix soon, S3 worth doing, S4 note only).

Overall: the shape is right and simpler than what it replaces. Records stay in `.instrument/`, the migrations rename instead of copying, conversions read through `readOldFile`, and nothing widens what the agent can reach; drafts and the stores stay closed to it. No S1. The S2s cluster in three places: the shell-call watch, which moved from the chat's own folder to the shared `Files/` without changing what it trusts (A, B); "missing" and "now" standing in for "unknown" in the projects store, which hurts two computers sharing a workspace (C, D); and the two launch sweeps, which act on a name or a folder as a whole where their own commits say they should not (E to H).

## Findings

### A. Every shell call is credited with whatever changed anywhere in `Files/` while it ran, so one chat's folder button and file cards show another chat's work

- Status: fixed `396a8fc39`
- Severity: S2. Before this commit the watch covered the chat's own `Chats/<title>/`, so the comparison was only wrong when the person edited there; `Files/` is shared by every chat, its tasks, the person and the sync engine, and a call moved to the background keeps its window open until its process ends.
- Where: [bash.ts:277](/packages/workspace/src/tools/bash.ts#L277), [file-changes.ts:106](/packages/workspace/src/lib/transcript/file-changes.ts#L106), [written-folders.ts:82](/packages/workspace/src/lib/chat/written-folders.ts#L82)
- What: `watchChatFolders` snapshots `filesFolderPath()` before and after each call, and `changesBetween` records every created, changed or deleted file in between as the call's. Chat A starts a dev server in the background; while it runs, chat B saves `Files/Kyoto trip/day1.md` and the person deletes `Files/Old/x.pdf` in Finder. When A's server stops, A's step says it created the Kyoto file and deleted `x.pdf`, and `foldersChatWrote` offers `Files/Kyoto trip` in A's header. The same happens for a foreground call when two chats run at once. Separately, the walk stops at 2,000 files per folder ([file-changes.ts:41](/packages/workspace/src/lib/transcript/file-changes.ts#L41)), which a shared `Files/` reaches far sooner than one chat's folder did; past it, a `cp` into a folder the walk does not reach goes unrecorded.
- Fix shape: for `Files/`, trust only what the command names (the existing path check, extended to a named folder) plus files created after the call started inside a folder the command names; or keep the before/after comparison for foreground calls only.

### B. Work a project chat saves into its project's folder from the shell is never recorded, so it gets no file card and no folder button

- Status: fixed `396a8fc39`
- Severity: S2. The prompt sends project chats there, and before this commit they saved into the watched `Chats/<title>/`, so this is a regression for every project chat that finishes with `cp`/`mv`.
- Where: [system-prompt.ts:134](/packages/workspace/src/model-text/system-prompt.ts#L134), [bash.ts:277](/packages/workspace/src/tools/bash.ts#L277), [file-changes.ts:316](/packages/workspace/src/lib/transcript/file-changes.ts#L316), [file-changes.ts:181](/packages/workspace/src/lib/transcript/file-changes.ts#L181)
- What: the watch's folders are the work folder and `Files/`, and its variables only `INSTRUMENT_WORK` and `INSTRUMENT_FILES`; a word still starting with `$` after expansion is dropped. `cp plan.docx "$INSTRUMENT_PROJECT/"` in a chat filed under "Trip" is seen by neither the folder comparison nor the named-path check. Only `write_file`/`edit_file` writes there show up.
- Fix shape: add the filed project's folder (`filedProjectFolder`, [folder-reach.ts:121](/packages/workspace/src/lib/chat/folder-reach.ts#L121)) to the watch's folders and `FOLDER_VARIABLES.project` to its variables. If A is fixed by trusting named paths, this becomes the variable alone.

### C. A project folder that reaches a computer before its record gets a blank record stamped "now", which then outranks the real one everywhere

- Status: fixed `e544c51be`
- Severity: S2. This is the two-computer case the id file was introduced for, and the outcome is silent loss of every project's mark, color, about line and retired state across all devices. The architecture doc promises the opposite.
- Where: [projects.ts:344](/packages/workspace/src/lib/chat/projects.ts#L344), [project-records.ts:80](/packages/workspace/src/lib/chat/project-records.ts#L80), [synced-record.ts:160](/packages/workspace/src/lib/synced-store/synced-record.ts#L160), [synced-stores.md:39](/docs/architecture/synced-stores.md#L39)
- What: when a folder's id has no record, `settled()` builds one from the folder alone (front matter is already stripped by the first computer) and writes it with no `at`, so it is stamped with the current time. Computer A migrates and appends `devices/A/projects.jsonl`; the cloud drive delivers `Projects/*/.instrument-project` to B first (or B's copy of A's file is a placeholder that fails to read, which `synced-files.ts:51` skips silently). B lists projects, writes `{created}` for each, and when A's file lands its older stamps lose. The doc says "a folder that syncs ahead of the store keeps its project"; the test of that name runs on one device, where the record already exists.
- Fix shape: write the placeholder with `at: 0` (or the folder's birth time), as `settleMemoryFiles` already does for memories, so any real record outranks it. One line at the `toWrite.push`.

### D. Any error reading a project's `.instrument-project` counts as no id file, so the real id is written over, or every project read throws

- Status: fixed `e544c51be`
- Severity: S2. `REVIEW.md` names this pattern by name ("a read error taken as missing and the default then written back"), and the id file is now the only thing tying a renamed or 1.x project to its chats.
- Where: [projects.ts:731](/packages/workspace/src/lib/chat/projects.ts#L731), [projects.ts:759](/packages/workspace/src/lib/chat/projects.ts#L759), [projects.ts:318](/packages/workspace/src/lib/chat/projects.ts#L318), [projects.ts:406](/packages/workspace/src/lib/chat/projects.ts#L406)
- What: `readTextIfThere` and the async `.catch(() => undefined)` swallow every error. With no id file and no front matter id, the folder takes `unusedFolderId(name)` and `writeIdFileSync` writes that over the file. An evicted iCloud id file that fails to download while offline, under a folder renamed in Finder, loses its chats, and the wrong id syncs out. Where the write also fails (Windows sharing violation, read-only folder, `.instrument-project` being a directory), `writeIdFileSync` throws out of `settled()` uncaught, and `listProjects`, `createProject` and the folder-reach lookups fail for every project until that one folder is writable. `AGENTS.md` beside it already has the missing/unreadable split (`isMissing`).
- Fix shape: ENOENT alone is missing; on any other error treat the folder like an unreadable `AGENTS.md` (listed, nothing claimed or written), and wrap each `writeIdFileSync` in a per-folder catch.

### E. The `Chats/` sweep deletes `CHAT.md` by its name before it knows whose folder it is, on every launch and for any top-level `Chats/`

- Status: fixed `87c44aa87`
- Severity: S2. Two failures from one cause. The branch commit that wrote this rejected deleting a copied `CHAT.md` by its name alone (`d921af4a1`, `Rejected: delete a copied CHAT.md by its name alone`), and `conflict-copies.ts` requires the head to name a chat; the main file skips that test.
- Where: [move-chat-folders-to-files.ts:97](/packages/workspace/src/lib/chats-folder/move-chat-folders-to-files.ts#L97), [move-chat-folders-to-files.ts:104](/packages/workspace/src/lib/chats-folder/move-chat-folders-to-files.ts#L104), [chat-link.ts:23](/packages/workspace/src/lib/chats-folder/chat-link.ts#L23), [upgrade-workspace.ts:348](/apps/studio/src/electron-main/lib/upgrade-workspace.ts#L348)
- What: (1) The owner comes from the transcript's head, or else this computer's `chat-folders.json`. A `CHAT.md` kept by name only by a cloud drive yields nothing by design, and a chat made on the other computer has no entry here, yet line 100 deletes the transcript anyway. Its `attachments/` and handoff notes then go to `Files/<name>/` instead of back into the records, the move is recorded without a `chat`, and old messages' `attachments/<name>` links stay broken; the next launch cannot recover the owner because the transcript is gone. (2) The sweep runs at every launch over any `Chats/`, with no check that the folder is the app's. A person who later makes their own `Chats/` (or `chats/` on a case-insensitive disk) has its contents moved into `Files/` and any `Chats/*/CHAT.md` of theirs deleted.
- Fix shape: act on a subfolder only when its `CHAT.md` names a chat or the names file owns it; when the transcript exists but cannot be read, add the folder to `left` and wait. Delete `CHAT.md` after `returnToRecords`, not before.

### F. The move record always says a folder kept its name, so old paths open the wrong file when the folder or a file in it was numbered

- Status: fixed `87c44aa87`
- Severity: S2. The wrong-file case is silent: a link in an older chat opens a different document with nothing to say so.
- Where: [move-chat-folders-to-files.ts:114](/packages/workspace/src/lib/chats-folder/move-chat-folders-to-files.ts#L114), [move-chat-folders-to-files.ts:189](/packages/workspace/src/lib/chats-folder/move-chat-folders-to-files.ts#L189), [move-chat-folders-to-files.ts:203](/packages/workspace/src/lib/chats-folder/move-chat-folders-to-files.ts#L203), [resolve-workspace-file-path.ts:312](/packages/workspace/src/lib/resolve-workspace-file-path.ts#L312)
- What: `moves.push({ from: entry.name, to: entry.name })` regardless of what `moveFolder` did. When `Files/X/` already exists (a 1.x output moved to `Files/<title>/`, or an agent-named folder), clashing files land as `notes 2.md`, and `Chats/X/notes.md` then resolves by prefix to the pre-existing `Files/X/notes.md`. When a file holds the name, the folder lands as `X 2` and every old path under it resolves to nothing.
- Fix shape: have `moveFolder` report where things went; record the real folder name, and on a merge either record per-file renames or move the incoming folder whole under a numbered name so one prefix still maps.

### G. Taking an app in sends its whole `Apps/<Name>/` folder to the Trash, with whatever else the person or the agent kept in it

- Status: fixed `b78537de9`
- Severity: S2. Recoverable from the Trash, but nothing in the app or log says files went there, and the branch's own `dab7efb16` commits to the launch never trashing a top-level folder that holds anything the person put there; the rule was applied to `Apps/` but not to the folders inside it.
- Where: [app-folders-to-store.ts:105](/packages/workspace/src/lib/app-folders-to-store.ts#L105), [app-folders-to-store.ts:116](/packages/workspace/src/lib/app-folders-to-store.ts#L116)
- What: once `APP.md` (or `app.json`/`guide.md`) and the icon are in the store, `trash(path.join(dir, folder))` takes the folder. `Apps/Linear/api-notes.md` or a script the earlier build's agent kept there goes with it; the log line says only "took in … as linear".
- Fix shape: trash only the files taken in (`APP.md`, `app.json`, `guide.md`, `icon.*`), then the folder only if `holdsNothingOfAnyones` says it is empty.

### H. The `Apps/` sweep reads `guide.md` through a link outside the sandbox and the agent can print what it pointed at

- Status: fixed `b78537de9`
- Severity: S2. A containment crossing: the read happens in the main process, outside every rule, and the result comes back to the agent through `instrument app guide`. It predates this commit, but the commit rewrote these lines and runs them at every launch over a top-level `Apps/` the agent can create.
- Where: [app-folders-to-store.ts:190](/packages/workspace/src/lib/app-folders-to-store.ts#L190), [apps-setup.ts:260](/packages/workspace/src/lib/capabilities/apps-setup.ts#L260)
- What: the agent writes `Apps/x/app.json` (any valid setup) and makes `Apps/x/guide.md` a link to a file its settings refuse, such as `~/.ssh/id_rsa` or a document in a Not allowed folder. The next launch reads the target with `readOldFile` (plain `readFile`, which follows links) into `apps.jsonl`, and `instrument app guide x` prints it. The icon read beside it already refuses links (`readBytes(…, { ownFolder })`, `icon.ts:86`).
- History: `REVIEW.md` excludes "the agent planting a link that a later agent or the app then reads" as outside the threat model, while `threat-model.md:88` says "a link the agent planted itself is not a race". This reads as the second: the app is the one crossing the line on the agent's behalf. The fix costs no new code path.
- Fix shape: read `APP.md`, `app.json` and `guide.md` the way the icon is read (`lstat` and refuse anything but a plain file inside the folder), and leave the folder in place when it refuses.

### I. A new project named like a deleted one takes the deleted one's id, with its chats and the folders granted to it

- Status: fixed `e544c51be`
- Severity: S3. A consequence of a deliberate choice, recorded here so it is weighed rather than rediscovered. `311677b17` draws a new project's id from its name "so two computers that see a folder before its id file agree on it", and in the same breath says the removed rename guess was wrong because "it gave a deleted project's id, chats and retired state to the next folder made". Same name, same id: that outcome is back for a reused name.
- Where: [projects.ts:656](/packages/workspace/src/lib/chat/projects.ts#L656), [projects.ts:365](/packages/workspace/src/lib/chat/projects.ts#L365)
- What: make "Taxes", grant it `~/Documents/Finance`, file chats under it, delete the folder in Finder; a later "Taxes" made in the app gets the same id, shows the old chats, and its chats reach the old grant without a new card. The grant does show in the project's settings, so this is not hidden, but the person did not grant it to this project.
- Fix shape: weigh against the two-computer agreement it buys. The cheap half is counting ids that already have a record (or a `projects` grant) as taken when the app makes a project, which still agrees across computers whenever the store has synced.

### J. Smaller notes from the `Chats/` sweep

- Status: fixed `87c44aa87`
- Severity: S4
- Where: [move-chat-folders-to-files.ts:78](/packages/workspace/src/lib/chats-folder/move-chat-folders-to-files.ts#L78), [move-chat-folders-to-files.ts:124](/packages/workspace/src/lib/chats-folder/move-chat-folders-to-files.ts#L124)
- What: moves are recorded only in the `finally`, so a killed process leaves folders moved but unrecorded and their old paths unresolved (`legacy-outputs.ts` records before moving); the loop has no per-folder catch, so one `EBUSY` on Windows stops every later folder for that launch; any `readdir` error on `Chats/` deletes the names file, the only clue to folders whose `CHAT.md` cannot be read; and an absolute `…/Chats/X/attachments/a.png` maps into `Files/X/attachments/` although the sweep put that file back in the chat's records.

## Confirmed tradeoffs

- Credentials stay bound to their origin (`origin-bound.ts`, `new URL().origin`), so any credential a setup change fails to clear is never sent to another host.
- `.instrument/` stays closed to the agent: drafts reopen read-only as the top-level `Drafts/` did, memory stays read-only for tasks, and the device stores are unreachable. Nothing is widened.
- Conversions that delete their source read it through `readOldFile` and write the store before trashing.
- The 1.x output move and the drafts move-in record before moving and number clashes rather than overwrite.
- A copy of a project folder (two folders naming one id) gives the older folder the id and the copy its own.
- Unparsable front matter leaves the file alone; unknown keys and `folders:` stay for the steps that read them.
- Export as Markdown goes through the main-process save dialog; the renderer only calls RPCs.

## Not covered

Evals, fixtures and the migration rehearsal tests were not read. Windows and Linux paths were checked by reading only.
