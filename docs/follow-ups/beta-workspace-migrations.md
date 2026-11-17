# When the beta-only workspace migrations can be deleted

**Status:** open · **Check after:** 2026-12-15, and only once a build that runs these migrations has been the newest release for four weeks · **Last checked:** never

## What we're waiting to learn

At launch, the app converts workspace layouts that only 2.0 betas ever wrote. No 1.x build wrote any of them, so once every beta workspace has launched a build that converts it, the code does nothing but cost launch time and maintenance. The question is when that point has passed.

The beta-only migrations:

- `chats-folder/` (except `folder-moves.ts`): empties `Chats/<name>/` and its `CHAT.md` into `Files/`, the records and the drafts.
- `app-folders-to-store.ts` (`moveAppFoldersToStore`): takes `Apps/<Name>/APP.md` and `.instrument/apps/<slug>/` into the apps store.
- The front matter takeovers `moveMemoryFrontMatterToStore` (`memory/store.ts`) and `moveProjectFrontMatterToStore` (`projects-move.ts`), which move what a memory file's or an `AGENTS.md`'s front matter recorded into the memory and projects stores, and the `Topics/` move in `projects-move.ts`.
- Their steps in `apps/studio/src/electron-main/lib/upgrade-workspace.ts`.

These stay, whatever the answer:

- `chats-folder/folder-moves.ts` and the `chatfoldermoves` store. Records are append-only and are never rewritten, so a `workspace:/Chats/...` path in an old chat is found through these moves for as long as that chat exists (`resolve-workspace-file-path.ts`).
- The 1.x path: `migrate-workspace-layout.ts` (the top-level `tasks/`) and `legacy-outputs.ts`. A 1.x user can upgrade at any time.

One thing to remove at the same time: what `split-chat-records.ts` set aside, each old task's own records (`task.db`, logs, screenshots) under `.instrument/.pre-chats/chat-task-records/`. Each of those tasks is already a session in its chat's records, so the copy is never read, and on a workspace used through the betas it is hundreds of megabytes and thousands of files that a cloud drive syncs to every computer. The split itself stays, since the 1.x path runs it, so the step to add removes a `chat-task-records/` folder only once it is older than the check's four weeks, which a 1.x upgrade's fresh one is not.

## The signal

- Problem reports and launch logs from beta testers show only versions at or after the first release that carries these migrations, and none of them reports a leftover `Chats/`, `Apps/` or `Topics/` folder, or front matter left in `AGENTS.md` or a memory file.
- Any report from a build older than that release means a workspace may still be waiting for its conversion.

## Where to look

The version on each recent problem report (the reports CLI in the `internal` reference), and the `upgrade.moveChatFoldersToFiles` and `upgrade.moveAppFoldersToStore` boot steps in a tester's launch log, which report what they moved.

## What each answer means

- **Every tester is past the release:** delete the beta-only migrations listed above, their tests and their launch steps, add the launch step that removes an old `.pre-chats/chat-task-records/`, keep the pieces listed as staying, and update `docs/architecture/synced-stores.md`, `chat-records.md` and `system-overview.md`, which describe the takeovers.
- **Someone is still on an older build:** move the date, and ask them to update.

## Result

Not yet checked.
