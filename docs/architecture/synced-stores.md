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

`openSyncedStore` (`synced-store/synced-store.ts`, exported from `@instrument-org/workspace/electron`) is the one door: `get`, `entries(prefix)`, `apply(ops)` (answered once the lines are on disk) and `subscribe`. It reads every device's file as it opens, appends this device's through a `RecordWriter` (`records/record-writer.ts`, with the store's `RecordFormat`), and takes in what another device's file gains: one recursive watch on the devices folder on macOS and Windows, a watch per device folder on Linux, and `look()` for a change a watch missed. It holds the whole store in memory. A store too big for that would index its files in `workspace.db`, as the activity log in the same folders is.

## Bookmarks

Studio's main process owns the bookmarks (`electron-main/bookmarks/`): the `bookmarks` store, a key per bookmark (`bookmark/<id>`) whose value is its title, address and order. A window never sends the list: it sends a batch of `BookmarkOp`s (`add`, `rename`, `move`, `remove`, `shared/bookmarks.ts`) over `bookmarks:apply`. Main applies them with `applyBookmarkOps`, writes the bookmarks that changed as sets and deletes, and sends every window a snapshot with each window's last batch acknowledged. A window shows that snapshot with its own unacknowledged batches applied over it (`client/bookmarks/store.ts`), so its own change shows at once and a snapshot sent before main applied it cannot undo it. The preload reads the snapshot synchronously before the first render (`bookmarks:load`).

At launch, a `bookmarks.json` an earlier build kept in `.instrument/` is taken into this device's file, each bookmark as of the file's last change, and removed: no build reads it.
