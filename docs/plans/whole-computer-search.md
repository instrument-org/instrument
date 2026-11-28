# Plan: find a file anywhere on the computer by name, for the person and the agent

Status: open. Not started; the source it rests on is measured (below).

## What we want

One search by file name across the whole computer, reachable two ways:

- **The person**, from the command menu and from Files.
- **The agent**, as a read-only search that returns names and paths, never contents.

It must never put up a system dialog, and it must never show a name from a folder the app has not been let into.

## The source: the system's own index

The app keeps no index of its own. On macOS it asks Spotlight, and on Windows it asks Windows Search. The reasons are measured in [Spotlight answers only for folders the asking app can read](../findings/spotlight-search-follows-folder-permissions.md):

- **No dialogs.** Run as the signed app on a clean VM, a Spotlight query that names no folder raised no dialog.
- **It follows the app's permissions.** It returned nothing from Desktop, Documents or Downloads before macOS was asked. After the person allowed Documents, it returned what Documents had. So it shows exactly what the app may read, which is what both the person and the agent should see.
- **Speed.** A whole-Mac query took 58 to 88 ms on the VM and about 650 ms on a busy Mac. On Windows, Windows Search answered name queries in a median of 74 ms over one open connection.
- **Nothing to keep up to date.** The system indexes in the background and pays for it.

What an index of the app's own, tried and set aside, would add instead: a copy of names in memory, a walk every minute, and folders the person allowed staying invisible, because the walk can't tell an allowed folder from one never asked about without reading it.

## Rules

- **Never name a guarded folder in a query.** A query scoped to Desktop, Documents, Downloads or iCloud Drive raises that folder's dialog. Scope queries only to folders the app may already read, or name none.
- **The agent sees what its reads may see.** Results go through the same rules as the agent's file reads (`docs/architecture/agent-sandbox.md`): a path marked Not allowed, the sign-in folders and the app's own data are dropped before the agent sees them.
- **Rank names ourselves.** Spotlight returns results in no useful order. Rank them with the command menu's matcher (`apps/studio/src/shared/name-match.ts`), then by date modified.

## Steps

1. **macOS route.** Add a main-process route that runs Spotlight for the typed words with no folder named, caps the result count, and returns name, path, kind and date modified. Measure it on the VM before and after allowing Documents, as the finding did.
2. **Files.** From the home folder or the top of the disk, fill in the guarded folders the walk steps over with the route's matches from them. Those are exactly the folders macOS has allowed.
3. **Command menu.** Add a Files section that uses the route.
4. **The agent.** Expose the route as a read-only command that returns paths, filtered by the agent's read rules.
5. **Windows.** Query Windows Search's `SYSTEMINDEX` through one open connection, with the same result shape.
6. **Linux.** Its indexers (GNOME's LocalSearch, KDE's Baloo) are often off, so Linux keeps the folder walk and has no whole-computer search until one is chosen.

## Open questions

- Whether a query from inside the agent's sandboxed shell can reach Spotlight at all. A route in the main process avoids that question.
- Spotlight leaves out what the person excluded in System Settings, and some folders of source checkouts were not indexed on one Mac. Search results should not read as everything.
- Windows Search indexes only the properties of `.md` files, not their text. That doesn't matter for names; it matters if content search comes later.
