# Windows updater: the move to Velopack

Reviewed: `6aa612c73..0cca439f7`, limited to the Windows updater commits: `93b0efd93`, `33c039676`, `4fb7a20c1`, `23dadb3f8`, `1bd5c6cdf`, `3f6e98380`, `4d7c6e304`, `c037dd976`, `b301f8842`, `226a14843`, `5833ab93b`, `e6122dea8`, `6732763b8` (13 commits, about 1,900 lines added in `apps/studio`, the release workflows and `packages/shared`)

Asked for: a review covering only the recent Windows updater changes. Read at the head: `update-velopack.ts`, `update-bridge.ts`, `update-signature.ts`, `velopack.ts`, the Windows half of `update.ts`, `scripts/velopack-pack.ts`, the release and preview workflow changes, the idle-restart change, and the Windows section of `docs/architecture/auto-updater.md`. Velopack's own download, apply and Setup code (`velopack/velopack`, default branch, since no release commit matched 1.2.161) and electron-builder 26.15.7's NSIS uninstaller template were read to check what this code assumes about them. Calibrated by `REVIEW.md` and `docs/architecture/threat-model.md`. None of these commits fall in an earlier review's range. One reader, not blind: the reviewer who wrote this file read the code and verified each finding against the commit trailers and `docs/decisions/`. No finding reverses a record there.

Overall: the updater port is careful work. The `UpdaterPort` seam holds, so the install decision, the superseding wait and the automatic restart run unchanged over Velopack. The signature rule is shared between the app and the release (`judgeUpdatePackage`), so a badly signed release fails in CI instead of stranding installs. The `Update.exe` swap-back closes a real Velopack gap, and the commit trailers record what was tried on the Windows test host. The serious problem is not in the updater itself. It comes from where Velopack installs: the app moved out of the one `AppData` folder the sandbox rules held read-only.

## Findings

### A. The Velopack install folder can be written by the agent once App files is allowed, and the app runs from it outside every sandbox

- Status: fixed in `c1b5d2b5e`. Checked through the workspace's rules on the Windows test host: writes to the install root, `current\` and `packages\` were allowed before the fix and refused after; reads of `current\` stay allowed.
- Where: [velopack.ts:22](/apps/studio/src/electron-main/lib/velopack.ts#L22), [places.ts:231](/packages/workspace/src/lib/permissions/places.ts#L231), [places.ts:241](/packages/workspace/src/lib/permissions/places.ts#L241), [workspace-fs-layout.ts:912](/packages/workspace/src/lib/workspace-fs-layout.ts#L912), [workspace-fs-layout.ts:968](/packages/workspace/src/lib/workspace-fs-layout.ts#L968), [mxc.ts:435](/packages/workspace/src/lib/native-sandbox/mxc.ts#L435)
- What: The NSIS install lived in `%LOCALAPPDATA%\Programs\Instrument`. `windowsProgramFolders` gives every chat a system `readOnly` rule over that folder, and it outranks a person's allow on `AppData`. Velopack installs into `%LOCALAPPDATA%\Instrument\` (`APP_VELOPACK_ID`), and no system rule names that folder: `appUpdateCaches` returns nothing on win32, and the `appData` list at `workspace-fs-layout.ts:913-920` covers userData, the machine folder, the runtime and the workspace data only. MXC adds a read entry for `dirname(execPath)` and `resourcesPath`, so `current\` stays read-only to sandboxed programs. Nothing protects the rest of the root. So once a person allows App files (a place that asks first), or turns on using folders without asking, a chat can write three things in that root:
  - `Update.exe` and the launcher stub `Instrument.exe`. The Start menu and desktop shortcuts start the stub, and the stub runs `Update.exe` on every launch, with no sandbox.
  - `packages\`. Velopack's `download_updates` returns early when the target `.nupkg` already exists, with no checksum check, and the port then checks only PE signatures. A crafted package with the real signed executables and a changed `app.asar.unpacked` would pass and be applied at quit.
  - `current\` through the in-process file tools. `layoutRules` has no rule for it, and the MXC read entry applies only to programs the agent runs, not to `write_file`.

  This breaks threat-model line 3: no code the app runs outside the sandbox comes from a place the agent can write. It was introduced in this range, since the NSIS location was covered.
- Verification: traced statically, rules and MXC policy read at the head. Not run on the Windows test host.
- Fix: in `places.ts`, add the Velopack root to the win32 folders that get a system `readOnly` rule (`path.join(home, "AppData", "Local", APP_VELOPACK_ID)`), and close its `packages\` the way `appUpdateCaches` closes electron-updater's folder on the other systems. The agent's `node` and the bundled tools still read and run from `current\`. That is about ten lines plus a case in the existing places test. `isOurProgram` and `mxcAppFolders` need no change.

### B. Moving from NSIS likely loses or breaks a taskbar pin

- Status: won't fix. There are essentially no NSIS 2.0 Windows installs to move, so a pin lost on the one-time move from NSIS to Velopack doesn't matter. Pins across Velopack updates are a separate question: Velopack updates the shortcuts in the taskbar's pinned folder in place.
- Where: [update-bridge.ts:358](/apps/studio/src/electron-main/lib/update-bridge.ts#L358), [update-bridge.ts:393](/apps/studio/src/electron-main/lib/update-bridge.ts#L393)
- What: The script runs the NSIS uninstaller with `/S` alone. electron-builder's `uninstaller.nsh` then runs `WinShell::UninstAppUserModelId "${APP_ID}"` and `WinShell::UninstShortcut` on the desktop and Start menu links. Those links are now the ones Velopack's Setup just wrote, and they carry the same AUMID (`--aumid APP_BUNDLE_ID`). Copying the `.lnk` files aside brings the files back, but it does not undo the shell side: the unpin and the cleared jump list. A pin that survives instead points at the deleted NSIS `Instrument.exe`. Velopack's Setup creates only Desktop and StartMenuRoot shortcuts and never pins. So someone who pinned Instrument to the taskbar, which is common on Windows, ends up with no pin or a dead one, and nothing in the move or in the Velopack copy's first launch fixes it.
- Verification: traced statically through the uninstaller template; not tried on the Windows test host. The trailers on `93b0efd93` list what was tested on the host, and pins are not among them.
- Fix: pass `--keep-shortcuts` with `/S`. electron-builder's uninstaller has that flag for exactly this case, an install replacing itself, and it skips both WinShell calls and the deletes, so the copy-aside block (`:385-392`, `:407-410`) can go. Then, after the uninstall, retarget any `.lnk` under `%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar` whose target is the NSIS exe to the Velopack stub (`WScript.Shell` `CreateShortcut`, set `TargetPath`, `Save`). That is about 15 lines of the script. Check it on the test host with a pinned NSIS install.

### C. A move that fails is never logged, and it downloads Setup again in every session

- Status: fixed in `849be6150`. The move script writes a failure marker, and the bridge offers no move for three days after one.
- Where: [update.ts:262](/apps/studio/src/electron-main/lib/update.ts#L262), [update-bridge.ts:380](/apps/studio/src/electron-main/lib/update-bridge.ts#L380), [update-bridge.ts:450](/apps/studio/src/electron-main/lib/update-bridge.ts#L450)
- What: `reportMoveToVelopack` runs only in the `velopackRoot()` branch. When Setup leaves no app (antivirus, a full disk, a Setup that fails every time), the script logs "keeping the NSIS install" and exits, and the NSIS copy never reads that log, so the log file only grows. Nothing records the failure either. The next session's check finds the move again, deletes `velopack-setup/`, downloads the full Setup again, checks it, and runs it at quit, and it fails the same way. The same happens when Setup succeeds but the uninstaller times out because the NSIS exe was started again in the meantime: both installs stay, and the NSIS one keeps offering the move.
- Verification: traced statically.
- Fix: call `reportMoveToVelopack` in the `nsisInstall()` branch too, so the failure reaches the log. Have the script write a marker on the failure path, and have the bridge back off while that marker is recent. That is about 20 lines.

### D. If the app ends at the wrong moment, an unchecked `Update.exe` stays in place

- Status: fixed in `849be6150`.
- Where: [update-velopack.ts:197](/apps/studio/src/electron-main/lib/update-velopack.ts#L197)
- What: Velopack's `download_updates` extracts the package's `Squirrel.exe` over `Update.exe` right after it renames the package into place, then deletes old packages before it returns. The port restores the kept copy in a `finally` after `downloadUpdateAsync` resolves. If the process dies in that window (a crash, Task Manager, logoff), the `finally` never runs. Nothing at startup restores `packages\Update.exe.checked`, so the unchecked updater stays in place, and the launcher runs it on every start. The window is short, and the threat is a feed that serves a package with the right hash and the wrong signer, so this is hardening.
- Verification: traced statically, against Velopack's `manager.rs` `download_updates`.
- Fix: in `createVelopackPort`, copy `Update.exe.checked` back over `Update.exe` at startup whenever it exists. After an adopt, it is the checked copy from the same package, so the copy is always safe. That is about four lines.

### E. The auto-updater doc says the signature check ties an update to the publisher, but it covers only PE files

- Status: fixed in `849be6150`.
- Where: [auto-updater.md:154](/docs/architecture/auto-updater.md#L154), [update-signature.ts:23](/apps/studio/src/electron-main/lib/update-signature.ts#L23), [electron-builder.ts:115](/apps/studio/electron-builder.ts#L115)
- What: The check reads `.exe`, `.dll` and `.node` files. `app.asar` is covered too, indirectly, by the integrity hash embedded in the signed exe. `app.asar.unpacked` is covered by neither, and `electron-builder.ts` says so. That folder includes `node_modules/velopack/lib/index.js` and `load.js`, which `boot.ts` loads into the main process on every Windows launch, before anything else (confirmed in the packaged macOS build's `app.asar.unpacked`, which uses the same smart-unpack). A compromised feed is out of scope in the threat model, so this is a doc claim to correct, not a defect. It matters for A, because A turns a writable `packages\` into a working path.
- Verification: the file list was read from an installed build. The rest was traced statically.
- Fix: reword the sentence to say the check covers the executables and, through the asar integrity hash, `app.asar`, but not `app.asar.unpacked`. Covering that folder too would need a hash manifest signed into the exe, which is not worth it while the feed is out of scope.

## Confirmed tradeoffs

- With no channel set, a Windows build reads `latest`, betas included, so NSIS and Velopack beta installs without the preference get nothing until a stable release ships through Velopack. This matches macOS and Linux, where `setFeedURL` replaces `app-update.yml`'s detected channel (`e6122dea8` `Commits-to:`).
- A missing `releases.<channel>.json` reads as no update rather than a failed check (`hasFeedFile`). Publishing an empty one was rejected in `e6122dea8`.
- The signer is matched by name, CN plus O where present, with case folded, not by thumbprint. Renewals would otherwise strand installs (`93b0efd93` `Rejected:`).
- Microsoft's signature is accepted only on the files in `MICROSOFT_SIGNED_FILES`, at their package path, so a Microsoft-signed file anywhere else fails the release's own check.
- `setAutoApplyOnStartup(false)`, so Velopack never applies a package the port has not checked.
- The size-and-mtime recheck at install guards against accidents, not attackers, as its comment says. It is enough once A is fixed.
- `Setup --silent` doesn't start the app (Velopack `install.rs` starts it only when not silent), so a quiet move on an ordinary quit doesn't open a window the person just closed.
- Update packages are unpacked with `System32\tar.exe` by absolute path (`c037dd976`), and `PSModulePath` is dropped for Windows PowerShell (`4d7c6e304`). Both fix real breakage on hosts where Git's tar or PowerShell 7 come first.
- A locked screen now beats a focused window for the idle restart (`6732763b8`). A full-screen window still blocks it.

## Not covered

The preview workflow's test-feed packaging (`1bd5c6cdf`) was read for shape only. `windows-open-with.ts` was read only where `velopack.ts` calls it.
