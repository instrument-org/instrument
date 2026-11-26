# Plan: import bookmarks and history from another browser

Status: open. Not started. Waiting on a go to build, and on the macOS access check (step 1) before the direct way is built.

Someone arriving with years of bookmarks in Chrome should find them in Instrument's browser on the first launch. They pick their browser, then one of two ways in:

- **Directly:** Instrument reads the browser's own files. Bookmarks and history, after one macOS prompt we explain first.
- **From a file:** the person exports bookmarks from their browser and chooses the file. It works for every browser and needs no permission at all.

Passwords, cards and addresses, open tabs, sign-ins (cookies) and extensions stay out. Each one needs something Instrument doesn't have: a password store, autofill, a parser for Chrome's encrypted session files, a cookie path Windows refuses, or a Chrome Web Store install.

## What ships

- **A setup step after the folder step.** It lists the browsers on this computer, starting on the default one (the same lookup "Open in" uses: `file-open-target/`, `rpc/routes/utils.ts`). For a browser that can be read directly, the next screen asks how: directly (the default) or from a file. A browser that only has the file way goes straight to its export steps. Not now skips the step and records it as answered.
- **The direct way.** A screen first says the Mac is about to ask and that the person should click Allow, then we read. If the person clicks Don't Allow, the screen offers the file way instead.
- **The file way.** We give that browser's export steps in its own menu names, then a drop target and Choose File, which opens at Downloads. Chrome 157 names them **Bookmarks and lists › Open Bookmark Manager**, then **⋮ › Export bookmarks**. Brave matches Chrome. Edge has **Export favorites**, Firefox **Export Bookmarks to HTML**, and Safari **File › Export Browsing Data to File…**, whose zip carries history as well.
- **A results screen** with what came over and where it went, plus Import another browser.
- **Browser's empty shelf** offers Import from the default browser, plus another browser. Outside setup the same steps open in a sheet over Browser.
- **A Browser tab in Settings.** It lists each import, how it came in and when, with Import again, plus Import… for a new one.
- **A second import doesn't mix with the first.** The first import's bookmarks land at the top level. A later browser's go in a folder named for it ("From Safari"), which is what Chrome and Safari do. Importing the same browser again adds only addresses that aren't already there.

## Sources

| Browser | Directly | From a file |
| --- | --- | --- |
| Chrome, Edge, Brave | `Bookmarks` (JSON) and `History` (SQLite) in each profile | Bookmarks HTML |
| Vivaldi, Opera, Arc, Helium, Island, Chromium | The same files and formats, under their own folders | Bookmarks HTML, where the browser exports it |
| Firefox, Zen | `places.sqlite` in each profile, found through `profiles.ini` | Bookmarks HTML |
| Safari | Not offered: its files need Full Disk Access, which Instrument never asks for | The export zip: bookmarks HTML and history JSON. Older Safari's File › Export › Bookmarks… writes the HTML alone |

- **Chromium family.** The formats are Chrome's, so a Chromium browser costs one row in the table. Ardia's table (`agent-reference get ardia`, `packages/import/ios/Core/Discovery.swift`) is a reference for the Mac folders, and for Opera, which keeps its profile at the folder's top level. Arc's sidebar (its pinned tabs and spaces) lives in a JSON file of its own and stays out. Its Chromium bookmarks and history come over like any other.
- **Firefox family.** Bookmarks are the `moz_bookmarks` tree joined to `moz_places`, and history is `moz_historyvisits`. The file is unencrypted.
- **Reading safely.** Every SQLite file is copied with its `-wal` beside it and opened read-only from the copy, through `node:sqlite` (the history store already uses it). The browser may be running and holding the original.
- **One HTML parser covers every browser's export.** The format is the old Netscape bookmarks file, with folders as `<H3>` over `<DL>`. Each browser marks its toolbar folder its own way: `PERSONAL_TOOLBAR_FOLDER` in Chrome and Firefox, the `com.apple.FavoritesBar` id in Safari. Ardia's `NetscapeBookmarks.swift` is a reference for the cases.

## Where it lands

- **Bookmarks.** A `Bookmark` today is an id, order, title and URL (`shared/bookmarks.ts`), with no folders, and the shelf draws a flat grid. Keeping a browser's folders needs both of these:
  - **A folder field** on the bookmark, such as `folder: string[]`, the path of folder names. It goes on the synced store's value (`bookmarks/bookmark-store.ts`).
  - **Folder tiles** on Browser's home that open to their contents.

  An older build parses the value with a plain `z.object`, so it reads a bookmark that has a folder fine, as a top-level one. But that build rewrites the whole value when it renames or moves the bookmark, which drops the folder. Two devices on different builds are rare enough to accept this, or a migration can bump the store.
- **History.** Imported visits are written into the history store's `urls` and `visits` (`browser-view/history-store.ts`, already modeled on Chromium's tables) as the person's own visible visits, at their original times.
  - **Times:** Chrome counts microseconds from 1601, Firefox microseconds from 1970, and Safari's export JSON milliseconds.
  - **Transitions:** Chrome's core transitions map to `typed`, `link` and `back_forward`; everything else becomes `link`.
  - **When history is off:** no history is imported while `keepsHistory` is off, and the results screen says so.
- **A record of each import**, for the Settings list and Import again: the browser, the way in, the counts and when. It goes in the workspace's machine `state.json`, since it describes this computer's browsers.

## Code

A module `electron-main/browser-import/`:

- `browsers.ts`: the browsers we know. For each one: its name, family, the app that is it on each system, and its data folder on each system. That's about a dozen rows, and one release channel per browser.
- `discover.ts`: the rows whose app is installed and whose data folder has a profile. The app check tells a browser apart from its leftovers. Profile names come from Chromium's `Local State` and Firefox's `profiles.ini` once the person picks the browser. On a Mac this only uses `stat`: macOS 27 refuses to list Chrome's folder, but it answers a `stat` of `Google/Chrome/Local State` with no prompt.
- **Not done: finding Chromium browsers by scanning for `Local State`.** Every Electron app writes one (about 35 matched on one developer's Mac, Slack, VS Code and 1Password among them). Requiring a profile's `Bookmarks` and `History` still let through an Electron app with a `History` file and a backup copy of Chrome's folder. And browsers that were uninstalled leave folders behind. A browser that isn't in the table still has the file way.
- `chromium.ts`, `firefox.ts`, `netscape-html.ts`, `safari-export.ts`: one reader each, returning the same shape (a tree of folders and bookmarks, and a list of visits), each tested against small fixture files written by the tests themselves.
- `apply.ts`: writes a result into the bookmarks store as ops and into the history store, folding a re-import against what is already there.
- An RPC under `browserImport.*` (`list`, `read`, `readFile`, `apply`), and the screens: a setup step, the Browser shelf's empty state, the sheet, and the Settings tab.

## Order

1. **Find out what macOS 27 asks.** On the macOS VM clone, try reading Chrome's and Firefox's folders from a fresh install. Do we get EPERM, a prompt, or nothing? And does picking the folder in an open panel grant access? Confirm there too that the signed app can `stat` `Local State` with no prompt, which so far has only been seen from a terminal. Ardia treats EPERM there as needing Full Disk Access, which is our hard line. If an open-panel pick doesn't grant access either, the direct way on a Mac is the panel itself ("Choose Chrome's folder"), or file-only.

   Probed on macOS 27.0.1 as an ad-hoc signed app with no grants: Chrome's, Brave's, Edge's and Firefox's profile folders are refused at once with no prompt (App Data Protection), and a per-app switch for it shows in Files & Folders only after that first refusal. Automation for Chrome is one prompt and then gives every tab's title and address. The open-panel pick is still unchecked.
2. The readers, the HTML parser and apply, with fixture tests. The file way alone is shippable at this point.
3. Bookmark folders in the store and on the shelf.
4. The screens: setup step, shelf, sheet, Settings tab.
5. Windows and Linux. Their folders have no prompt, but a running Chrome on Windows may hold `History` locked against copying. Check on the Windows test host, and if so, ask the person to quit Chrome first.

## Open questions

- Folders in bookmarks: the folder path above, or one folder per import with everything inside it flattened? The first keeps what people built. The second needs no change to the shelf.
- On a Mac, does the direct way survive step 1 as a prompt, as an open-panel pick, or not at all?
