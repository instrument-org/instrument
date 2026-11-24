# Synced stores

A synced store is a set of keys and values that every device sharing a workspace writes and reads, such as the bookmarks. Each device appends its changes to a file of its own, so a sync engine never has two versions of one file to choose between, and every device reads all of them. It is the same shape as a chat's settings files ([chat-records.md](chat-records.md)), made general for state that belongs to the workspace rather than to one chat.

## The files

One file per device per store, in the workspace's `.instrument/devices/<device>/` (`workspaceLayout(…).devicesDir`), named for the store's domain: `bookmarks.jsonl`. The domain is lowercase letters and digits, so no store's file name reads as another's conflict copy.

A line sets a key or deletes it (`synced-store/synced-record.ts`):

```jsonl
{"t":"set","seq":0,"at":"2026-10-19T12:00:00.000Z","device":"dev_7Q2M4K9X","key":"bookmark/0b6f…","value":{"order":0,"title":"Docs","url":"https://example.com/docs"}}
{"t":"set","seq":1,"at":"2026-10-19T12:04:00.000Z","device":"dev_7Q2M4K9X","key":"bookmark/0b6f…","value":{"order":0,"title":"Manual","url":"https://example.com/docs"}}
{"t":"del","seq":2,"at":"2026-10-19T12:09:00.000Z","device":"dev_7Q2M4K9X","key":"bookmark/0b6f…"}
```

`seq` counts up from 0 within a file. A collection is a key per member, so two devices changing different members never touch the same key; a delete is a line of its own, a tombstone that outranks the sets before it. Order among members is a field of each value.

## The fold

Each key is what its newest record says, across every device's file and every conflict copy a sync engine kept of one (` 2`, `(… conflicted copy …)`, `-<computer>`, `.sync-conflict-…`, the shapes `records/file-names.ts` knows): the newest `at`, ties to the larger device id, then the larger `seq` (`SyncedFold`, `syncedPlace`). A line is folded once however many copies and reads it arrives in, a file is read up to its last whole line, and the fold comes to the same keys whatever order the files and their bytes arrive in. `synced-fold.test.ts` checks that against the records' fake sync engine (`records/fake-sync.ts`).

A change made on a device is stamped no earlier than one past the record it replaces, so it shows there even when another device's clock runs ahead. A change that would change nothing writes nothing. A change made before it reached the store (an import from an older file) carries its own `at`, and is not written at all over anything newer.

## The store

`openSyncedStore` (`synced-store/synced-store.ts`, exported from `@instrument-org/workspace/electron`) is the one door: `get`, `entries(prefix)`, `apply(ops)` (answered once the lines are on disk) and `subscribe`. It reads every device's file as it opens, appends this device's through a `RecordWriter` (`records/record-writer.ts`, with the store's `RecordFormat`), and takes in what another device's file gains (below). Its own file not being readable fails the open, since an empty store written over it would reuse its `seq`. It holds the whole store in memory. A store too big for that would index its files in `workspace.db`, as the activity log in the same folders is.

Reading and writing are asynchronous throughout, so a file a cloud service has yet to download never holds up the thread. The workspace package reaches its stores through `heldStore` (`synced-store/held-stores.ts`), one per workspace, device and domain in the process, held open from its first use; a launch step that runs before the workspace is up names its workspace and device (`WorkspacePlace`). Reads answer from memory and wait on no file once the store is open. Two rules keep a write whole:

- `exclusive(run)` runs a read and the write built on it after every one asked for before. Changes to the projects and the apps go through it. A run never asks for another.
- `caughtUp()` reads every other device's file as it stands, and fails with a `SyncedStoreBehindError` where one could not be read in ten seconds. A change that builds a record on the one the store has asks for it first, so it never takes back what another device changed. It is refused, and says so, until the file can be read. Making something new, and saving a memory, build on nothing and are not refused; nor are the bookmarks, whose windows show a change before it is written.

## How a change is noticed and shown

Every store is watched by `watchSynced` (`synced-store/watch-synced.ts`): one recursive watch on the devices folder on macOS and Windows, a watch per device folder on Linux, and a look when a window comes forward and every minute while one is in front, for a change a watch missed. That look is one rule (`lib/in-front.ts`), shared with the chats' records; the host says only when a window comes forward and when the last goes behind (`setWorkspaceInFront`).

`SYNCED_DOMAINS` (`synced-store/domains.ts`) lists every store and how a change to it reaches the screen: an event the workspace says, the host's own windows, or nothing shown. A domain not in it does not compile. `changesTo(event)` (`lib/live-changes.ts`) is what a live route listens to, and follows what is behind each event, every store whose entry names it and the folder of the person's beside it where there is one (`FOLDERS`), held once while anything listens. `live-changes.test.ts` writes to each listed store as another device and expects its event, with the watch and without it.

To add a store: list it in `SYNCED_DOMAINS` and open it with `heldStore`. Where its list is also read from a folder of the person's, add the folder to `FOLDERS`.

## Bookmarks

Studio's main process owns the bookmarks (`electron-main/bookmarks/`): the `bookmarks` store, a key per bookmark (`bookmark/<id>`) whose value is its title, address and order. A window never sends the list: it sends a batch of `BookmarkOp`s (`add`, `rename`, `move`, `remove`, `shared/bookmarks.ts`) over `bookmarks:apply`. Main applies them with `applyBookmarkOps`, writes the bookmarks that changed as sets and deletes, and sends every window a snapshot with each window's last batch acknowledged. A window shows that snapshot with its own unacknowledged batches applied over it (`client/bookmarks/store.ts`, over the mirror the drafts use, `client/lib/op-mirror.ts`), so its own change shows at once and a snapshot sent before main applied it cannot undo it. The preload reads the snapshot synchronously before the first render (`bookmarks:load`).

At launch, a `bookmarks.json` an earlier build kept in `.instrument/` is taken into this device's file, each bookmark as of the file's last change, and removed: no build reads it.

## Projects and memories

A project's folder and a memory's file have only the person's words in them; what the app knows about each is a synced store beside them. The folder and its files are read and written asynchronously too, and a change to a project (its record, its folder, its `AGENTS.md` and its `.instrument-project`) is one `exclusive` run.

- **`projects`** (`chat/project-records.ts`): a key per project by its id, whose value is its `created`, and its `emoji` or `icon`, `color`, `about` and `retired`. The record never names its folder: a folder finds its record by the id its hidden `.instrument-project` names, which moves and syncs with the folder, so a rename by hand or a folder that syncs ahead of the store keeps its project. A folder with no id file goes by the id an earlier build wrote into its `AGENTS.md`, or else one drawn from its name, as a new project's is, so two computers agree; where two folders name one id, the older keeps it and the copy gets its own. Any read in a running workspace writes down a missing record or id file.
- **`memory`** (`memory/memory-records.ts`): a key per memory by its file's name in `Memory/`, whose value is the chat it was learned in and when it was saved. A file renamed by hand loses its record and shows its last change as when it was saved; nothing matches renames here, since a memory written by hand would take the record of one deleted by hand.

An earlier build kept both in the files' front matter. Every launch takes what is there into the store as of the file's last change, so a change made in the app since then outranks it, and writes the file back without it, removing an `AGENTS.md` left empty (`moveProjectFrontMatterToStore`, `moveMemoryFrontMatterToStore`). A key this build does not recognize stays in the file. An earlier build that writes its front matter back is taken in again at the next launch.

## Apps

The workspace package owns the apps (`lib/apps/store.ts`): the `apps` store, a key per app (`app/<slug>`) whose value is its name, its setup (the manifest, with any key this build does not read kept beside it) and its guide, and a key per app icon (`icon/<slug>`, its bytes in base64), so a change to the guide never writes the icon again. The slug is the app's identity: the credential store and the connection record are keyed by it, and the connection is pinned to a digest of the setup's manifest. The `instrument app` command (on the main thread), the Apps page and the launch are its only writers; its writes run one at a time (`exclusive`).

At every launch (`moveAppFoldersToStore`, `lib/app-folders-to-store.ts`), each `Apps/<Name>/APP.md` an earlier build wrote is taken in as a record named for its folder, its front matter kept whole, and the betas' `.instrument/apps/<slug>/` (`app.json` and `guide.md`) is taken in straight from those files, its connection restamped to this build's digest. Each record is written as of its file's last change, so a second run writes nothing and an app changed since stays as the store has it. Once its app is in the store, each `Apps/` folder goes to the Trash whole where it holds only the files the app was taken in from, and otherwise only those files go, so what else the person kept there stays; `Apps/` itself goes only once nothing but system clutter is left in it, since it sits at the person's top level. Those files are read only where each is a plain file in the folder, so a link in one's place leaves the folder for the person to sort out. `.instrument/apps/` goes whole once every app in it is in the store. An app whose file could not be read stays for the next launch.
