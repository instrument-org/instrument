# Plan: Files searches everything under the folder you're in

Status: open. Built: flat results, Folder column, name and kind matching, status lines. Checked on a clean macOS VM and on the Windows ARM test VM.

## What we want

Searching in the Files view should work the way an operating system's file browser does: type in the search field while in a folder and get every match anywhere beneath it, as one flat list you can sort by any column (date modified included), with a column saying which folder each match is in. That is the default on all three platforms we ship on: Finder's search field searches the current folder and its subfolders when "Search the Current Folder" is set; Windows File Explorer's search box always includes subfolders; GNOME Files and KDE Dolphin ("From Here") search the current folder recursively. Nobody expects a folder search to stop at the folder's own entries.

Motivating case: a folder kept as one chronological list of a few thousand files in a hundred folders only stays usable with subfolders if everything under it can be seen flat and sorted by date.

## Decided

- **Scope is the current folder and everything under it. No search outside it** (no "This Mac" scope bar). Searching outside needs a disk index like the one parked in draft PR #211 (branch `file-name-index`), which was set aside because macOS cannot tell the app which folders it was granted without reading them, and reading can raise a system dialog; it also missed folders reached through links (iCloud Drive) and drowned in source-checkout noise. Inside the folder you are in, macOS has already answered. When nothing matches, the empty state offers Clear search alone. ⌘K is not offered there: it searches the app, not this computer, so offering it after a folder search reads as a search of the whole computer.
- **Results are flat**, one row per match, every existing sort key, plus a Folder column (the parent folder as a path from the current one, a dash for the current folder itself). Columns view falls back to the list while searching, as Finder does.
- **Matching is by name, word by word**, the same rule ⌘K uses (`foldWords` and `matchRank` in `apps/studio/src/shared/name-match.ts`), not the current substring of the relative path. Kind filters stay as they are.
- **Opening search does nothing until something is typed or a kind is picked**, as in Finder. A kind picked alone (HTML, say) finds that kind in every folder under this one, the same as words do.
- **Results arrive in two steps:** matches the folder already lists show at once, and the rest arrive together, sorted into place, when the folders below are read. A "Searching Instrument and its folders…" status line shows only when reading takes longer than 300 ms. The folders are read once per search, so later keystrokes filter at once.
- **The search shows in the toolbar's field and the status line only** ("10 found in Instrument and its folders"). The address and the tab title stay as they are; with a file open beside the folder the address names the file anyway.
- **The toolbar keeps every control while searching.** Controls sit at the right, as in Finder, and the field stays open wherever it fits. As the folder narrows, the four view buttons fold into one view menu, then views and sort fold into the More (⋯) menu above its own items, then the field becomes a button and the folder's name its icon.

- **A search is not bookmarkable.** It lives in the tab's history, so Back and Forward return to it, but not in the address, so the star bookmarks the folder alone.

## Later

- Bookmarking a search, which would put it in the address and make a bookmark a saved search that runs again when opened.

## Where it stands today

- Search only sees what is already loaded: the current folder's listing plus folders expanded in place (`client/components/window/computer-page.tsx` reads one listing per loaded folder; `loadChildren` adds one only when a folder opens). A file one level down in an unopened folder is invisible.
- Matching is a lowercased substring of the path relative to the current folder, or of a title the list has read (`normalizeSearchQuery` and `matchesWords` in `client/components/extend/file-system.tsx`).
- Results are a tree: matches under their ancestors, forced open (`isRevealing` and the table walk after it). No flat list, no Folder column (`FileSystemListColumn`).
- The list and grid are already virtualized, so row count alone does not cost rendering.

## Walk timing

A standalone script mirroring step 1's walk (level at a time, three reads at once, `lstat` per entry, dot names and `node_modules` skipped, packages not entered, guarded home folders skipped, 30k cap), on a recent Mac:

| Folder | Items | Cold | Warm |
| --- | --- | --- | --- |
| About 3,000 files in 60 folders, in iCloud Drive | 2,966, complete | 0.48 s | 0.06 s |
| A folder of source checkouts | 30,000, capped | 2.7 s | 1.0 s |
| The home folder | 30,000, capped | 1.1 s | 1.0 s |

So a folder of documents answers before the person finishes typing, and a big tree needs a loading state and always reaches the cap. Because the walk is level by level, a capped result keeps the shallowest items: sorting it newest first shows the newest of what was found, not the newest under the folder, and the status line has to say the list is partial. In the home folder the walk starts as soon as search opens, so it should start on the first keystroke or the first sort while search is empty, not on focus alone.

## Step 1: spike

1. **Main process: list a subtree.** A route beside `folderSizeRoute` in `apps/studio/src/electron-main/rpc/routes/files.ts`, built from the walk in `apps/studio/src/electron-main/lib/folder-size.ts`, which already stays on one volume, uses `lstat` (never follows links), steps around macOS's guarded home folders so no system dialog appears (`folderSizeSkips`, `MACOS_GUARDED_HOME_FOLDERS`), gives up on a folder after 10 s, and stops when aborted. Add, from `walk.ts` on the `file-name-index` branch: skip `node_modules` and dot-folders, list macOS packages without entering them, walk a level at a time, and stop at 30k entries with a `truncated` flag. Return name, path, isFolder, size, created and modified times. Read only names and stats, so iCloud placeholders are never downloaded.
2. **Client: keep the results beside the folder tree.** When search starts, `computer-page.tsx` fetches the route with React Query keyed by folder and refetches when search opens again. Keep the result as its own list rather than merging it into `titledItems`, so up to 30k entries never pass through `buildFileSystemIndex`, which rebuilds the whole folder tree's index.
3. **Flat rows.** While searching, the table builds rows from that list, all at depth 0, sorted by the comparator `sortedIndex` already uses. Add a `"folder"` column. Selection, Quick Look and drag are keyed by path, so they carry over.
4. **Matching** switches to `name-match.ts` as above.
5. **Status line:** "Showing the first 30,000 items" when truncated; in the home folder, name the guarded folders the walk did not enter.

Results are a snapshot taken when search starts; folders on screen keep updating live.

## Checked on a clean macOS VM

A signed preview on a freshly cloned macOS 27 test VM with no privacy answers, with `pricing-*` files planted in Desktop, Documents, Downloads, a `Projects` folder, and a disk image mounted under `/Volumes`. A dialog was looked for on the VM's screen after each step.

| Search for "pricing" in | Found | macOS dialog |
| --- | --- | --- |
| The home folder, nothing answered yet | the 3 in `Projects`; the status bar names Desktop, Documents, Downloads, Library, Movies, Music and Pictures as not searched | none |
| The disk's top level | 2 of the 3 in `Projects`: the walk reached its 30,000 cap in the system's folders first; the disk image was not entered | none |
| Documents, once opened in Files | all 3 under it, nested ones included | only the one Documents asks when Files first lists it, before any search |
| Desktop, refused when Files first listed it | Files shows its refused page; nothing asks again | none after the refusal |
| The home folder again, Documents allowed and Desktop refused | the same 3; Documents is still stepped over from above | none |

Two gaps this leaves. A search from the home folder never enters a guarded folder, even one the person has allowed, because the walk can't tell an allowed folder from one never asked about without reading it; Spotlight can, since it answers only for folders the app may read ([finding](../findings/spotlight-search-follows-folder-permissions.md)). And a search from the disk's top level spends its cap on the system's own folders.

## Checked on the Windows ARM test VM

The x64 preview, running under emulation on the Windows ARM test VM, as a new local user with `pricing-*` files planted in Desktop, Documents, Downloads and a `Projects` folder (seven in all). OneDrive was installed but not signed in, so nothing was redirected to it.

| Search for "pricing" in | Found | Windows prompt |
| --- | --- | --- |
| The home folder | all 7, with the right Folder for each | none |
| Documents | both under it | none |
| `C:` | none, ending at "0 found in the first 5,054 items under C:" | none |

Two things it turned up, both fixed since:

- **A home search walked AppData.** About 18,600 of the home folder's 18,700 entries were in `AppData`, and every one went to the window. A walk from the home folder now steps over `AppData` on Windows and offers it under "not searched", as macOS's guarded folders are.
- **A step that stopped responding read as the cap.** The `C:` walk ended at `C:\Windows\System32` (4,526 entries) when one step there took longer than the 10-second limit. The same walk run on its own, by the app's own binary, read 33,500 entries in 2.7 seconds, so the slow step was the app under emulation, not the disk. The status bar now names the folder: "0 found before System32 stopped responding".

Typing was slow there: seven keystrokes took up to two minutes to show while the window matched the 18,700 names it had been sent. That run was under x64 emulation with a busy main process, so it says little about a native machine, but it is the case the AppData skip removes.

## Measure before calling it done

- The same walk on Linux: check what its noise folders are (`.cache` is already left out as a dot folder) and that nothing raises a prompt.
- Typing latency on a native Windows machine with a home search, now that AppData is stepped over.
- Typing latency while matching 30k names on the renderer thread.

## Out of scope

Searching outside the current folder, file contents search, saved searches and Finder's rule rows.
