# Safety and security across the work since the last review

Reviewed: `f0d6cf2fe..2298a3f8a`

A safety and security audit of everything landed since the 2026-11-14 review, asked for as a whole: what the agent can reach outside its rules, what the app does to the person's files and records on its own, and what leaves the computer. Readers worked blind, one per area: the agent's reach (work folders, the shell's unsandboxed commands, `office`, the browser bridge), Studio main (page dialogs, local file policy, extensions, kept state, IPC), the records and synced stores (drafts, projects, memory, `Chats/` sweeps, data parts), tab groups, privacy (reports and redaction), and packaging. Calibration is `REVIEW.md` and the threat model's five lines; findings were re-traced against the code at `2298a3f8a`, and the ones that turned on a swap or a race were run (the work folder link under the real Seatbelt profile, the kept-state sweep, the window look field script in jsdom). The fixes were made after the review, so their commits carry no `Review:` trailer.

## Findings

### A. A link the agent puts in its work folder takes the app's own writes and deletes anywhere

- Status: fixed `972c14e83`
- Where: [file-versions.ts](/packages/workspace/src/lib/file-versions.ts), [page-downloads.ts](/packages/workspace/src/lib/chat/page-downloads.ts), [bash.ts](/packages/workspace/src/tools/bash.ts), [background-processes.ts](/packages/workspace/src/lib/background-processes.ts)
- What: `~/.instrument/work` is the agent's to change, so a chat can swap its work folder or `Versions/`, `downloads/` or the spill folder for a link. Trimming versions then deleted the person's files in a folder the rules refuse, an agent-started download landed in `~/Library/LaunchAgents`, and the spill log wrote through the link. Confirmed under the real Seatbelt profile.

### B. An `soffice` on Linux's PATH and a bare `tar` run outside the sandbox at launch

- Status: fixed `a60d4a2b3`
- Where: [office/install.ts:150](/packages/workspace/src/lib/office/install.ts#L150), [office/unpack.ts:243](/packages/workspace/src/lib/office/unpack.ts#L243)
- What: finding an installed LibreOffice ran each `soffice` on PATH, which includes `~/.local/bin`, as the app.

### C. `office recalc` reads its export back with plain fs, and the app's temp folders follow the shell's `TMPDIR`

- Status: fixed `70c1d6008`
- Where: [shell-commands/office.ts:285](/packages/workspace/src/lib/shell-commands/office.ts#L285), [shell-commands/office.ts:478](/packages/workspace/src/lib/shell-commands/office.ts#L478)
- What: a swapped temp file read another workbook into the agent's; `TMPDIR=~/Library/LaunchAgents office recalc` had the app write there.

### D. `instrument window history` lists visited pages while "Chats can see this" is off

- Status: fixed `4bbf6ef79`
- Where: [capabilities/window.ts:1622](/packages/workspace/src/lib/capabilities/window.ts#L1622)

### E. A page's "Leave site?" destination skips the navigation check

- Status: fixed `4f0e08967`
- Where: [page-dialogs.ts:522](/apps/studio/src/electron-main/browser-view/page-dialogs.ts#L522)
- What: Leave went there with `loadURL` or `goToOffset`, which fire no `will-frame-navigate`, to the address the page named.

### F. The browser bridge takes a download folder and upload files as sent

- Status: fixed `08d05a537`
- Where: [cdp-bridge.ts](/packages/workspace/src/logic/server/routes/cdp-bridge.ts), [cdp-task-bridge.ts](/packages/workspace/src/logic/server/routes/cdp-task-bridge.ts)
- What: `Browser.setDownloadBehavior` and `DOM.setFileInputFiles` reached main unchecked from any program holding the bridge's secret, which the 2026-10-10 decision accepts sandboxed programs can read. A download into a startup folder, an upload of a private key.
- Note: the race between the check and the write is the one `own-file.ts` accepts.

### G. The tab group sweep deletes groups when a window's kept file cannot be read

- Status: fixed `5fb37caca`
- Where: [kept-state.ts:468](/apps/studio/src/electron-main/stores/workspace/kept-state.ts#L468)

### H. An error report's title goes out unredacted

- Status: fixed `55806ee1c`
- Where: [routes/problems.ts:126](/apps/studio/src/electron-main/rpc/routes/problems.ts#L126)

### I. Any page whose address starts with the Web Store's raises "Add extension"

- Status: fixed `50584f231`
- Where: [extensions.ts:767](/apps/studio/src/electron-main/browser-view/extensions.ts#L767)
- What: the library checks the origin with `startsWith`; `chromewebstore.google.com.example` passed. `downloads.open` also had no line on the permission sheet.
- Note: the library's other `startsWith` checks still hand `chrome.management.getAll` to such a page (finding Q).

### J. `react` and `react-dom` ship in every packaged build

- Status: fixed `fec74392f`
- Where: [apps/studio/package.json:76](/apps/studio/package.json#L76)

### K. A real login in a test

- Status: fixed `9c7764cdf`
- Where: [report-redaction.test.ts:274](/apps/studio/src/electron-main/lib/report-redaction.test.ts#L274)

### L. `window look` shows password fields inside shadow roots

- Status: fixed `3a44ac301`
- Where: [window-camera.ts:38](/apps/studio/src/electron-main/windows/window-camera.ts#L38)

### M. A local page's `file://host/…` reads are judged by path alone

- Status: fixed `98fc5f17c`
- Where: [local-file-policy.ts:268](/apps/studio/src/electron-main/browser-view/local-file-policy.ts#L268)
- What: on Windows Chromium opens it over SMB and hands the server the person's login hash.

### N. The `Drafts/` move-in takes every folder at the top level

- Status: fixed `83fd6e97f`
- Where: [drafts/move-in.ts](/packages/workspace/src/lib/drafts/move-in.ts)

### O. `caughtUp` reads an unreadable device folder as nothing unread

- Status: fixed `858ed6205`
- Where: [synced-store.ts](/packages/workspace/src/lib/synced-store/synced-store.ts)

### P. A file named like a copy of `CHAT.md` that mentions a chat anywhere in its head is deleted

- Status: fixed `4ddc7b96d`
- Where: [chat-transcript.ts:16](/packages/workspace/src/lib/chats-folder/chat-transcript.ts#L16), [conflict-copies.ts:77](/packages/workspace/src/lib/chats-folder/conflict-copies.ts#L77)

### Q. The extension library still answers spoofed store origins and gives every extension all cookies

- Status: fixed `45b410d81` (the store's origin check); open for the cookies
- Where: `electron-chrome-web-store` and `electron-chrome-extensions` (library code)
- What: `chrome.management.getAll` was reachable from a page at a look-alike store origin, and every extension gets `chrome.cookies` for every site and full URLs from `tabs.query`, whatever its manifest asks for. The store check is patched to the exact origin; scoping cookies and tabs to the manifest is a much larger patch to `electron-chrome-extensions` and outside the threat model's lines.

### R. Removing an extension from the Web Store's page asks nothing

- Status: fixed `106841fe9`
- Where: [extensions.ts:454](/apps/studio/src/electron-main/browser-view/extensions.ts#L454)

### S. A memory file left with no text is deleted with someone else's front matter in it

- Status: fixed `e57adbfff`
- Where: [memory/store.ts:475](/packages/workspace/src/lib/memory/store.ts#L475)

### T. Project and memory records drop fields a newer build added

- Status: fixed `59c876649`
- Where: [project-records.ts:23](/packages/workspace/src/lib/chat/project-records.ts#L23), [memory-records.ts:23](/packages/workspace/src/lib/memory/memory-records.ts#L23)

### U. Launch settles a draft another computer is still sending

- Status: fixed `74cae8d5c`
- Where: [drafts/send.ts:72](/packages/workspace/src/lib/drafts/send.ts#L72)
- What: a draft marked `sending` whose message has not synced in yet reads as a send that never landed, so it is rewritten as the person's draft again, and once the other computer's message arrives it is sent twice or left behind. Telling them apart needs the sending computer in the draft.

### V. A project folder that syncs in before its id file gets an id of its own

- Status: fixed `35a3dc784`
- Where: [projects.ts:288](/packages/workspace/src/lib/chat/projects.ts#L288)
- What: with no `.instrument-project` yet, the folder takes the id its name gives and writes that id file, which then meets the real one from the other computer as a sync conflict. A new project's id is the one its name gives, so this bites only a project renamed or copied on the other computer.

### W. New values in existing enums of stored data parts

- Status: not a defect for the data parts; the rule is narrowed to say so
- Where: [message-data-part.ts](/packages/workspace/src/schemas/session/message-data-part.ts), [ask.ts:240](/packages/workspace/src/schemas/ask.ts#L240)
- What: `closedTabs.reason` gained `chat` and `movedOut`, `chatChanges.field` `unread`, `pageTakeover.stage` `closed` and `continued`, the permission parts `admin`, and `permissionAnswer.answer` `ran-by-hand` and `without-admin`. `CLAUDE.md` forbids a value added to an existing enum. 2.0.11 and the 2.1 betas read the same records, but a data part whose payload fails its schema reads as `data-unknown` there (`coerceDataPart`), as a new part type does, so the data parts lose nothing. The one line an older build drops is a permission `ask` record with `on: admin`, an ask only its own computer acts on.

### X. A home-rooted Files tab is a different tab in main than in the window

- Status: fixed `250175bd2`
- Where: [window-href.ts:438](/apps/studio/src/client/components/window/window-href.ts#L438), [tab-service.ts:79](/apps/studio/src/electron-main/stores/workspace/tab-service.ts#L79)

### Y. Files hands `.hta`, `.url`, `.fileloc` and others to the system

- Status: fixed `9952cc2a5`
- Where: [get-file-type.ts:524](/apps/studio/src/client/lib/get-file-type.ts#L524)
- Note: the threat model does not protect this; the list costs nothing.

### Z. `workspace.json` drops fields a newer build wrote

- Status: fixed `faf899fa1`
- Where: [workspaces.ts:116](/apps/studio/src/electron-main/lib/workspaces.ts#L116)

### AA. A deleted chat's id goes out in report events

- Status: fixed `e5a4a4d36`
- Where: [report-redaction.ts:196](/apps/studio/src/electron-main/lib/report-redaction.ts#L196)

### AB. An Office part inflates without limit

- Status: fixed `eed7ab745`
- Where: [office/zip.ts:110](/packages/workspace/src/lib/office/zip.ts#L110)

### AC. Windows programs run by bare name from main and the workspace server

- Status: fixed `4081e7570` (`reg`, `msiexec`, `taskkill`), `8f17f7943` (`powershell`, `cmd`, `tasklist`, `attrib`, `wevtutil`, and the elevated PowerShell `Start-Process` starts)
- Where: [run-as-admin.ts:202](/packages/workspace/src/lib/permissions/run-as-admin.ts#L202), [resolve-win32.ts:57](/apps/studio/src/electron-main/lib/file-open-target/resolve-win32.ts#L57), [windows-drives.ts:136](/apps/studio/src/electron-main/lib/windows-drives.ts#L136), [output-folder-icon-windows.ts:53](/apps/studio/src/electron-main/lib/output-folder-icon-windows.ts#L53), [system-sidebar.ts:37](/apps/studio/src/electron-main/lib/system-sidebar.ts#L37), [update-signature.ts:278](/apps/studio/src/electron-main/lib/update-signature.ts#L278), [app-in-front.ts:70](/apps/studio/src/electron-main/windows/app-in-front.ts#L70), [update-bridge.ts:472](/apps/studio/src/electron-main/lib/update-bridge.ts#L472)
- What: Windows looks a bare name up in the working folder and then the PATH, where a folder a chat may write can come first.

### AD. `window sites` is still offered while chats may not see history

- Status: fixed `120e22b8c`
- Where: [capabilities/window.ts:1750](/packages/workspace/src/lib/capabilities/window.ts#L1750)

### AE. A draft written while its file cannot be read loses another build's front matter

- Status: declined
- Where: [draft-folder.ts:264](/packages/workspace/src/lib/drafts/draft-folder.ts#L264)
- Declined because: refusing the write on a read error would lose the person's unsent text, which is worth more than a key another build left.

### AF. Loose files in a top-level `Chats/` are moved into `Files/`

- Status: not a defect
- Where: [move-chat-folders-to-files.ts:111](/packages/workspace/src/lib/chats-folder/move-chat-folders-to-files.ts#L111)
- What: they are moved, never deleted, and only once a folder there is surely a chat's.

### AG. The `appsFolder` key is dropped from settings

- Status: not a defect
- What: only 2.0.9 wrote it; 2.0.10 and later do not read it.

### AH. Smaller ones

- Status: open
- What: IPC handlers for drafts, bookmarks and kept state do not check the sender's frame; the steps window passes its action undecoded ([steps-window.ts:112](/apps/studio/src/electron-main/windows/steps-window.ts#L112)); an extension download started after 30 s or with no `webContents` is not held ([extension-download-calls.ts:203](/apps/studio/src/electron-main/browser-view/extension-download-calls.ts#L203)); `stepVisit` mints a tab id inside a shared tab op ([tab-history.ts:138](/apps/studio/src/client/components/window/tab-history.ts#L138)); `@agent-browser/cli-*` is waived from the release-age gate for every version ([pnpm-workspace.yaml:57](/pnpm-workspace.yaml#L57)).

## Not covered

Nothing was run in the app, on Windows or on Linux. The renderer was read only where it feeds main (tab ops, Files' hand-off); the AI gateway, the evals and the release workflows were not read.
