# Auto-updater

How Studio finds, stages, and installs a new build. The subtle part is not the download; it is guaranteeing that the build the user is offered and the build that actually installs are the same one, and that it still exists.

Three modules, layered so the hard parts are testable without Electron:

- [`update-status.ts`](../../apps/studio/src/electron-main/lib/update-status.ts) — pure reducers. No I/O, no dependencies beyond `semver`.
- [`create-app-updater.ts`](../../apps/studio/src/electron-main/lib/create-app-updater.ts) — the orchestration, written against a narrow `UpdaterPort` seam rather than electron-updater directly, so the install flow is unit tested against a fake.
- [`update.ts`](../../apps/studio/src/electron-main/lib/update.ts) — production wiring only: builds the port from `electron-updater`, picks the channel, and owns the platform-specific install.

The renderer reads status over RPC via `updates.live.status` and acts through `preferences.quitAndInstall`.

## Two kinds of state

`UpdatePhase` is what the updater can act on. `AppUpdaterStatus` is what the UI renders — it describes the last thing that happened, which is a different question and goes stale the moment a background poll fires.

The invariant that makes the rest simple: **`staged` and `pendingNewer` are never both set.** electron-updater keeps exactly one artifact in its `pending/` cache, and empties that directory as soon as a _different_ version begins downloading. So the moment a newer build supersedes a staged one, the staged artifact is deleted from disk. `staged` is cleared at the same instant, because continuing to advertise it would offer an install that cannot run.

`resolveStatus` maps an incoming status onto the phase: a ready-to-install build is a fact about the disk, so a check that found nothing, failed, was canceled, or re-offered the same version cannot erase it. Only a strictly newer build, or an install, takes the badge away.

That guard exists because of two electron-updater behaviors that are easy to mistake for real events:

- The feed re-advertises the staged version on every poll, so `update-available` fires again for a build that is already downloaded.
- `executeDownload` short-circuits to the cached artifact and re-emits `update-downloaded` for it, on macOS re-staging the same build with Squirrel each time.

## Installing

`quitAndInstall` never installs blind, and never runs twice. The whole request is latched behind a single shared promise before its first `await`, so the toolbar badge and the Settings button cannot start two feed checks, two quit prompts, and two installers. The latch is held after a successful install (the app is quitting) and released on every other outcome.

It runs a bounded pre-install check against the feed (`VERIFY_TIMEOUT_MS`), then `resolveInstallDecision` picks:

| Decision         | When                                                                                   | Result                                                                                |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `defer`          | the feed advertises, or a download is in flight for, a build newer than the staged one | no install; the newer download becomes the status and the badge returns when it lands |
| `install`        | staged build is newer than the running app and nothing newer exists                    | confirm quit, then install                                                            |
| `stale-staged`   | staged build is at or below the running app                                            | discard it; installing would be a downgrade                                           |
| `nothing-staged` | no artifact and nothing newer on offer                                                 | error status                                                                          |

`defer` is checked first, because a superseding download has already destroyed the staged artifact: "1.6.0 is on the way" is the truthful answer where "nothing is staged" would be technically true but useless.

The check runs **before** the running-agents quit prompt, so discovering a superseded build never costs the user a dialog for an install that then does not happen. An unreachable feed returns no opinion rather than blocking: a user offline with a downloaded update can still install it, while `pendingNewer` still defers if a newer download was already known.

Two ordering details that are easy to undo by accident:

- An install failure is published while `installing` is still latched, then the latch clears. Otherwise `resolveStatus` would fold the error back into "update ready" and the user would never see it.
- `BaseUpdater.install()` catches a missing installer or a failed launch, emits `error`, and returns normally rather than throwing, so a `try`/`catch` around it sees nothing. The `failed` handler clearing `phase.installing` is the only signal that the install did not take, and the request checks it before reporting success — otherwise the single-flight latch would be held forever and no retry would ever run.

The decision is also re-run from local state after the quit confirmation. That dialog is something the user can sit on, and the pre-install check is raced against a timeout rather than cancelled, so the release it was fetching can still land while the dialog is open and take the chosen artifact with it.

### When the newer download fails

Nothing is installable, and the UI says so. The old artifact was deleted when the newer download started, so there is no fallback to offer — a retry keeps chasing the newer build rather than running an installer that is no longer on disk. On macOS the previous build does survive in Squirrel's own staging directory and will apply on quit, but we deliberately do not advertise it: understating what is available is safe, overstating it is not.

## Why the staged build can still be behind on macOS

electron-updater's `MacUpdater` hands each completed download to Squirrel immediately (`autoInstallOnAppQuit` defaults to true) and tracks it with a `squirrelDownloadedUpdate` latch that is never cleared. Once Squirrel has staged something, it applies on quit whether or not we asked.

We cannot un-stage it. What we can do is never _offer_ it: the pre-install check means an explicit install always reflects the newest known build. The remaining exposure is quitting the app during the window where a newer build is still downloading, which applies the older Squirrel-staged one. That is self-healing (the next launch immediately finds and downloads the newer build) and it is still an upgrade over what was running, so it is accepted rather than worked around.

Windows and Linux have no equivalent survival: `pending/` is already empty by then, so an on-quit install in that window fails harmlessly instead of installing something stale.

## Polling

`pollForUpdates` reschedules itself rather than using a fixed interval: `POLL_INTERVAL_MS` normally, `STAGED_POLL_INTERVAL_MS` while an update is waiting to be installed, since that is exactly the window where a new release would otherwise go unnoticed for an hour and the user would be offered yesterday's build. The timer is also re-armed when a build becomes staged, because a check resolves when the _check_ completes — the poll that found a build schedules its successor before the download finishes, so without re-arming the tighter interval would almost never apply. Polling pauses while installing and resumes if the install fails.

## Owning the download promise

electron-updater returns the auto-download promise on the check result and attaches no rejection handler of its own. Left alone, every failed download becomes an unhandled rejection in the main process — reported to telemetry as a crash, and fatal under Node's default rejection mode. `runCheck` takes ownership of it; the `error` event has already reported the failure by then.

## Channels

The feed URL is re-applied before every check, so a release-channel change in preferences takes effect without a restart. The channel is passed through `setFeedURL` options rather than `autoUpdater.channel`; the latter's setter flips `allowDowngrade` to `true` as a side effect, which would let the feed hand back an older build. macOS on Intel is pinned to `latest-x64` because electron-builder does not support beta/alpha channels there.

## Linux install path

Linux does not call `autoUpdater.quitAndInstall()`, which hangs there, and cannot use `app.relaunch()`: that sets `PR_SET_NO_NEW_PRIVS=1` on the child and permanently strips the pkexec privileges future updates need. It spawns a detached shell that waits for the process to exit before relaunching. The staged build is applied by electron-updater's own quit handler.

## Upstream

The manifest asks for `^6.8.9` and the lockfile currently resolves 6.8.9. 6.8.8 hardened the install path against relative `PATH` entries, path traversal, and environment-variable interception, so staying current on the 6.x line matters more here than in most dependencies.

7.x is in alpha and adds the primitives for the gaps documented above: an `autoInstallEvent: "manual" | "onQuit" | "onNextLaunch"` enum in place of the `autoInstallOnAppQuit` boolean, a guard against the OS killing an installer mid-write during shutdown, and re-validation of the cached installer at launch. Worth revisiting when it ships; it is a breaking API change (`quitAndInstall` takes an options object).
