# A folder opened from the panel is not a Files & Folders grant

**Status:** open, working as macOS designs it. Checked 2026-10-22 on macOS 27.0.1 (the macOS test VM, signed preview build, no Apple Account). The iCloud Desktop & Documents case is not verified.

macOS has two separate ways to let Instrument read Desktop, Documents, Downloads or a folder inside them, and System Settings shows only one of them. That is why a person can see Desktop switched off in Privacy & Security › Files & Folders while Instrument reads it, and why access granted through Instrument's own folder panel ("Choose Desktop…" on a chat's card, "Choose the folder…" in Files, the setup page's Change) never appears in that list.

## How it was probed

Everything below was run against the installed, signed app, either through its own window (the folder panel) or as its binary in Node mode from a launchd job (`launchctl submit -l <label> -- /usr/bin/env ELECTRON_RUN_AS_NODE=1 <app binary> <probe.cjs>`, which makes the signed binary its own responsible process), so its own privacy answers applied and a shell's Full Disk Access did not. Each probe is a fresh process, so "readable" means readable by any later process of the app, not just the one that picked. System Settings was read and toggled through its accessibility tree.

## A. The system prompt and the open panel record different things

| | System prompt (Allow / Don't Allow) | Folder panel pick |
| --- | --- | --- |
| Raised by | the app's first listing or read inside the folder | the person choosing a folder in the app's `NSOpenPanel` (`dialog.showOpenDialog`, `showFolderPicker` in `electron-main/rpc/routes/utils.ts`) |
| Where it is kept | a TCC record per app and service (`kTCCServiceSystemPolicyDesktopFolder` and its siblings) | a `com.apple.macl` extended attribute on the picked folder itself, holding an opaque identifier for the app |
| Covers | the whole of Desktop, Documents or Downloads | the picked folder and everything under it, nothing above it: a pick of `Documents/Picked` left `Documents` refused |
| Shows in Files & Folders | yes, as a switch under the app (on for Allow, off for Don't Allow) | no. A pick of a folder never asked about adds no row; a pick of Desktop while its switch was off left the switch off |
| Survives relaunch and reboot | yes | yes, both (reboot checked on the VM; relaunch also seen on a production build earlier) |
| Switch turned off | reads fail at once with `EPERM`, no prompt | no effect: Desktop stayed readable with its switch off, whether it was turned off before the pick or after |
| Removing the app's row with "−" | clears the answers, so unpicked folders ask again | no effect: every picked folder stayed readable |
| `tccutil reset All <bundle id>` | clears every answer; the Documents prompt came back | no effect |
| `xattr -d com.apple.macl` | n/a | exits 0 and changes nothing (the attribute is protected) |

The panel is drawn by macOS out of the app's process, so it lists a refused folder's contents and choosing it is taken as the person's intent. Nothing the person can reach in System Settings undoes a pick. Deleting the folder would drop the attribute with it; that was not tried.

A folder the app creates gets the same attribute. With Documents refused, the app made `Documents/AppMade` (creating inside a refused folder succeeds, see [the folder ask finding](macos-folder-ask-holds-listings-not-writes.md)); the new folder carried a `com.apple.macl` and a later process of the app could list it while `Documents` itself still failed with `EPERM`. So an Instrument folder the app made inside Documents stays readable to it whatever the Documents switch says.

The per-user TCC database (`~/Library/Application Support/com.apple.TCC/TCC.db`) is not visible at all on macOS 27: the folder is missing from a listing of Application Support even for a shell holding Full Disk Access. The system database under `/Library` is readable with Full Disk Access. Neither is readable by Instrument, which never holds Full Disk Access.

## B. iCloud Desktop & Documents (not verified)

The test VM has no Apple Account, and signing one in needs a real account with two-factor approval, so this was not run. What follows is inference, to be checked on a Mac with the setting on.

- With Desktop & Documents in iCloud, those two folders are part of iCloud Drive, which macOS serves through its File Provider. An earlier probe found the "iCloud Drive" switch in Files & Folders (`kTCCServiceFileProviderDomain`, prompt "files managed by iCloud Drive") opens all of `~/Library/Mobile Documents`. If that grant also covers a synced Desktop, it would make Desktop readable with the Desktop switch off, the same symptom a panel pick gives through a different route.
- A pick still sets `com.apple.macl` on the folder; whether File Provider keeps or strips that attribute on a synced folder is unknown.
- To check on such a Mac: expand Instrument's row in Files & Folders and note whether an "iCloud Drive" row is there; read `xattr -l ~/Desktop` for `com.apple.macl`; then, as the signed app, list Desktop with the Desktop switch off and the iCloud Drive switch off, then each on alone.

Downloads behaving as expected fits either explanation: it is not part of Desktop & Documents sync, and nobody had picked it.

## C. The greyed "Full Disk Access" row

Under an app in Files & Folders, a greyed "Full Disk Access" row with no switch means that app holds Full Disk Access, which overrides every folder switch, so the switches no longer matter for it. On the VM it appeared under `sshd-keygen-wrapper` (Full Disk Access on) and not under `siriactionsd`, which is listed in the Full Disk Access pane with its switch off. An app that is in the Full Disk Access list but switched off gets no such row.

Not checked: whether the row can lag behind the Full Disk Access pane. If it shows under an app whose Full Disk Access switch is off, look for a second copy of that app (an older beta or a preview has its own bundle id and its own entries in both lists, under nearly the same name).

## D. What Instrument can tell the person

What the app can know about a folder macOS guards:

- **Whether it can read it, now.** A listing (`listFolder` in `lib/chat/folder-look.ts`) is authoritative whatever granted or refused it: open, or `EPERM` from macOS. This is what Settings › Permissions' "Your Mac is blocking this." and the chat's refused card already rest on (`macosRefusedFolders`, `lib/permissions/macos.ts`), so a folder the person allowed in Instrument that macOS refuses is reported truthfully once the app has looked.
- **Not why.** The switch state lives in a database the app cannot read, and a readable folder looks the same whether a switch or a pick opened it. The `com.apple.macl` value is readable by the app on a folder it can already read (and refused with `EPERM` on one it cannot), but its identifiers are opaque.
- **Not without asking.** Looking inside a folder nobody has answered for raises the prompt, so the app cannot quietly check Desktop, Documents or Downloads it has never touched.

So the app can always say truthfully that a folder is blocked, but it cannot explain a Files & Folders list that disagrees with what it reads, unless it keeps its own record. It is the only party that sees every pick: each one comes back through `showFolderPicker`.

A minimal "let the person fix it", as a recommendation:

1. **Lead with the panel on a refused folder.** It works with the switch off, takes one choice, and lasts across relaunches and reboots. System Settings is the second way in, and only works where a row exists: a folder macOS never asked about (Downloads above) has no switch to turn on.
2. **Record each pick of a guarded folder** (path and when) where Settings › Permissions can read it, and show it there: "You opened this folder to Instrument from its folder panel. System Settings doesn't list it." That is the one fact that explains the mismatch, and the app is the only one holding it.
3. **Never offer System Settings as the way to close a folder.** Turning a switch off, removing the app's row and `tccutil reset` all leave a picked folder readable. Instrument's own per-folder rules are the gate a person can actually close.
4. **Decide whether a card's panel should open at the whole guarded folder.** "Choose Desktop…" hands over all of Desktop for good, with no way back in System Settings. Opening at the folder the agent actually needs grants less. This is a product call, not a bug.
