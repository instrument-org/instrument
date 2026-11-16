# When the beta-only workspace migrations can be deleted

**Status:** open · **Check after:** 2026-12-15, and only once a build that runs these migrations has been the newest release for four weeks · **Last checked:** never

## What we're waiting to learn

At launch, the app converts workspace layouts that only 2.0 betas ever wrote. No 1.x build wrote any of them, so once every beta workspace has launched a build that converts it, the code does nothing but cost launch time and maintenance. The question is when that point has passed.

The beta-only migrations:

- `retire-chats-folder/` (except `folder-moves.ts`): empties `Chats/<name>/` and its `CHAT.md` into `Files/`, the records and the drafts.
- `apps-move.ts` (`takeInAppFolders`): takes `Apps/<Name>/APP.md` and `.instrument/apps/<slug>/` into the apps store.
- The front matter takeovers `settleMemoryFiles` (`memory/store.ts`) and `settleProjectFiles` (`projects-move.ts`), which move what a memory file's or an `AGENTS.md`'s front matter recorded into the memory and projects stores, and the `Topics/` move in `projects-move.ts`.
- Their steps in `apps/studio/src/electron-main/lib/workspace-launch-sweeps.ts`.

These stay, whatever the answer:

- `retire-chats-folder/folder-moves.ts` and the `chatfoldermoves` store. Records are append-only and are never rewritten, so a `workspace:/Chats/...` path in an old chat is found through these moves for as long as that chat exists (`resolve-workspace-file-path.ts`).
- The 1.x path: `migrate-workspace-layout.ts` (the top-level `tasks/`) and `legacy-outputs.ts`. A 1.x user can upgrade at any time.

## The signal

- Problem reports and launch logs from beta testers show only versions at or after the first release that carries these migrations, and none of them reports a leftover `Chats/`, `Apps/` or `Topics/` folder, or front matter left in `AGENTS.md` or a memory file.
- Any report from a build older than that release means a workspace may still be waiting for its conversion.

## Where to look

The version on each recent problem report (the reports CLI in the `internal` reference), and the `sweep.retireChatsFolder` and `sweep.takeInAppFolders` boot steps in a tester's launch log, which report what they moved.

## What each answer means

- **Every tester is past the release:** delete the beta-only migrations listed above, their tests and their launch steps, keep the pieces listed as staying, and update `docs/architecture/synced-stores.md`, `chat-records.md` and `system-overview.md`, which describe the takeovers.
- **Someone is still on an older build:** move the date, and ask them to update.

## Result

Not yet checked.
