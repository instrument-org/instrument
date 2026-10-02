# Moving files in the Finder

**Status:** accepted, 2026-10-02: undo-backed drag-to-move. Nothing built.

## Thesis

The Finder can show, open, rename, duplicate, trash and drag a file out to another app. It cannot put a file somewhere else. Every Finder-shaped app is, underneath, a tool for moving things between folders, and ours has no verb for it: no drop target, no move, no copy and paste, no selection of more than one thing. Those four are one feature:

1. **More than one selected item.** Every other verb takes a set.
2. **A move/copy primitive in main,** with undo built in from its first commit.
3. **Drop targets inside the app,** fed by the native drag we already start, so one gesture can end in our Finder or on the Desktop and the person decides by where they let go.
4. **The keyboard and the pasteboard:** ⌘C / ⌘V / ⌥⌘V with real file URLs on the system pasteboard, ⌘⌫, ⌘D, ⇧⌘N.

Two things ride along because they are the same verb from another side:

- **Files in from the computer.** A file or folder dragged from the Mac's Finder, the Desktop or File Explorer and dropped on a folder in ours lands there. Today it does nothing.
- **A sidebar that is the person's.** Favorites they choose, kept, reordered and removed, added by drag the way every file manager does and by a menu command for anyone who does not think to drag.

And one rule gates all of it: **no drop in this app may do something the person cannot take back.** A stray click, a jittery release or a DOM drag gone wrong must never leave a folder somewhere it was not meant to be with no way back. The safety model below is what makes that true, and drag-to-move does not ship until it is in place.

What this plan does not try: tags, Get Info, smart folders, compression, burning a folder into an app of its own. None of them is fundamental the way putting a file somewhere is.

## What exists today

- **Drag out.** `useFileDrag` / `useFileDragArea` (`apps/studio/src/client/hooks/use-file-drag.ts`) start a native OS drag through `webContents.startDrag` after a 20px threshold, with a QuickLook drag image prepared on hover (`apps/studio/src/electron-main/lib/file-drag.ts`). Always one file: the hook passes `[file.hostPath]`, though the IPC already accepts `files`. Blink's own `dragstart` is cancelled, so no row is ever an HTML5 drag.
- **File actions.** `files.newFolder`, `rename`, `duplicate`, `trash` in `apps/studio/src/electron-main/rpc/routes/files.ts`. Each takes one path. No move, no copy-to, no undo.
- **Selection.** `FileSystem` (`apps/studio/src/client/components/extend/file-system.tsx`) and `ComputerPage` hold `selectedPath: string | null`. One item.
- **Drops.** Only the chat screen has a `FileDropRegion`, and it deliberately ignores drags this app started (`apps/studio/src/client/lib/self-file-drag.ts`) so a click that drifted past the threshold does not attach a task's own file to itself. The Finder takes no drops at all. Read from the code rather than tried: a file dropped anywhere outside the chat's region falls through to the window's default, a navigation to its `file://` URL, which `guardNavigation` refuses and `openExternal` then blocks and reports as an unsafe protocol. So the present behavior is a silent no-op that files an exception report.
- **Attaching.** A file dropped on the composer is attached by path, and on send `writeUploadedAttachments` copies it into the task's attachments folder with `fs.copyFile(..., COPYFILE_FICLONE)`. Its comment says that is a copy-on-write clone on APFS; measured, it is not (see "Measured" below): Node on macOS makes a full byte copy. A file the task already holds is attached where it lies, with no copy.
- **Sidebar.** `computerPlaces()` (`packages/workspace/src/lib/orchestrator/computer.ts`) returns a fixed list: Favorites are Instrument (`~/Documents/Instrument`), the home folder, Desktop, Documents and Downloads, each shown only if it exists; Locations are whatever is in `/Volumes` (the root on other systems). Recents sits above both with no heading. Nothing is stored, nothing can be added or removed, and a place's context menu (`PlaceMenu`) offers only opening and pointing at it.
- **Keyboard.** Return renames, ⌘O / ⌘↓ open, Space is Quick Look, arrows and type-ahead walk the list, ⌘F searches. No ⌘⌫, ⌘D, ⇧⌘N, ⌘C/⌘V, ⌘Z.
- **Refresh.** Listings poll every 4s, and the page re-reads after each of its own actions.

## Why the drag already works the way we want

The question that opened this was whether a file could ride on the cursor and be dropped either inside the app or outside it. It already does, because the drag we start is the OS's, not ours:

- Once `startDrag` hands the gesture to macOS, our own window is a drop destination like any other. Chromium fires ordinary DOM `dragenter` / `dragover` / `drop` events for our own session, and the drop carries `dataTransfer.files`, which `webUtils.getPathForFile` turns back into host paths. `self-file-drag.ts` exists precisely because those drops arrive today.
- Electron's macOS drag source (`shell/browser/ui/drag_util_mac.mm`) answers `NSDragOperationCopy` outside the application and `NSDragOperationEvery` inside it. So dragging to the Desktop or a Finder window is always a copy (the task keeps its file, which is right), and inside our window we are free to treat the same drop as a move.
- Setting `dataTransfer.dropEffect` in `dragover` is what the OS cursor reflects (the green plus for copy), so move vs copy feedback comes for free.

So no custom pointer-drawn drag layer is needed, and building one would be worse: a custom layer cannot leave the window, and switching from it to a native drag mid-gesture is not something Chromium supports. The work is entirely on the receiving side.

Two gaps in the native path, both known:

- **No end event.** Electron's source implements no `draggingSession:endedAtPoint:operation:`, so a drag that leaves the window is never heard from again. `self-file-drag.ts` papers over this with a 2s age window, which is too short once spring-loaded folders exist. See "Knowing a drag is ours" for the replacement.
- **One icon for many files.** `DragFileItems` gives each file the same image, so a 5-file drag is five identical images stacked, with no count. See phase 3.

## The safety model

Everything a drop or paste can do falls into one of three costs, and the plan only lets a gesture do the cheap ones without asking.

| Operation | What it costs on disk | Reversible exactly? | Allowed by a drop |
| --- | --- | --- | --- |
| Move within one volume | one `rename(2)`: atomic, instant whatever the size | yes, rename back | yes, with Undo |
| Copy within one APFS volume | a clone (`clonefile(2)` through `cp -c` or `ditto --clone`, not Node): instant, no space until edited | yes, trash the copy | yes, with Undo |
| Copy across volumes, or onto a disk without clones | real bytes, as long as the data takes | trash the copy, but the time is spent | not in the first cut |
| Move across volumes | a copy, then a delete of the original | only if the copy finished and the original is still in the Trash | never by drag |

That table is the core of the answer to "what if someone drags a big folder by accident". On one volume, which covers task folders, the Instrument folder, Desktop, Documents, Downloads, iCloud Drive and everything else under home on a normal Mac, a move of a 40 GB folder is the same single rename as a move of a text file. It finishes immediately, it cannot half-happen, and moving it back is another rename. Copies on that volume are clones, made by the system's own tools since Node cannot make them (see "Measured"). So in the first cut, no drag or paste ever streams bytes from JavaScript, and nothing a drag does is slow or partial.

What still has to hold for an accident to be recoverable:

1. **Undo ships with moves, not after them.** Phase 2 lands the journal and ⌘Z with the route itself; phase 3's drops cannot merge before it. Every drop that changes the disk shows a toast naming where things went, with Undo ("Moved 'Invoices' into 'Archive' · Undo").
2. **The journal outlives the toast.** Every move, copy, rename, duplicate and new folder done from the app is recorded in a small journal in userData (what moved where, when, and from which window), last 100 entries. ⌘Z and Edit > Undo work from it after the toast is gone, after the window closed, and after a restart. Undo checks that the item is still where the journal says and that nothing took its old place, and refuses with a clear message rather than half-applying.
3. **Only a native file drag that we started, or one from outside the app, can reach a file operation.** HTML5 drags inside the page (text, links, an element) carry no `Files` type and are ignored by every Finder target. Since `useFileDrag` cancels Blink's own `dragstart`, there is no in-page drag of a row that could be misread. A drop from our own drag must carry exactly the paths the drag record says were dragged; anything else is treated as external, which means copy, never move.
4. **A target must be meant.** A folder only takes a drop after the drag has rested over it briefly (about 150ms) and it has shown its highlight; a release while crossing a row on the way somewhere else is a no-op. The 20px threshold before a drag starts at all stays.
5. **No-ops stay no-ops.** A drop on the folder the items already sit in, on themselves, or on their own descendant does nothing and says nothing.
6. **Some things never move.** See "What can go wrong" for the protected list: app data, running tasks, home and its standard folders, volume roots, `~/Library`.

**Why not a confirmation on every drop.** A modal on every move would be safe and would make the feature feel broken next to every file manager people know; it also trains people to click through it, which makes the one confirm that matters (leaving iCloud Drive, a big copy) worth less. Undo backed by the journal is the stronger guarantee: a confirm protects only against the mistakes noticed at the moment of the drop, while undo covers the ones noticed tomorrow. Confirmations are kept for the operations that undo cannot cheaply reverse.

**If that still feels like too much for a first cut,** there are two smaller steps in order of caution, both of which reuse everything above:

- **Copy-only drops.** Every drop copies (clones), nothing moves by drag, and moving is a menu command ("Move to…") that names the destination. The worst accident is an extra clone that takes no space. Drag-to-move turns on later as a one-line change to the semantics table.
- **Confirm-until-proven.** Drag-to-move ships with a confirmation that has "Don't ask again", and the default flips to no confirmation once the journal has been in daily use without a lost file.

## Shape

### Phase 1: selection of more than one item

`FileSystem` takes `selectedPaths: string[]` plus an anchor and a focus (the item the keyboard is on), replacing `selectedPath`. Behavior, matching the Finder:

- Click selects one. ⌘-click toggles. ⇧-click extends from the anchor to the clicked item in display order (list, icons, gallery; in columns, within one column only). ⌘A selects the folder on screen.
- ⇧↑ / ⇧↓ extend from the anchor. A plain arrow collapses to one.
- Rubber-band selection in icons and gallery, starting on empty space. List view gets it too (the Finder allows it from the left margin); columns does not.
- The columns view shows the next column only when exactly one folder is selected; the preview pane shows "N items" for more than one.
- Quick Look with several selected walks the selection; first cut can show the focused item only.
- The context menu acts on the selection when the right-clicked item is in it, and selects only that item when it is not.
- `ComputerPage`'s `onSelectionChange`, the menus, and `ChosenItem[]` (`selectedItems`, already an array) carry the set.

This is the largest change in the plan and the one that collides with any other Finder work in flight, since `file-system.tsx` is a 6,000-line file every Finder change touches. Sequence it against other open Finder edits rather than in parallel with them.

### Phase 2: move, copy and undo in main

One route, `files.transfer`:

```ts
input: {
  sources: HostPath[];          // ≥1
  destination: HostPath;        // a folder
  mode: "copy" | "move";
  onConflict?: "ask" | "keepBoth" | "replace" | "skip"; // default "ask"
}
output:
  | { ok: true; journalId: string; results: { from: string; to: string }[] }
  | { ok: false; conflicts: { source: string; existing: string }[] }
  | { ok: false; refused: { source: string; reason: string }[] }
```

- **Same volume only, in the first cut.** Main compares `stat(source).dev` with `stat(destination).dev` up front. A move is `fs.rename`, guarded as below. A copy is a clone made in a child process with `ditto --clone` (keeps extended attributes, tags and resource forks, as the Finder's copy does) or `cp -cR`, never `fs.cp`, which on macOS copies every byte whatever `mode` says. Before building, confirm which of the two refuses rather than silently byte-copying when cloning is impossible, and use that one.
- **Rename never replaces.** `rename(2)` silently replaces a file, or an empty folder, at the destination (measured). So each rename is preceded by an existence check on its exact target inside `oneWriterAt`'s chain, and a target that exists is a conflict, never an overwrite. That leaves only a microsecond race against writers outside the app; files can close even that by moving with `link` (which fails with `EEXIST` atomically) then `unlink`. macOS has an exclusive rename (`renamex_np` with `RENAME_EXCL`), but Node does not expose it. Undo goes through the same guard. A source on another volume is refused with "Copying between disks isn't supported here yet. Use the Finder for this one." The Finder is one click away through the existing Open in / Reveal rows.
- **Clones are checked, not assumed.** Cloning is unsupported on HFS+, exFAT, most network shares and most Windows and Linux disks. Before a copy, main checks the destination volume's filesystem; where it cannot clone, a copy is held to the big-copy rules below even when source and destination share the volume.
- **Refused:** a folder into itself or its own descendant; a source whose parent already is the destination with mode `move` (a no-op, reported so the drop does nothing); everything on the protected list.
- **Conflicts:** with `"ask"`, main checks every target first and returns the conflicts without touching anything; the renderer shows the Finder's sheet ("An item named 'notes.txt' already exists in this location." Keep Both / Stop / Replace, with "Apply to all" when there are several) and calls again with the answer. Keep Both reuses `freePath` (`notes 2.txt`). Replace trashes the existing item rather than deleting it.
- **Partial failure:** stop at the first error, journal what moved, return it, and say what did not.
- **The journal** (see the safety model) is written by this route and by `rename`, `duplicate` and `newFolder`, in main, before the call returns. `files.undo({ journalId })` reverses one entry: move and rename go back, copy, duplicate and new folder (if still empty) go to the Trash. Trash itself is not journaled as undoable: `shell.trashItem` discards the path the item landed at, so "Put Back" would mean guessing in `~/.Trash`.
- The existing single-path routes (`trash`, `duplicate`) take a `paths` array in the same pass, since phase 1 makes every menu act on a set.
- **⌘Z** and Edit > Undo, through the window's command table, undo the newest journal entry made from that window; the Edit menu names it ("Undo Move of 'Invoices'").

**Big copies, later.** Copies across volumes, or onto a disk that cannot clone, are what the first cut refuses. When they come, they do not run as a Node copy loop in main:

- They run in a child process (`ditto` on macOS, which keeps extended attributes, tags and resource forks the way the Finder's copy does; a utility process elsewhere), so a stuck disk cannot freeze the app and a cancel is a kill.
- They stage under a hidden partial name in the destination and rename into place only when complete, so a cancel or a crash never leaves a half-copied item under the real name.
- They measure first (size, file count, free space on the destination) and confirm with the numbers above roughly 1 GB or 5,000 files, and refuse above the free space.
- Progress shows in the toast with a Cancel.
- Handing the copy to the Mac's own Finder over Apple Events would get the Finder's progress and behavior for free, at the cost of an automation permission prompt the first time. Worth a look before building our own.

### Phase 3: drops inside the app

Cannot merge before phase 2's journal and undo.

**Targets, in order of value:**

1. A folder row / icon / column cell in the Finder. Highlights after the short rest described in the safety model.
2. The empty space of the folder on screen, meaning "this folder" (and in columns, the column's own folder).
3. The Finder sidebar's favorites and locations. A drop on a row moves into that folder; a folder dropped between rows, where an insertion line shows, adds it to Favorites instead (phase 5). That split is the Finder's own.
4. Spring-loaded folders: a folder hovered for ~700ms during a drag opens in place (in columns, opens the next column), and the open folders spring back if the drag leaves without dropping.
5. The location row's path segments, as drop targets for "up to here".

**Semantics:**

| Drag came from | Default | ⌥ held | ⌘ held |
| --- | --- | --- | --- |
| Our app | move | copy | move |
| Another app (the Mac's Finder, the Desktop, a browser download bar) | copy | copy | move |

Copy for external drops departs from the Finder's same-volume-moves rule on purpose: dropping a file from the Desktop into a task folder and finding it gone from the Desktop is a surprise in a product that is not the person's file manager of record, and on one volume the copy is a free clone. ⌘ is the escape hatch, as in the Finder. The cursor shows the plus whenever the result is a copy.

Folders dragged out of our Finder go through the same path (`startDrag` takes folder paths already). A drop of something that is not a file (a link or image from a web page) is out of scope here.

**Knowing a drag is ours.** Replace the age window in `self-file-drag.ts` with a record of the drag in flight, set at `startDrag`: the host paths and the window that started it.

- At `drop`, the drop's own paths (from `dataTransfer.files`) are compared with the record. Equal sets mean ours; anything else is external. This is exact and needs no timing, because the drop carries the paths.
- During `dragover`, paths are not readable (Chromium protects them until drop), so the record is the guess for highlighting and cursor feedback. A wrong guess costs a cursor that says move when the drop will copy, which the drop then corrects. It never errs toward a move: a drop that does not match is a copy.
- The record lives in main, not module state, so a drag from one Studio window to another is recognized too. Main clears it when any window reports a drop, and on the next `startDrag`.
- The chat's `FileDropRegion` reads the same record. A file dragged from the Finder or a file tab onto the composer attaches it by reference, as a chosen item rather than a copy (`chat-attachments-by-reference.md`). A drop that never left the chat it started in is still ignored, so a drifted click on a file card does nothing.

**Multi-file drag image.** Compose one image in the renderer: up to three thumbnails fanned, with a count badge, drawn on an `OffscreenCanvas` and sent to main as PNG with the drag. Electron gives that image to every file at the same frame, so the copies should sit exactly on top of each other and read as one. Spike that on macOS first; if the OS fans them apart, the fix is a small Electron patch to `DragFileItems` that gives the image to the first item only.

**Windows and Linux.** `drag_util_views.cc` offers `DRAG_COPY | DRAG_LINK`, no move. Our drop handler does the move itself whatever the OS reports, so the effect is right; only the cursor says copy. Accept that rather than patch.

**Files in from the computer.** The same targets take drops from outside the app: a drag from the Mac's Finder, the Desktop or File Explorer is an ordinary file drop, and `splitTransferItems` already separates files from folders.

- Several items, files and folders mixed, in one drop, all through one `files.transfer` call so one conflicts sheet and one Undo cover them.
- A drop whose paths cannot be read (`webUtils.getPathForFile` returns empty) is refused with a toast rather than silently dropped.
- Sources that hand over something other than a file URL are a known gap to measure, not assume. Chromium does not accept macOS file promises (`NSFilePromiseProvider`), which is how Mail attachments, Photos and some other apps drag. Before building, try each of these into a plain Electron window and record what arrives: a Mail attachment, a photo from Photos, the floating screenshot thumbnail, a Messages attachment, an image from Safari, a file from Slack. Whatever arrives as a file works; whatever arrives as a promise or image data gets a "can't drop that here" cursor, not a silent nothing.

**What a drop does, everywhere.** A file dropped anywhere in the window should do one predictable thing or show the no-drop cursor, on every platform.

| Where it lands | From our app | From the computer |
| --- | --- | --- |
| A Finder folder, its empty space, a path segment | move (⌥ copies) | copy (⌘ moves) |
| A Finder favorite or location row | move into it | copy into it |
| Between Finder sidebar rows | add folder to Favorites | add folder to Favorites |
| The chat's composer or transcript (incl. the floating chat) | attach, unless it never left that chat | attach (exists) |
| The compose window | attach to the draft | attach to the draft |
| A file tab | no-drop | no-drop |
| A site tab | the page's own handling, as in any browser | the page's own handling |
| The tab strip, the rail, the chat list, anywhere else | no-drop | no-drop |

The no-drop rows are one window-level `dragover` / `drop` handler that sets `dropEffect = "none"` and swallows the drop, so the cursor says no and nothing navigates. That also ends the stray unsafe-protocol reports. Opening a dropped file as a tab on the tab strip, or sending it to a chat by dropping it on that chat's row, are reasonable later targets, left out so the first cut has few targets and each one is obvious.

Site tabs keep the browser's behavior: the guest is a web page, and dropping a file on a page that takes uploads uploads it, exactly as in Chrome or Safari. That is what people expect when they drag a file into a site.

Platforms: drag in works the same on macOS, Windows and Linux (Chromium's drop path is shared). Drag out works on all three. The differences are the move cursor on Windows and Linux, clones (APFS has them; NTFS and ext4 do not, so copies there fall under the big-copy rules and are refused in the first cut, which in practice makes the first cut copy-capable on the Mac only), and the pasteboard in phase 4. Linux under Wayland is the least certain and gets one pass on the test host.

### Phase 4: keyboard and pasteboard

- **⌘⌫** Move to Trash, **⌘D** Duplicate, **⇧⌘N** New Folder, **⌘↑** enclosing folder, **⇧⌘.** show hidden files (the setting already exists). Each goes through the window's command table (`use-window-commands.ts`) so the menu bar names it, rather than a key listener in the page.
- **⌘C** puts the selection on the system pasteboard as file URLs (`public.file-url` per item, plus `NSFilenamesPboardType` for apps that still read it), so ⌘V in the Mac's Finder pastes copies. Electron's `clipboard.writeBuffer` writes one type per call, so this is a small main-side helper, macOS first; Windows needs `CF_HDROP` and can follow.
- **⌘V** in our Finder reads file URLs off the pasteboard and copies them into the folder on screen. **⌥⌘V** moves them, as in the Finder. Both go through `files.transfer`, so both are journaled and undoable. ⌘X does nothing for files, as in the Finder.

### Phase 5: the sidebar as the person's

**What the Finder ships.** On current macOS (screenshot, 2026-10), the sidebar opens with **Recents** and **Shared** at the top with no heading, then **Favorites** (Desktop, Downloads, Documents, any folders the person added, Applications, in the person's own order), then **Locations**, which is where **iCloud Drive** now sits alongside disks and servers. Apple's guide still describes separate iCloud and Tags sections; the current Finder folds iCloud Drive into Locations. A new account has the home folder and the boot disk switched off (Finder > Settings > Sidebar). Desktop, Downloads and Documents wear their own glyphs; added folders wear a plain folder.

For reference, Windows 11 has Home and Gallery on top, then Quick access (Desktop, Downloads, Documents, Pictures, Music, Videos pinned), then This PC and Network. We follow the Mac's words and layout on every platform for now, and revisit Windows names if familiarity there starts to matter.

**Layout:**

| Group | Rows | Notes |
| --- | --- | --- |
| No heading | Recents, Instrument | Instrument moves out of Favorites to sit under Recents, the way Shared sits under Recents in the Finder: both are the app's own places rather than folders the person keeps. Neither can be removed. |
| Favorites | home folder, Desktop, Downloads, Documents, then the person's own | Home stays on by default, unlike the Finder: it helps people who do not know their way around their computer reach everything else. Desktop, Downloads and Documents get their own glyphs, matching the Finder. |
| Locations | iCloud Drive (when `~/Library/Mobile Documents/com~apple~CloudDocs` exists), then every volume | iCloud Drive under Locations, as the current Finder has it. The boot disk stays, since it is how to reach anything outside home; installer disk images that `/Volumes` lists like any disk are hidden. |

Left out on purpose: Applications (nothing to do with an app here that the Mac's Finder does not do better), Shared, AirDrop, Tags, Network, and Pictures, Music and Movies, which on the Mac are a permission prompt the first time they are read.

**Adding a favorite.** Drag is how both platforms do it, and neither makes it the only way: the Finder has File > Add to Sidebar (⌃⌘T) and Windows has Pin to Quick access on every folder's context menu. So:

- **Add to Sidebar** on every folder's context menu and the More menu, and on the location row for the folder on screen, with ⌃⌘T through the command table. The main affordance, since it is where people already look for things to do to a folder.
- **Drag** a folder between two sidebar rows (insertion line, phase 3), from our browser or from the Mac's Finder.
- **A `+` on the Favorites heading,** shown on hover, opening the system folder picker. For someone who has never favorited anything and does not know the sidebar takes drops; it costs one icon.
- Folders only in this pass. The Finder takes files with ⌘-drag; a file favorite is rare and raises a question (what does selecting it do) not worth settling now.

**Keeping, ordering, removing.**

- **Remove from Sidebar** on every favorite's context menu, defaults included. Removing a default hides it rather than deleting a record, and **Restore Default Favorites** on the heading's context menu brings the defaults back. No drag-out-to-remove: the Finder's "drag off until the remove sign shows" is exactly the accident this plan is trying not to have.
- **Reorder** by dragging a row within Favorites. Locations keep the system's order.
- Dragging a sidebar row never moves the folder on disk, wherever it is dropped. It is a reference. Dropping one onto another app gives that app the folder, as a copy, which the native drag already guarantees.
- **Stored** in main's preferences, per machine rather than per workspace: paths are machine-local, and two workspaces on one Mac should not have two sidebars. A favorite whose folder is gone shows dimmed with Remove from Sidebar. A move or rename made through the app updates any favorite it carries along, since the journal knows both paths. Moves made outside the app are not followed (the Finder uses file bookmarks for that, which is not worth adopting yet).
- Not importing the Mac's own Finder favorites. They live in `com.apple.LSSharedFileList.FavoriteItems.sfl4`, a keyed archive of bookmarks that changes format across macOS versions. Tempting as a first-run seed, too fragile to depend on.
- **A favorite is not a grant.** Adding a folder to the sidebar gives the agent nothing; folder access stays where it is granted today.

The sidebar's menu half (Add to Sidebar, remove, restore, the new layout and glyphs) needs nothing from the other phases and can land first.

## What can go wrong

Every row here is a way a drag or paste does damage, and what keeps it from happening. `files.transfer` enforces the refusals, so they hold for drag, paste and any later caller alike.

**Breaking the app's own data.** The workspace (chats, tasks, topics, each with `.instrument/task.db` and `settings.json`) lives in the user's Application Support by default and is reachable from the home folder. Moving a chat's folder, a task's `.instrument`, or `task.db` breaks that chat or task.

- Refuse, as source or destination: anything inside an `.instrument` folder, the workspace's own layout folders (`chats/`, `tasks/`, `topics/` and each chat, task and topic folder itself), and the app's userData. Files a task made in its folder can still be moved out; the folder itself cannot. The same rule as `d91a5a12a` (no deleting a workspace folder that holds userData), extended to moves.
- Refuse moving anything into or out of a running task's folder with "That task is still working." Copies out are fine.

**Moving what the system or the person depends on.** The home folder, its standard folders (Desktop, Documents, Downloads and the rest), volume roots, `~/Library`, and the Instrument folder are never moved, renamed or trashed from here. macOS refuses some of these through ACLs already, but the refusal should be ours and say why, not an `EPERM` toast. Moves inside `~/Library` are refused too; it is hidden in the Finder for a reason, and reaching it by accident through a spring-loaded folder is easy.

**Bundles that look like folders.** An `.app`, a Photos library or a `.bundle` is a folder on disk and a single thing to the person. The browser should list packages as items, not folders: they do not spring open, a drop on one is not a move into it, and they move or copy whole.

**The accidental drop.** Covered by the safety model: same-volume operations only, so nothing is slow or partial; the rest-before-arm on targets; the Undo toast; the journal behind ⌘Z that survives restarts; drops from our own drag classified by their paths, never by a timer; Escape cancels the drag (the OS does this) and closes any folders spring-loading opened.

**Overwriting.** Never silent. Conflicts always ask unless the caller already answered, Replace trashes the old item rather than deleting it, and "Apply to all" is opt-in.

**Big and slow copies.** Refused in the first cut: a copy that cannot be a clone does not run. When cross-volume copies come, they run in a child process, staged under a partial name, measured and confirmed first, cancellable (phase 2's "Big copies, later").

**Leaving iCloud Drive.** Moving a file out of iCloud Drive to a local folder takes it off the person's other devices. The Finder confirms this; we do too, naming the effect. It is the one same-volume move that asks. Copying out is a clone of what is on disk; a file iCloud evicted to save space has to download first, so copies of evicted files are refused in the first cut with a message to open it once.

**Symlinks.** A move moves the link, not its target. A copy copies links as links with their targets verbatim, so a relative link is not rewritten to an absolute one; check this for whichever of `ditto` and `cp` the copy uses.

**Exposure to the agent.** A file dropped into a task's folder or a granted folder is now something the agent can read; a file moved out of one is gone from it. That is the point of dropping a file on a task, not a bug, but it is why drops in from the computer copy by default (the original stays where the person had it), and no drop ever grants folder access implicitly. Granting stays the composer's existing folder drop.

**Permissions.** A file dragged in from the Desktop when the app has been refused Desktop access: the drop is the person's intent, and macOS should let the app read what was dropped, but the copy runs in main, not the renderer that received the drop. Verify before building; if main cannot read it, the drop asks for access instead of failing.

## Measured

Throwaway files in a scratch folder on this Mac's APFS data volume, 2026-10-02, Node 24.15. A folder of four 512 MiB files, 2,000 small files and a relative symlink:

| Operation | Time | Disk used |
| --- | --- | --- |
| `fs.rename` of the 2 GiB folder into a sibling | 0.3 ms | none |
| Undo: `fs.rename` back | 0.1 ms | none |
| `fs.cp` of the folder with `mode: COPYFILE_FICLONE` | 3.2 s | 2 GiB (a full copy) |
| `fs.copyFile` of one 512 MiB file with `COPYFILE_FICLONE` | 0.44 s | 512 MiB (a full copy) |
| `fs.copyFile` with `COPYFILE_FICLONE_FORCE` | fails, `ENOSYS` | none |
| `cp -cR` of the folder | 0.36 s | none (a clone) |
| `ditto --clone` of the folder | 0.43 s | none (a clone) |

Also confirmed:

- `fs.rename` of a file onto an existing file replaces it silently, and of a folder onto an existing empty folder replaces that too. Onto a non-empty folder it fails with `ENOTEMPTY`. Hence "Rename never replaces" in phase 2.
- `fs.rename` and `fs.cp` into the item's own descendant both refuse (`EINVAL`).
- `fs.cp` with `errorOnExist: true, force: false` refuses an existing target (`ERR_FS_CP_EEXIST`), and `verbatimSymlinks: true` keeps a relative link relative.
- A copy is independent of its original: editing one leaves the other alone.
- Across volumes (a mounted 20 MB disk image): `stat().dev` differs, and `fs.rename` fails with `EXDEV`, so the same-volume check is a single comparison and a rename can never quietly turn into a copy.

What this means for the plan: moves are exactly as cheap and reversible as the safety model needs; copies must not go through Node; and a rename needs a guard in front of it.

## Order and size

| Phase | Ships | Rough size |
| --- | --- | --- |
| 5a. Sidebar, menu half | New layout and glyphs, stored favorites, Add to Sidebar / ⌃⌘T / `+`, remove and restore | Small |
| 1. Multi-select | ⌘/⇧-click, ⌘A, rubber band, menus act on the set, multi-file drag out | Large: touches every view in `file-system.tsx` |
| 2. Transfer and undo | `files.transfer` (same volume only), conflicts sheet, refusals, the journal, `files.undo`, ⌘Z | Medium |
| 3. Drops | Folder and sidebar targets, files in from the computer, the window-level no-drop handler, rest-before-arm, spring-loading, the drag record in main, the Undo toast, composer attach from the Finder, composed drag image | Medium |
| 4. Keys and pasteboard | Shortcuts in the command table, pasteboard file URLs | Small/medium |
| 5b. Sidebar, drag half | Drop between rows to add, drag to reorder | Small |
| Later | Cross-volume copies in a child process | Medium |

5a is the cheapest visible win and can go first. Phase 2 needs nothing from phase 1 and can land in parallel with it. Phase 3 is gated on phase 2 and can ship single-item before phase 1 if multi-select slips; both take a set from the start so nothing is redone.

## Verifying

- Unit: `files.transfer` against a temp tree, `it.each` over move/copy × same folder / sibling / into self / conflict × each answer, and a source on another device (refused).
- Unit: the refusals, one `it.each` row per protected path class (an `.instrument` file, a chat folder, userData, home, Desktop, a volume root, `~/Library`, a running task's folder, folder into its descendant).
- Unit: the journal: undo of each operation kind; undo refused when the item has moved since or its old place is taken; entries surviving a reload of the store.
- Unit: favorites store (add, remove a default then restore, reorder, a journaled rename carried into a favorite).
- Unit: selection reducer (anchor, ⇧-extend, ⌘-toggle, collapse on plain arrow) as a pure function, separate from the views.
- The running app, by hand on macOS: drag a file from our Finder to a folder in it (moves, Undo puts it back), with ⌥ (copies), a large folder into a sibling (instant, Undo instant), a release while sweeping across rows (nothing happens), to the Desktop (copies, task keeps its file), from the Desktop into our Finder (copies), back from the Desktop after a long spring-loaded hover (still treated as external), between two Studio windows (moves), several mixed files and folders from the Desktop at once, a file from our Finder onto the composer (attached), a folder onto the sidebar between rows (added, not moved), a drop on the tab strip and on a file tab (no-drop cursor, nothing in the logs), a file from an external disk (refused with the Finder pointer), ⌘Z after quitting and relaunching (still undoes), and the source list under "Files in from the computer". CDP cannot drive a native drag session, so these are hand checks, chained into one session.
- Windows: one pass of the same list on the test host, expecting the copy cursor on internal moves and copies refused.

## Decisions

Settled:

- **The Mac's words and layout on every platform,** revisited for Windows only if familiarity there becomes a reason.
- **Instrument sits under Recents,** outside Favorites. **The home folder stays on** in Favorites. **iCloud Drive goes under Locations.**
- **Site tabs keep the browser's drop behavior.**
- **A file from the Finder dropped on the composer attaches** by reference, per `chat-attachments-by-reference.md`.
- **External drops copy;** ⌘ moves.
- **Trash undo is out** until there is a trustworthy way to find the trashed item.

- **Undo-backed drag-to-move** for the first cut: no confirmation on same-volume moves, the Undo toast on every drop, and ⌘Z from the journal. Copy-only drops and confirm-until-proven were the more cautious alternatives, kept in the safety model in case practice argues for them.
