# Spotlight answers only for folders the asking app can read

**Status:** open. Measured on macOS 27, including as a signed preview on a freshly cloned test VM with no privacy answers, and on the Windows test host.

The system's own file index is the obvious source for a search of the whole computer, by the person in Files and by the agent. These probes ask whether using it raises macOS's privacy dialogs, whether it leaks names from folders the app was never let into, and how well it finds files by name.

## Spotlight leaves out what the asking process can't list

As the signed app, on a test VM with `pricing-*` files planted in Desktop, Documents and Downloads (two each, one nested), in a `Projects` folder in the home folder (three), and in a folder inside Documents (one): `mdfind -name pricing`, with no folder named, run by the app's own binary in Node mode from a launchd job so that the app was its own responsible process.

| When | Results | From guarded folders | Time | Dialog |
| --- | --- | --- | --- | --- |
| SSH session holding Full Disk Access, for comparison | 10 | 7 | | |
| The app, before macOS was asked anything | 3 | 0 | 58 ms | none |
| The app, after the person allowed Documents | 6 | 3, all in Documents | 88 ms | none |

So Spotlight follows exactly what the app may read: nothing from a guarded folder before macOS has been asked, everything in a folder once it is allowed, and never a dialog for a query that names no folder.

The same whole-disk query, `mdfind 'kMDItemFSName == "*.md"'`, with no folder named, was run from two processes on one Mac and the results were counted by where they were:

| Asked by | All results | Documents | Downloads | iCloud Drive (`Library/Mobile Documents`) |
| --- | --- | --- | --- | --- |
| A terminal holding Full Disk Access | 137,300 | 11 | 65 | 11,633 |
| Node started from launchd, with no folder grants of its own | 125,591 | 0 | 0 | 0 |

Spotlight drops whatever the asking process could not list itself, and that includes iCloud Drive's separate permission. So a query that names no folder doesn't leak names from a guarded folder, and the price is that it can't see that folder either. A process started from a terminal inherits the terminal's grants, so that run says nothing about what the app would see. Whether the query with no folder named raised a dialog wasn't recorded.

An earlier probe found the same for other apps' iCloud folders: listing them worked once the iCloud Drive permission was granted, but both `NSMetadataQuery` and `mdfind` still returned nothing for them.

## Naming a guarded folder in the query raises its dialog

`mdfind -onlyin <folder>` on Documents, Desktop or Downloads, from the process with no grants, raised that folder's privacy dialog naming the process (three dialogs, one per folder). So a scoped Spotlight query counts as a read of the folder it names. Code must never scope a query to a guarded folder macOS hasn't answered for, and a probe must never do it on a person's own Mac.

## How well Spotlight finds by name

From the terminal, over Documents, Downloads and two notes folders, 32 file names chosen in advance were all found, with about 28 results per query in no useful order, at about 650 ms per query (790 ms worst), process startup included. A folder of source checkouts returned nothing: Spotlight doesn't index every folder, and the person can leave any folder out in System Settings.

## Windows Search

Windows has no read dialogs. Querying its index (`SYSTEMINDEX` through the `Search.CollatorDSO` provider, over one open connection) on the Windows test host, scoped to Documents and Downloads with 20,834 indexed items:

| Probe | Found | Median results | Median time |
| --- | --- | --- | --- |
| 40 file names | 39 | 2 | 74 ms |
| 12 phrases inside `.txt` files | 12 | 1 | 7 ms |
| 20 phrases inside `.md` files | 0 | | |

Windows Search indexes only the properties of `.md` files, not their text.

## Still to establish

- Whether the agent's sandboxed shell can reach Spotlight's service at all.
- Ranking: Spotlight returns results unranked, so a search box has to order them itself.
