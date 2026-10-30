# Async access to the synced workspace folder

Status: open. Steps 1 and 2 are done: "workspace: add async reads of workspace files that can pass over evicted ones" built the module, "workspace: pass over evicted activity files instead of blocking on them" the activity tail, and "workspace: read other devices' synced store files off the main thread" the synced store. Before them, `0e2063521` took the chat folder lookup (`chatLinkedInFileSync` in `chat-folders/own-folder.ts`) off sync reads of evicted files, and `d8fa5361e` added the slow-scan log and per-step launch timings. Steps 3 to 6 are open.

## Problem

A workspace can live in a synced folder (iCloud Drive, Dropbox, OneDrive), and the sync service may keep any file there by name only: a placeholder with no contents on disk until something reads it. On macOS such a file is marked dataless. A read of one does not fail. It blocks the calling thread inside `pread` until the service downloads the file, which takes seconds per file and longer on a slow network.

Everything in `packages/workspace` and Studio's main process runs on the Electron main thread, which also pumps the window's native events. A sync read of an evicted file there freezes the app, and macOS shows a beach ball. The first case found took six minutes: the chat folder lookup read every `Chats/*/CHAT.md` with `fs.readSync`, on a computer opening an iCloud workspace for the first time, with 280 of 414 files evicted. A sample of the main process put 2182 of 2185 samples in `pread`.

`async` on the function does not help. A handler declared `async` that calls `fs.readFileSync` still holds the thread for the whole read; only an awaited `fs.promises` call hands the read to libuv's thread pool. `listApps` (`apps/store.ts`) is the clearest example: it is `async`, and reads every `APP.md` synchronously inside a `.map`.

Metadata calls (`stat`, `lstat`, `readdir`, `existsSync`, `realpath`) do not download a file, so they are cheap even on an evicted one. The danger is reading contents: `readFileSync`, `openSync` plus `readSync`, `appendFileSync`, and the repo's sync wrappers over them (`readJsonRecordSync`, `updateJsonRecordSync`, `readOwnFile`).

Moving the workspace to a utility process ([agent turn off the main thread](agent-turn-off-the-main-thread.md)) changes the symptom, not the cause: a sync read there stalls every chat in the workspace instead of the window. So this plan stands on its own and should land first.

## The rule

Nothing reads the contents of a file in the synced workspace folder synchronously while the app runs. The synced folder is the workspace root (`rootDir`): the person's own folders at its top level (`Chats/`, `Topics/`, `Drafts/`, `Apps/`, `Skills/`, `Memory/`) and the app's `.instrument/` (chat records, `devices/`, `workspace.json`). The workspace's machine folder in userData, the runtime folder and the work folders in `~/.instrument/work/` are local disk and are out of scope.

## Design

### One module for reading the synced folder

Add `packages/workspace/src/lib/workspace-files.ts`, the one way code reads the contents of a file under the workspace root:

- Async only. Reads go through `fs.promises`, so a download waits on the thread pool and not on the caller's thread.
- Says when a file is evicted. A caller chooses what an evicted file means: wait for it (an async read that downloads it), or pass over it and answer "not here yet" (a list that would otherwise download everything to show a row). The default is to wait. Pass over only where something else will download the file later, such as the person opening it or a watcher read that waits; where nothing does, a passed-over file never arrives.
- Tells evicted without reading. On macOS a file with contents and no blocks on disk (`size > 0 && blocks === 0`) is the cheap test; `0e2063521` uses it as `keptByNameOnly` in `own-folder.ts`, and it moves here. Studio's `lib/dataless.ts` (`isDataless`, which spawns `/usr/bin/stat` to read the real flag) stays for the launch's one-file check of `workspace.json`, where certainty matters more than cost.
- Offers the shapes the call sites need: whole text, the head of a file (`LINK_HEAD_BYTES`-style), lines from an offset (the activity and synced-store tails), and a stat-gated read that returns the cached value when size and mtime are unchanged.

### A lint rule so it stays fixed

`packages/workspace/.oxlintrc.json` has no local plugin today; Studio's is `apps/studio/oxlint-rules.ts`, loaded through `jsPlugins`. Add a rule (in a workspace plugin, or by loading the shared rules file there too) that reports a call to a content-reading sync `fs` API, or to `readJsonRecordSync`, `updateJsonRecordSync` and `readOwnFile`, in `packages/workspace/src` and `apps/studio/src/electron-main`, outside an allowlist:

- tests and test helpers;
- the bash worker (`lib/bash-worker/`), which runs off the main thread;
- launch-only sweeps and migrations, listed by file, each with a comment saying it runs before the window is useful;
- modules that only touch local disk (machine folder, runtime folder, work folders), listed by file.

The rule cannot tell a synced path from a local one, so the allowlist carries that judgment, file by file. That keeps it reviewable: adding a file to the list is a visible decision in a diff. Metadata calls are not reported.

## What to convert

The audit behind this plan traced every sync call in `packages/workspace/src` and `apps/studio/src/electron-main` that can touch the workspace root on the main thread. Re-trace each one before changing it; function names are stable, line numbers are not.

### High: reads contents on a hot path

| where | reads | runs | fix |
|---|---|---|---|
| `apps/store.ts` `readAppFolders` / `readAppFileText` (through `own-file.ts` `readOwnFile`) | every `Apps/*/APP.md` | `listApps`, which `chat/chats.ts` `loadShared` calls for every `chatById` and `listedChats`, so on each live refresh of the chat list or a chat's info; also each user message (`chat-app-changes.ts`), the `apps.list` RPC and the `app` command | async; stat-gated cache, since the list is read far more often than it changes |
| `record-folders.ts` `firstLineOf`, `sessionInSettingsFile`, through `read()` and `discover()` | the head of each chat's session logs | the chat index's first use per process (O(chats × logs)); `discover()` for each id the index has not seen, as when a chat arrives from another device | build the index async before first use; in `discover`, pass over evicted logs and let the async arrivals path add the chat |
| `drafts/draft-folder.ts` `readDrafts` / `readDraftFile` | every `Drafts/*/DRAFT*.md` | the draft store's load, and its reconcile on every watcher event under `Drafts/`, the store's own writes included; each send (`send.ts`, `send-from-folder.ts`) | stat-gated, async |
| `synced-store/synced-store.ts` `look` / `readIfThere` | another device's whole `devices/<device>/<domain>.jsonl` | opening the store (bookmarks) and after every settled watch event on `devices/` | read async and wait for an evicted file, since nothing else downloads another device's file. The size and mtime check skips only a file already read and unchanged, so an evicted file that changed still has to be read |
| `activity/store.ts` `catchUpActivity` → `activity/log-file.ts` `readLinesFrom` | each device's `devices/<device>/activity/<YYYY-MM>.jsonl` that grew | every activity read (`listActivity`, `getActivity`, `summarizeActivity`, `activityCsv`), so opening Settings > Activity | read async and wait for an evicted file. Passing over it would leave its rows out for good, since nothing else downloads another device's activity file. Its comment said a file not downloaded yet "is left for the next look", which assumed the read fails; on macOS it blocks |

### Medium: reads contents per user action or per item

| where | reads | runs | fix |
|---|---|---|---|
| `invalid-chat-folders.ts` → `record-folders.ts` `chatSessionIn` | log heads of every chat | Settings > Storage | async |
| `apps/icon.ts` `findAppIcon` | each app's `icon.png` or `icon.svg` | `apps.list`, per app | async, stat-gated |
| `apps/store.ts` `readAppGuide` | one `APP.md`, or each in `otherGuidesToRead` | the `app` command and app setup | async |
| `activity/store.ts` `insertActivity` (`appendFileSync`) | this device's own activity file | every model request | async append; if the sync service evicted the file, the append waits for a download |

### Low: reads contents rarely

| where | reads | runs | fix |
|---|---|---|---|
| `chat/topics.ts` `readTopicsSync`, `rewriteTopicSync` | every `Topics/*/TOPIC.md` | creating, updating or retiring a topic | switch to the async `readTopics` already there |
| `memory/store.ts` through `rewrite-file.ts` | the memory being saved | each memory save | async |
| Studio `lib/workspaces.ts` `readJson` | `.instrument/workspace.json` | `workspaces.current` per window load; Settings' workspace list | async, cached for the run |
| `skill-runtime.ts` `getSkillRuntime` | a skill's `package.json` under `Skills/` | `load_skill`, skill validation | async |

### Metadata only, and launch only

About a dozen groups of `stat`, `exists`, `readdir` and `realpath` calls (path resolution, permission asks, watcher setup, `file://` navigation) touch the synced folder without reading contents. Leave them.

About twenty one-time sweeps and migrations read synchronously at launch (`migrate-workspace-layout.ts`, `migrate-legacy-tasks.ts`, `split-chat-records.ts`, `settle-workspace-db.ts`, `drafts/migrate.ts`, `rewrite-stored-paths.ts`, Studio's `workspace-move.ts`, `settings-migration.ts`, `machine-data-migration.ts` and others). Most never run for a folder the person picked. They go on the lint allowlist with a comment, and the per-step launch timings (`timeBootStep` in `workspace-launch-sweeps.ts` and `create-workspace-actor.ts`) say whether any of them is worth converting.

## Order

1. **The module**, with `keptByNameOnly` moved into it from `own-folder.ts`, and its tests.
2. **The activity tail and the synced store**: the smallest changes, and the activity one blocks today on any computer whose other devices' activity files were evicted.
3. **`listApps`**: the hottest path. A stat-gated cache removes most of the reads; the async read removes the rest.
4. **Drafts, then the chat index.** The index is the largest change, since `resolveChat` and the code under it are synchronous by design; building the index before first use keeps them synchronous over memory.
5. **The medium and low rows.**
6. **The lint rule and its allowlist**, last, once the code it would report is gone, so it lands green and stays that way.

Each step ships on its own.

## How to check it

- Unit tests: a stubbed `fstat` or `stat` reporting no blocks, as `write-chat-folder.test.ts` does for the evicted-file case, with the test confirmed to fail before the change.
- On a real iCloud workspace: Finder's Remove Download on a file or folder makes it dataless again without deleting it (`find <dir> -flags +dataless` lists what is evicted). Evict a set of `APP.md`, `DRAFT.md` or activity files, use the app, and watch for the `(mainThread) Main thread stalled` warning in `main.log`. A `sample` of the main process during a stall names the blocking call.
- The `Chat folders: looked for …` warning from `own-folder.ts` should not appear after the launch backfill on a warm machine.

## Out of scope

Moving the workspace to its own process, which is [agent turn off the main thread](agent-turn-off-the-main-thread.md). Sync work that is not a read of synced-folder contents, such as `node:sqlite` writes and synchronous path validation in the shell, which that plan and [the agent's filesystem work stalls the window](../findings/agent-filesystem-work-stalls-the-window.md) cover.
