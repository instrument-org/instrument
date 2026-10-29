# Plan: stars and changed-since-you-looked marks in Files

Status: **abandoned, nothing built.** The owner dropped stars and changed-since-you-looked marks from Files after the List view landed without them (`185a8602d`..`63af08322`: each file's own title over its name). The layout this was meant to slot into did land: a file opens beside its folder, and the sort menu holds Sort by, Group by and Show hidden files. Kept for the marks-log sync shape, which was never reviewed.

Two things carried over from the Index reader, a separate app that showed a folder of documents newest first and marked what changed:

- **Stars.** Star a file or a folder, and find the starred ones again.
- **Changed since you looked.** A dot on a file written since you last viewed it, so a folder an agent or a person keeps editing shows what's new without opening each file.

## What the person sees

- **The dot.** A small dot before a file's name in every view (List, Grid, Columns) when the file changed since you last viewed it. Viewing the file beside its folder clears it once it has been on screen for the same dwell a chat uses to count as read (`readDelay` in `components/window/read-on-view.ts`), so a file passed over with the arrow keys stays marked.
- **Which folders mark changes.** A folder marks changes only once someone turns it on, from **Mark changes** in the sort menu next to Show hidden files. Turning it on records when, and only files written after that get a dot, so the first visit isn't all dots.
- **Stars.** A star after the name of a starred file or folder. **Star** and **Unstar** in the context menu, for one row or several picked.
- **Marking by hand.** **Mark as read** and **Mark as unread** in the context menu, for one row or several picked. With several picked beside an open file, the row's ⋯ menu offers the same items, since it acts on all of them.
- **Finding them.** The sort menu's Group by is where these join the order. "Starred" and "Changed" as group keys put them first, the way grouping by Kind puts Folders first. This keeps them in the menu that already decides the order, rather than bringing back a filter, which the Finder doesn't have outside search.

Still to decide when this is picked up:

- Whether Recents gets a "Starred" place of its own in the sidebar's places.
- Whether the List view that sorts newest first and always shows each page's title comes with this. It was the Index reader's main view and was set aside.

## Data

Marks are per person and have to follow them to another Mac and, later, to the phone app. One writer per file, so two devices syncing the workspace never write the same file:

- **Files:** `.instrument/files/marks.<device>.jsonl` in the workspace, one line per change: `{ at, root, path, field, value }`. Reading folds every device's file: the newest `at` per file and field wins, and a tie goes to the larger device id. If chats move to per-device logs of their own, the two should share the line shape and the fold.
- **Keys:** a root plus a path relative to it, since an absolute path doesn't survive to another Mac. Roots are `workspace`, `icloud`, `home`, or `device` (an absolute path that only the writing device reads back).
- **Fields:**
  - `seen`: the `{ mtime, size }` the file had when it was last viewed, or null for marked unread. A file is changed when its current mtime or size differs from what `seen` holds. There's no content hash: mtime and size are enough to say "written since".
  - `starred`: a flag.
  - for a folder, `changes`: `{ since }`, the moment Mark changes was turned on, and the baseline for files never seen.
- **Read side:** a table folded from every device's lines, in the machine-local workspace index, so a listing asks one table rather than reading the logs.

Known limits:

- A renamed or moved file loses its marks. A path is the only key a file has on every platform.
- The Index reader's own state (`~/.config/index/state.json`, keyed `root::file`) is a one-time import, if it's imported at all.

## Order of work

1. The marks log, its fold, and the read-side table, with tests over two devices' logs.
2. Mark changes in the sort menu, the dot, and clearing on view.
3. Stars, and Mark as read or unread, in the context menu and the several-picked ⋯ menu.
4. "Starred" and "Changed" in Group by.
