# A macOS update check un-stages the build it just confirmed

**Status:** resolved in `create-app-updater.ts` (a check downloads only when nothing is staged) and `update.ts` (on macOS a download is reported only once Squirrel.Mac has staged it), with `createAutoUpdaterLogger` in `update.ts`; guidance for anything that calls `autoUpdater.checkForUpdates()`. Recorded 2026-07-31; checked 2026-10-26.

## Symptom

Clicking "Restart to update" quit the app, relaunched it, and left the same update pending: still on the old version, still offering the new one. Clicking a second time worked. Nothing in the log said the install had failed, and no error surfaced in the UI.

## Why it happened

On macOS, electron-updater does not install anything itself. It downloads the zip, stands up a local HTTP proxy server, points Squirrel.Mac at it, and lets Squirrel pull and stage the build in the background. `quitAndInstall()` is only meaningful once Squirrel has finished staging: `MacUpdater` tracks that with an internal `squirrelDownloadedUpdate` flag set by the native updater's own `update-downloaded` event, which lands seconds after the one electron-updater emits to us.

`MacUpdater.updateDownloaded()` runs at the end of **every** download pass, and its first act is `closeServerIfExists()` — tear down the proxy, build a new one, `setFeedURL` at it, and tell Squirrel to start over. Crucially, a download pass runs even when there is nothing to download: `executeDownload` short-circuits on a cached artifact and calls the same `done()` hook. So any check that finds an update restarts Squirrel's staging from zero, whether or not a byte moves.

Two callers did exactly that:

- **The pre-install check.** Verifying the release feed before installing is the right idea, but it went through `autoUpdater.checkForUpdates()` with `autoDownload` on. The feed re-offered the staged build, the download pass re-ran, and the proxy was replaced within a few hundred milliseconds of the `quitAndInstall()` it was meant to protect. Whether the install landed came down to which won the race.
- **The background poll.** With a build staged, the poll runs every 15 minutes and each one re-piped the entire zip to Squirrel, leaving a fresh staging window open for a click to fall into.

The user's log reads as a clean reproduction, one process per boot:

```
11:17:50  Update downloaded: 1.4.3
11:17:50  <hash>.zip requested by Squirrel.Mac, pipe .../Instrument-1.4.3-arm64-mac.zip   <- staging starts
11:17:53  Checking for update                                                             <- pre-install check
11:17:53  Proxy server for native Squirrel.Mac is closed                                   <- staging destroyed
11:18:00  (boot)  ...
11:18:01  Update available: 1.4.3                                                          <- relaunched on the old build
```

The second attempt gave Squirrel about eleven seconds before the same teardown and won.

## The same gap, through a newer build

Gating the check closed the re-download of a staged build, but not a newer build replacing it. With 2.0.0-beta.107 staged by a poll, clicking Install found beta.108 on the pre-install check, downloaded it, and installed on electron-updater's `update-downloaded`. Squirrel began fetching 108 and, in starting, deleted the bundle it had unpacked for 107. `squirrelDownloadedUpdate` was still true from 107, since it is never cleared, so `quitAndInstall()` quit at once instead of parking. The ShipIt process waiting since 107 was staged then ran:

```
16:46:04.307  <hash>.zip requested by Squirrel.Mac, pipe .../Instrument-2.0.0-beta.108-arm64-mac.zip
16:46:04.373  Quitting to install the staged update
16:46:05.309  ShipIt: Update bundle .../update.SUypIYp/Instrument.app no longer exists, aborting update
16:46:05.350  ShipIt: Successfully launched application at file:///Applications/Instrument.app/
```

So the app reports a macOS download to the updater only on Squirrel's own `update-downloaded` (Electron's `autoUpdater`, which `MacUpdater` wraps and anyone can listen to). The updater already waits out a superseding download with a deadline and handles its failure; Squirrel's part is now inside that wait instead of after it.

## Guidance

- **Never re-run the download pass for a build that is already staged.** A check is only allowed to download when there is something to fetch: nothing staged yet, or a version strictly newer than what is on disk. Scope `autoDownload` to the individual check rather than setting it once — electron-updater reads it synchronously inside `doCheckForUpdates`, so setting it around the awaited call is enough — and call `downloadUpdate()` explicitly when a check that was held back does find something newer.
- **"Downloaded" is not "ready to install" on macOS.** electron-updater's `update-downloaded` fires when it has the artifact and the proxy is up; Squirrel has not staged anything yet. Electron's own `autoUpdater` emits `update-downloaded` when Squirrel has, and that is the event that means installable. Never trust `quitAndInstall()` to park on it: `squirrelDownloadedUpdate` is never cleared, so after a first staging it calls straight through whatever Squirrel is doing.
- **A cached artifact still costs a full restage.** `executeDownload` returning early is not a fast path in any sense that matters here; it reaches the same `done()` hook. Cheap-looking checks are not cheap once a build is staged.
- **Keep electron-updater's debug output.** The proxy lifecycle and the native `update-downloaded` event are logged at `debug`, which the production file transport drops, so the one signal that says whether Squirrel ever staged the build was invisible. `createAutoUpdaterLogger` routes them to `info` for this reason; a handful of lines per download buys a diagnosable failure.
- **Builds carrying the bug cannot be fixed from the feed.** The broken code runs in the version being upgraded *from*, so anything released while it is in the field may need a second click to take. That is the argument for shipping the fix quickly rather than for shipping it cleverly.
