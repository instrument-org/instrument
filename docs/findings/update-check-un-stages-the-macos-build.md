# A macOS update check un-stages the build it just confirmed

**Status:** resolved in `create-app-updater.ts` — guidance for anything that calls `autoUpdater.checkForUpdates()`. Recorded 2026-07-31.

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

## Guidance

- **Never re-run the download pass for a build that is already staged.** A check is only allowed to download when there is something to fetch: nothing staged yet, or a version strictly newer than what is on disk. Scope `autoDownload` to the individual check rather than setting it once — electron-updater reads it synchronously inside `doCheckForUpdates`, so setting it around the awaited call is enough — and call `downloadUpdate()` explicitly when a check that was held back does find something newer.
- **"Downloaded" is not "ready to install" on macOS.** Our `update-downloaded` fires when electron-updater has the artifact and the proxy is up; Squirrel has not staged anything yet. Nothing outside `MacUpdater` can observe that flag, so treat the gap as real and never do anything that disturbs the proxy while it might be open. `quitAndInstall()` handles the gap on its own by parking on the native event, but only if the server it is streaming from stays up.
- **A cached artifact still costs a full restage.** `executeDownload` returning early is not a fast path in any sense that matters here; it reaches the same `done()` hook. Cheap-looking checks are not cheap once a build is staged.
- **Keep electron-updater's debug output.** The proxy lifecycle and the native `update-downloaded` event are logged at `debug`, which the production file transport drops, so the one signal that says whether Squirrel ever staged the build was invisible. `createAutoUpdaterLogger` routes them to `info` for this reason; a handful of lines per download buys a diagnosable failure.
- **Builds carrying the bug cannot be fixed from the feed.** The broken code runs in the version being upgraded *from*, so anything released while it is in the field may need a second click to take. That is the argument for shipping the fix quickly rather than for shipping it cleverly.
