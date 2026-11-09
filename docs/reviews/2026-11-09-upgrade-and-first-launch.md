# Upgrade and first launch

Reviewed: snapshot at `f56a982f8`

A review of what an existing install goes through to reach this build, and of first launch: the workspace layout sweeps, the 1.x task migration and the `chat.db` converter, this computer's stores, keys and permissions across an upgrade, setup, and the update path with version skew. Six readers read the code blind against `REVIEW.md`, one area each, and a sixth surveyed structure. The findings marked "checked" were then read again at the cited lines; the rest stand on one reader's trace. Nothing was run except where a finding says so.

## Findings

Ordered by what to fix first.

### A. A build with a prerelease version follows the `latest` feed

- Status: declined
- Where: [update.ts:415](/apps/studio/src/electron-main/lib/update.ts#L415), [notices.ts:62](/apps/studio/src/electron-main/lib/notices.ts#L62)
- What: `getChannel()` returns nothing unless the `releaseChannel` preference is set, and its only writers are the `!beta` command and the Developer settings. A person who installs a `-beta` build and never types that reads `latest` on every check and is told they are up to date for good, while `currentChannel()` tells the notices service the build is on beta. Checked.
- Declined because: this is the intended behavior. A prerelease build follows the beta feed only where someone chose that channel; anyone else handed one takes the next release, which is newer than it, and nobody is left following prereleases by accident. It would need revisiting if prerelease builds were ever handed out with the expectation that they keep receiving prereleases.
- Note: `currentChannel()` in `notices.ts` still infers `beta` from the version where `update.ts` follows `latest`, so the notices service and the updater can disagree about such a build. Left as it is, since what the service does with the channel is not in this repository.

### B. A chat the converter leaves on its `chat.db` opens empty and takes a message, which leaves it unconvertible

- Status: fixed `f89a0c5e4`
- Where: [convert-chat.ts:205](/packages/workspace/src/lib/records/convert/convert-chat.ts#L205), [:232](/packages/workspace/src/lib/records/convert/convert-chat.ts#L232), [workspace-launch-sweeps.ts:252](/apps/studio/src/electron-main/lib/workspace-launch-sweeps.ts#L252)
- What: a conversion that fails or does not verify leaves the chat listed and empty. A message sent there is a record that holds history, so every later launch compares the records with the database, finds the database's messages missing and answers `half-written`: the old conversation stays in a file nothing reads while the bell says the next launch tries again. Checked by reading; the send itself was not driven.
- Note: not the same as `2026-10-20-last-week` M, which was the move aside failing after a good conversion. Fixed by keeping such a chat out of the chat index for the launch (`withholdChats`), so nothing can open or write it until a launch converts it.

### C. A 1.x task whose database will not open read-only stays in `tasks/` with no retry and no notice

- Status: fixed `36130b3a5`
- Where: [migrate-legacy-tasks.ts:615](/packages/workspace/src/lib/migrate-legacy-tasks.ts#L615), [:216](/packages/workspace/src/lib/migrate-legacy-tasks.ts#L216), [migrate-workspace-layout.ts:239](/packages/workspace/src/lib/migrate-workspace-layout.ts#L239)
- What: `readConversation` opens `task.db` with `readOnly: true` and takes any error as unreadable. A 1.x database left with a hot rollback journal by a crash or a force quit cannot be read that way. Unreadable tasks are not counted as left over, so the layout mark is written and the sweep never runs again; the only trace is a log line. One reader reproduced the read-only failure against a database whose writer was killed mid-transaction, where a read-write open read the row. Checked.
- Note: fixed by reading old stores through a copy opened for writing (`readStoreCopy`), in `holdsSessions` too. A database that still cannot be read stays uncounted on purpose: no launch settles it, and counting it would run the sweep at every launch (the test "names a task whose database cannot be read and leaves it where it is" pins that).

### D. A body file that fails to read is taken as empty, and the original is then deleted

- Status: fixed `6cfc9503f`
- Where: [projects-move.ts:111](/packages/workspace/src/lib/projects-move.ts#L111), [apps-move.ts:141](/packages/workspace/src/lib/apps-move.ts#L141), [drafts/migrate.ts:97](/packages/workspace/src/lib/drafts/migrate.ts#L97)
- What: the project, app and draft conversions read the old body with `.catch(() => "")`, write the new file, check only that its id reads back, and remove the source. Any error other than "not there" (a file a cloud service keeps by name only while offline, EACCES, EIO) loses a project's instructions, an app's guide or a draft's words, and in a synced folder the delete reaches the other devices. These steps run for every workspace, picked folders included. Checked.

### E. A launch step creates `permissions.json` before the step that reads its absence as "no build ran here"

- Status: fixed `6cfc9503f`
- Where: [move-project-folders.ts:62](/packages/workspace/src/lib/permissions/move-project-folders.ts#L62), [convert-chat-settings.ts:168](/packages/workspace/src/lib/records/convert/convert-chat-settings.ts#L168), [workspace-launch-sweeps.ts:103](/apps/studio/src/electron-main/lib/workspace-launch-sweeps.ts#L103)
- What: `moveProjectFolders` takes in nothing when the file is missing, since the folders a project lists were then granted on another computer. `convertChatSettings` runs earlier in the same launch and creates the file when a chat's `settings.json` has grants, so on a computer new to the workspace every `folders:` list in every project's `AGENTS.md` is granted with no card. This widens what the agent reaches. Checked.
- Note: `carryPermissions` also carries a chat's path grants from a `settings.json` another computer may have written. Decide and stamp the mark before any step can create the file.

### F. With no keyring, four key stores write an empty string over the encrypted file

- Status: fixed `474ce35cc`
- Where: [key-file.ts:44](/apps/studio/src/electron-main/lib/key-file.ts#L44), [session.ts:139](/apps/studio/src/electron-main/stores/workspace/session.ts#L139), [provider-configs.ts:71](/apps/studio/src/electron-main/stores/workspace/provider-configs.ts#L71)
- What: when encryption is unavailable the serializers return `""`, which the store writes. On a Linux launch with no reachable keyring the sign-ins read as gone, and the next write (signing in again, turning a provider off) replaces the real file. `chatgpt-account.ts` and `grok-account.ts` do the same; `app-oauth.ts` and `app-credentials.ts` throw, which is the safe answer. Checked for the session and provider stores.

### G. A failed plan read at launch counts as no plan and is not read again

- Status: fixed `138611996`
- Where: [setup-facts.ts:176](/apps/studio/src/electron-main/lib/setup-facts.ts#L176), [:109](/apps/studio/src/electron-main/lib/setup-facts.ts#L109)
- What: `refreshPlanFact` swallows a failed read and still records the sign-in as tried, and it runs once per process and on a token change. Someone whose only AI is their Instrument plan and who launches offline or while the API is down is put on setup's choose-AI step with their chats behind it, and coming back online changes nothing until a relaunch. Checked.

### H. A folder that half moves out of `.instrument/` is never looked at again

- Status: fixed `6cfc9503f`
- Where: [move-out-of-data-dir.ts:59](/packages/workspace/src/lib/move-out-of-data-dir.ts#L59), [:89](/packages/workspace/src/lib/move-out-of-data-dir.ts#L89)
- What: the move returns `already-there` whenever the top-level folder has anything in it. A rename that fails once (no retry, so one Windows EPERM is enough) followed by the app or the person putting something in `Memory/`, or a per-entry move that stops after its first success, leaves the rest in the hidden folder, which nothing reads. The file's own comments say the next launch moves them. Checked.

### I. One task that throws aborts the layout sweep, and the case fix then hides what it did not move

- Status: fixed `6cfc9503f`
- Where: [migrate-workspace-layout.ts:781](/packages/workspace/src/lib/migrate-workspace-layout.ts#L781), [key-folder-case.ts:31](/packages/workspace/src/lib/key-folder-case.ts#L31), [workspace-launch-sweeps.ts:109](/apps/studio/src/electron-main/lib/workspace-launch-sweeps.ts#L109)
- What: `normalizeTasks` has no per-task catch over bare renames, so one held file in one task skips the 1.x migration and the split for that launch, and a persistent error does so every launch. `settleKeyFolderCase` then runs regardless and renames a lowercase `projects/` or `chats/` the sweep did not get to, which the sweep looks for by its lowercase name. The loop and the unconditional case fix were checked; the sequence into the rename was not.

### J. A staged 1.x chat that fails to finish twice stays hidden

- Status: fixed `36130b3a5`
- Where: [migrate-legacy-tasks.ts:472](/packages/workspace/src/lib/migrate-legacy-tasks.ts#L472)
- What: `finishStagedChats` swallows a failure without counting it, so the second launch writes the layout mark over a `chats/.<name>.partial` every reader skips. Checked.

### K. A store file that is not JSON fails the launch every time

- Status: fixed `474ce35cc`
- Where: [preferences.ts:63](/apps/studio/src/electron-main/stores/machine/preferences.ts#L63)
- What: the plain stores call `JSON.parse` unguarded in `deserialize`, and nothing sets `clearInvalidConfig`; only `model-cache.ts` guards it. An empty or truncated `machine-preferences.json` throws at module load, before the boot failure handler is attached. The unguarded parse was checked; the load order was not.

### L. A `workspace.json` that is there but does not parse is opened and written again from defaults

- Status: open
- Where: [workspace-refusal.ts:183](/apps/studio/src/electron-main/lib/workspace-refusal.ts#L183), [workspaces.ts:319](/apps/studio/src/electron-main/lib/workspaces.ts#L319)
- What: two readers reached this separately. The format, layout and settings versions go back to zero, the migrations run again, and the newer-build guard is lost for every device. `apps/studio/AGENTS.md` says such a record is never opened. Not checked.

### M. Permission rules read an unreadable file as no rules, and one bad entry empties a list for good

- Status: open
- Where: [rules.ts:199](/packages/workspace/src/lib/permissions/rules.ts#L199), [:66](/packages/workspace/src/lib/permissions/rules.ts#L66)
- What: every "never" becomes "ask" while the file cannot be read, and a list with one entry that fails to parse reads as empty and is written back empty. The same `.catch([])` drops all of a chat's grants on conversion when one path is not absolute on this system. Not checked.

### N. Setup's wait on the website reports its timeout as ready

- Status: open
- Where: [client.ts:231](/apps/studio/src/electron-main/auth/client.ts#L231), [use-connect.ts:32](/apps/studio/src/client/hooks/use-connect.ts#L32)
- What: after thirty minutes the choose-AI step is answered with an account that can run nothing. Back recovers it. Not checked.

### O. Installs older than the build that learned the new Windows publisher name refuse a package signed under it

- Status: open
- Where: [constants.ts:152](/packages/shared/src/constants.ts#L152), [update-signature.ts:90](/apps/studio/src/electron-main/lib/update-signature.ts#L90)
- What: a constraint on when the certificate may change, not a defect in this tree. `docs/architecture/auto-updater.md` says installed builds accept it, which is true only from the build that added the name. Not checked.

### P. Chat records have no reader-version guard below the workspace format

- Status: open
- Where: [record.ts:26](/packages/workspace/src/lib/records/record.ts#L26), [read-records.ts:76](/packages/workspace/src/lib/records/read-records.ts#L76)
- What: an older build skips a line it cannot parse, so a chat a newer build wrote to shows without those messages and its agent carries on without them. Nothing is destroyed. Not checked.

## Structure

Where the findings above share a root.

- **One outcome for a launch step.** The layout sweep, the 1.x migration, the split and the converter each decide retry, mark and notice their own way, which is how C, I and J came to write a mark over unfinished work. One `done | retry | stuck` result read in one place, and one ordered table of the steps with each one's gate.
- **One strict convert.** Read the source (only "not there" is missing), write to a temporary file, check the whole content, rename, then remove the source, keyed on the source still being there. Covers D and the interrupted project and draft conversions.
- **One move.** `move-out-of-data-dir.ts`, `projects-move.ts`, `drafts/migrate.ts` and the private copies in `migrate-workspace-layout.ts` and `fold-task-work-dir.ts` use bare renames with their own collision rules; `move-entry.ts` already has the retrying one.
- **One atomic write.** About twelve copies that differ on fsync, the Windows rename retry and the temporary name. `updateJsonRecordSync` renames without the retry its async twin documents ([json-record-file.ts:156](/packages/workspace/src/lib/json-record-file.ts#L156)).
- **One store factory.** The machine and workspace stores and `key-file.ts` hand-roll three failure behaviors (throw, defaults, an empty file); `kept-state.ts` already refuses to write over a file it could not read. Covers F and K.
- **One containment helper.** Four named helpers with different argument orders and about eight inline copies; two are both called `isAtOrUnder` with the arguments reversed.
- **The legacy chain has no retirement rule.** 1.x tasks become a `chat.db`, which is split, then converted to records, then has its settings converted, so every hop stays alive while the first does.

## Not covered

The send path of a first chat with no model, an expired sign-in or the API down. `workspace-move.ts` and the cloud placeholder download. Whether converting hundreds of chats holds up the first window. The Windows signing scripts and the build legs of the release workflow. Import cycles and module-level state. The individual store migrations' bodies.
