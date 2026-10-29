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
- `executeDownload` short-circuits to the cached artifact and re-emits `update-downloaded` for it. On macOS that re-stages the same build with Squirrel, which is why a check is no longer allowed to download what is already staged (see [What a check may download](#what-a-check-may-download)).

## Installing

`quitAndInstall` never installs blind, and never runs twice. The whole request is latched behind a single shared promise before its first `await`, so the toolbar badge and the Settings button cannot start two feed checks, two quit prompts, and two installers. The latch is held after a successful install (the app is quitting) and released on every other outcome.

It runs a bounded pre-install check against the feed (`VERIFY_TIMEOUT_MS`), then `resolveInstallDecision` picks:

| Decision         | When                                                                                   | Result                                             |
| ---------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `defer`          | the feed advertises, or a download is in flight for, a build newer than the staged one | wait for that download, then re-decide (see below) |
| `install`        | staged build is newer than the running app and nothing newer exists                    | confirm quit, then install                         |
| `stale-staged`   | staged build is at or below the running app                                            | discard it; installing would be a downgrade        |
| `nothing-staged` | no artifact and nothing newer on offer                                                 | error status                                       |

`defer` is checked first, because a superseding download has already destroyed the staged artifact: "1.6.0 is on the way" is the truthful answer where "nothing is staged" would be technically true but useless.

The check runs **before** the running-agents quit prompt, so discovering a superseded build never costs the user a dialog for an install that then does not happen. An unreachable feed returns no opinion rather than blocking: a user offline with a downloaded update can still install it, while `pendingNewer` still defers if a newer download was already known.

Two ordering details that are easy to undo by accident:

- An install failure is published while `installing` is still latched, then the latch clears. Otherwise `resolveStatus` would fold the error back into "update ready" and the user would never see it.
- `BaseUpdater.install()` catches a missing installer or a failed launch, emits `error`, and returns normally rather than throwing, so a `try`/`catch` around it sees nothing. The `failed` handler clearing `phase.installing` is the only signal that the install did not take, and the request checks it before reporting success — otherwise the single-flight latch would be held forever and no retry would ever run.

The decision is also re-run from local state after the quit confirmation. That dialog is something the user can sit on, and the pre-install check is raced against a timeout rather than cancelled, so the release it was fetching can still land while the dialog is open and take the chosen artifact with it. A deferral at that point is reported rather than waited out: the user has already agreed to quit, and holding a confirmed quit open for minutes is worse than asking for a second click.

### Restarting, and saying whether it landed

From the press on, the toolbar pill and Settings show "Restarting" with a spinner (`use-install-update.ts`), over the pre-install check's own status, so a click never flashes "Checking" first; a superseding download still shows as itself. Once the install is decided, `farewell` holds that for `RESTART_HOLD_MS` and fades the windows out before the quit (`update.ts`), so the app does not vanish mid-click. Linux has no window opacity and only holds. Every path that abandons the install brings the windows back, and a timer does too should the quit never come.

Right before quitting, the adapter records the version it is installing (`installRequested` in the machine state). The next launch compares it with the version running (`launchOutcome` in `update-status.ts`): an update that landed toasts "updated to" with the release notes when the person asked for it, and stays a dot on the bell when it landed on an ordinary quit; an install that came back on the older version says it didn't install. That is the only place a failure after the quit can surface, since the process that asked is gone by then: ShipIt finding no bundle, an installer that refused, a declined authentication prompt on Linux.

### Waiting out a superseding download

A `defer` before the quit prompt does not end the request. Being superseded is a race the user never asked to manage: the replacement is already downloading, so the request parks on that download for up to `SUPERSEDING_DOWNLOAD_WAIT_MS` and installs whatever lands. On a fast connection this is invisible: the badge shows progress for a few seconds and the app restarts, which is what clicking install asked for. Only a download that outlasts the deadline falls back to reporting the deferral and waiting for a second click.

The wait re-checks the feed each round rather than trusting local state, because `AppUpdater.downloadUpdate` returns the in-flight promise instead of starting a second download. A release discovered while a download is running is therefore never fetched, and the build that lands can already be superseded; re-verifying notices that and starts the download the earlier check declined to.

It is bounded twice over, and both bounds are load-bearing. The deadline covers a download that stalls. Requiring a strictly newer target each round covers one that keeps failing and being re-offered at the same version. Without it, a fast-failing download and a reachable feed would spin.

The wait sits **before** the running-agents quit prompt, so nothing restarts underneath a running agent and a long wait never spends a dialog on an install that has not been decided. Every terminal download event wakes the waiters, not just success, so a failed or canceled download ends the wait immediately instead of sitting out the deadline.

The waiter reports _why_ it woke, and that reason cannot be recovered afterwards: `failed` clears `pendingNewer`, so once the wait resumes nothing distinguishes a download that died from one that was never in flight. It matters because the round's re-check can be as offline as the download was, leaving no staged and no pending version. Deciding from that alone yields `nothing-staged`, which publishes "up to date" over a real failure and strands the user on the one status offering no recourse. Carrying the reason through means the request republishes the download error and returns `failed` instead.

### When the newer download fails

Nothing is installable, and the UI says so. The old artifact was deleted when the newer download started, so there is no fallback to offer — a retry keeps chasing the newer build rather than running an installer that is no longer on disk. On macOS the previous build survives in Squirrel's own staging directory only until electron-updater hands Squirrel the newer zip, so we never advertise it: understating what is available is safe, overstating it is not.

## Restarting while the app is not in use

On macOS and Windows a staged update also installs without anyone pressing anything: the app restarts itself once the person has stepped away. The rules are the same on every channel. [`idle-restart-policy.ts`](../../apps/studio/src/electron-main/lib/idle-restart-policy.ts) decides when, as a pure function of the facts and of since when each has held, with every timing in `IDLE_RESTART`; [`idle-restart.ts`](../../apps/studio/src/electron-main/lib/idle-restart.ts) reads those facts every 30 seconds and acts on the answer. There is no setting for it.

Nothing restarts while any of these holds:

- no update is staged and installable, or the updater is busy with it: a check in flight, a newer build downloading, an install already requested, or Squirrel.Mac still unpacking (`isStagedUpdateInstallable`);
- two automatic attempts at this update from this running version have already been made;
- the app restarted on its own less than an hour ago, whatever the reason, which keeps a fault that restarts without the version changing from doing it over and over;
- an agent is mid-turn, a job is running, or someone is dictating, which is everything the quit prompt would ask about; or, on Windows, an app is using the microphone or the camera, which its consent store says (`capture-in-use.ts`). macOS gives no cheap way to ask, so there that check is skipped. A check that fails or takes longer than 10 seconds reads as busy, where a quit the person asked for goes ahead;
- a window has focus while the screen is unlocked, or a window is full screen. A locked screen hides a focused window as well, so the lock restarts the app even when it was in front.

With none of that in the way, the first of these restarts the app, unseen:

1. the screen has been locked for a minute (`powerMonitor`'s `lock-screen` and `unlock-screen`, believed only while `getSystemIdleState` also says locked, which is also how a lock this process started under is noticed);
2. no window has been showing (closed, hidden or minimized) for 5 minutes;
3. the computer has had no input for 15 minutes.

The backstop is the one restart the person may see. When an update has waited 3 days (counted from the first build staged in this process, so a stream of releases does not keep resetting it) with none of those happening, the app restarts once nothing has been in the way for 10 minutes straight, a window included: one in view behind another app, with nothing running.

The restart is the same request as a click on the update button, in its automatic mode (`quitAndInstall({ type: "automatic", confirm })`): the same single-flight latch, pre-install check and wait for a superseding download, so a newer build found or landing at the last moment is waited for and installed instead, in one restart. The mode changes three things. The pre-install check publishes no "Checking" status and a stale build no "up to date", so nothing shows until the install is decided. The quit prompt is replaced by `confirm`, which reads every fact again, the lock included, and calls the restart off if anything changed; if nothing did, it approves the quit without a prompt (`approveQuitQuietly`, the quit machine's `approvalGranted`) and records the attempt. And on Windows the install runs silently and relaunches (Velopack applies every install that way; the NSIS install moving to it runs its Setup silently). From `confirm` on, "Restarting" and the fade show as they do for a click.

Linux is left out: the deb, rpm and pacman installs ask for a password, and the AppImage install moves the image the relaunch would start from.

### What the person is told

The Update pill and its card stay the way to install sooner. Where the update installs by itself, the card says so in a muted line over its buttons (`updates.installsUnattended`); a Linux package's card keeps its password line instead. While an update is ready, the app menu's Check for Updates… reads Restart to Update and installs it as the pill does. A download the app started on its own shows no pill; one the person started (Settings, the menus) shows its progress, as Settings always does.

The restart records no `installRequested`, so the next launch treats a landed update as one an ordinary quit applied: a dot on the bell, no toast. The bell keeps one updated notice, and a newer update that replaces one still unread counts from the version that one counted from, so several updates in a row read as one change since the last notes the person saw (`updatedSince` in `notices.ts`). Only the backstop, which the person may have watched, toasts too: "Instrument restarted to finish updating". After the second failed attempt at one update, the bell says it didn't install, as it does for a click.

### Attempts

`automaticRestart.attempts` in the machine state counts attempts at one version from one running version, and `automaticRestart.lastAt` holds when the last restart went. The next launch forgets the attempts when the version changed, since that attempt landed; otherwise they stay, and after two the app stops trying that update until a newer one is staged or the person installs it.

### Coming back as it was left

Right before the quit, the attempt also records how the app window was left (in front, minimized, or hidden, meaning no window or every window hidden) and whether it was the backstop. A launch within 5 minutes of that marker is the restart, and the window comes back the same way without taking focus (`comeBackAsLeft` in `windows/on-screen.ts`): shown inactive, minimized, or held unshown until the Dock icon is clicked. On macOS a window brought back in view comes up one level under normal windows until it is first focused, since `showInactive` alone orders it over the app the person is using. Outside macOS a hidden window comes back minimized, so it can still be found. A failed or withdrawn install forgets the marker.

The tabs (each with its back and forward history), the layout and the drafts are kept state, written on quit, and come back as they are on any launch. A restart loses what lives only in the window: scroll positions, an open menu, dialog or preview, and the live state of pages in the in-app browser, such as what was typed into them. Nothing that needs a quit prompt is running when it happens.

### Exercising it

A development run under the supervisor takes two variables. `IDLE_RESTART_SIMULATE=1` stages a made-up update (999.0.0) at launch and installs it by restarting the same build (`startAgainAfterQuit`), so the whole path, restore included, runs without a signed build. `IDLE_RESTART_FAST=1` turns each minute of the waits into a second, the backstop's 3 days into 30 seconds and the hour between restarts into a minute. A shipping build reads neither; a preview build also reads `IDLE_RESTART_FAST`.

Squirrel.Mac's relaunch can only be seen with two signed builds of one identity. `preview.yml`'s `update_test_version` input packages the preview a second time at that higher version, under the same identity, and a preview launched with `INSTRUMENT_TEST_UPDATE_FEED=<url>` turns its updater on against that feed, which a test serves with the second build's zip and a `latest-mac.yml` for it. Both are test seams: a shipping build never reads the variable, and a release never sets the input.

## Downloaded means staged by Squirrel on macOS

electron-updater's `MacUpdater` hands each completed download to Squirrel immediately (`autoInstallOnAppQuit` defaults to true): it emits `update-downloaded` once the zip is in its cache, then Squirrel fetches it again through a local proxy and unpacks it. Starting that fetch deletes whatever Squirrel unpacked before. `MacUpdater` tracks Squirrel's part with a `squirrelDownloadedUpdate` latch that is never cleared, so after a first staging `quitAndInstall` calls straight through, and a quit before Squirrel finishes leaves ShipIt with no bundle: it relaunches the version that was running ([the finding](../findings/update-check-un-stages-the-macos-build.md)).

So on macOS `update.ts` holds electron-updater's `update-downloaded` back and reports it to the updater on Electron's own `autoUpdater` `update-downloaded`, Squirrel's signal. `staged` therefore means installable on every platform, a superseding download is waited out through Squirrel's part too, under the same deadline, and a Squirrel error reaches the user through electron-updater's `error`. `installStagedUpdate` refuses outright if Squirrel still has a handed-over build in progress, which the gating makes unreachable.

Quitting the app while a newer build is still downloading applies the older Squirrel-staged one if Squirrel has not been handed the newer zip yet, and nothing if it has. Both are self-healing (the next launch finds and downloads the newer build again).

Windows and Linux have no equivalent survival: `pending/` is already empty by then, so an on-quit install in that window fails harmlessly instead of installing something stale.

## What a check may download

A check downloads only when there is something to fetch: nothing staged yet, or a build strictly newer than the one already on disk. Where a check was held back and does find something newer, `runCheck` starts that download explicitly, so `defer` still has something to wait on.

This is not an optimization. `MacUpdater.updateDownloaded` runs at the end of every download pass, cached artifact or not, and it opens by tearing down the proxy server Squirrel is streaming the staged build from; it then points Squirrel at a replacement and restarts staging from zero. A check that re-offered the staged build therefore un-staged it, and a `quitAndInstall` landing in that window quit and relaunched the running version with the update still pending. The pre-install check made that near-certain by firing milliseconds before the install, and the staged poll reopened the same window every 15 minutes. See [the finding](../findings/update-check-un-stages-the-macos-build.md).

`autoDownload` is scoped to the individual check rather than set once, because electron-updater reads it synchronously inside `doCheckForUpdates` — so setting it around the awaited call is enough, and no other check inherits it.

## Polling

`pollForUpdates` reschedules itself rather than using a fixed interval: `POLL_INTERVAL_MS` normally, `STAGED_POLL_INTERVAL_MS` while an update is waiting to be installed, since that is exactly the window where a new release would otherwise go unnoticed for an hour and the user would be offered yesterday's build. The timer is also re-armed when a build becomes staged, because a check resolves when the _check_ completes — the poll that found a build schedules its successor before the download finishes, so without re-arming the tighter interval would almost never apply. Polling pauses while installing and resumes if the install fails.

Two things bring a poll forward. A check that fails waits `FAILED_POLL_RETRY_MS` rather than the full interval: the usual cause is a network that dropped or was still coming up, and a sleeping Mac runs its timers during the brief maintenance wakes it makes, when Wi-Fi is flapping, so a laptop left closed overnight can see every hourly check fail with `ERR_NETWORK_CHANGED`. And `powerMonitor`'s `resume` reschedules the next poll to `WAKE_CHECK_DELAY_MS` after a real wake, so opening the lid finds a release that landed while it was asleep within seconds rather than up to an hour later. Wakes are spread across users by when they open their computers, so the feed sees no burst from it.

## Owning the download promise

electron-updater returns the auto-download promise on the check result and attaches no rejection handler of its own. Left alone, every failed download becomes an unhandled rejection in the main process — reported as a crash, and fatal under Node's default rejection mode. `runCheck` takes ownership of it; the `error` event has already reported the failure by then.

## Channels

The feed URL is re-applied before every check, so a release-channel change in preferences takes effect without a restart. The channel is passed through `setFeedURL` options rather than `autoUpdater.channel`; the latter's setter flips `allowDowngrade` to `true` as a side effect, which would let the feed hand back an older build. macOS on Intel is pinned to `latest-x64`, the channel its release leg publishes to so its manifest does not overwrite the arm64 one; that is why Intel gets no betas. electron-updater itself can serve both from one manifest ([intel-mac-update-feed.md](../plans/active/intel-mac-update-feed.md)).

## Windows: Velopack

On Windows the port is Velopack's `UpdateManager` ([`update-velopack.ts`](../../apps/studio/src/electron-main/lib/update-velopack.ts)), not electron-updater; everything above it, the install decision, the superseding wait, the automatic restart and the UI, is the same code. The app runs from `%LOCALAPPDATA%\Instrument\current\`, with Velopack's `Update.exe` and a launcher stub beside that folder, and `velopackRoot()` tells such an install by that layout. The feed is the bucket's `velopack/`, read on the release channel, or with none chosen, a prerelease's own channel and otherwise `latest`, as electron-updater picks one for the NSIS install.

A check finds the newest release on the channel and downloads it, as a delta from the installed version where the feed has one, which Velopack rebuilds into the full package while the app runs. Before the download is reported, every executable in that package (`.exe`, `.dll`, `.node`, and the `Squirrel.exe` Velopack ships as the next `Update.exe`) is unpacked to a temporary folder and has to carry a valid Authenticode signature from Finalpoint ([`update-signature.ts`](../../apps/studio/src/electron-main/lib/update-signature.ts)): Windows' own verdict on the chain, by `Get-AuthenticodeSignature`, and a signer whose common name, and organization where it names one, is a publisher name, with case folded. The certificate has been issued as both "Finalpoint, LLC" and "FINALPOINT, LLC", so a case-sensitive comparison would break on the next reissue, and a thumbprint would break on any renewal. Chromium's DirectX shader compilers ship with Microsoft's signature, which signing them again would replace, so the files named in `MICROSOFT_SIGNED_FILES` pass when signed under the organization Microsoft Corporation; a Microsoft-signed file anywhere else is refused, and the release's own run of the check fails until it is named there. The app itself and Velopack's updater have to be Finalpoint's. The check reads the package's executables (about 170) in about 18 s, while the app runs. A package that fails is deleted and its failure is the update's error. Velopack's download also puts the package's own updater in place of `Update.exe` the moment the package is on disk, before anything has checked it, and the launcher stub runs `Update.exe` at every start; so the port keeps the one there aside, puts it back as soon as the download returns, and installs the package's only once the package checks out. Velopack checks only the package's hash against the feed, which whoever serves the feed also writes, so this is the check that ties an update to the publisher, as electron-updater's publisher check does for the NSIS installer. Velopack's own apply-at-launch is off (`setAutoApplyOnStartup(false)`), so a package nothing has checked is never applied.

Installing quits, and Velopack's `Update.exe` unpacks the package, swaps it in for `current\` and starts the new version, silently. An ordinary quit with a checked package waiting does the same without the restart, as electron-updater's install on quit does. Both are started from the app's `quit` event, which comes after the quit's teardown, so a quit that is withdrawn never starts one and nothing is cut short: `Update.exe` is refused a handle to Electron's main process ("Access is denied" in Velopack's log), so it does not wait for the exit and stops whatever is left of the app before the swap. A package changed on disk since its check (by size and last write) is refused at install with `StagedUpdateRejectedError`. A file in `current\` that another program holds open without delete sharing makes the swap fail after ten tries; Velopack restarts the version that was running, and the next launch says the update didn't install. Velopack unpacks after the app exits, so the restart takes about 12 s from the click to the new window on a desktop, against NSIS's 30, of which about 2.6 s is the app's own quit and most of the rest unpacking; the measurements, and a proposal to unpack before quitting, are in the change that moved Windows to Velopack.

Velopack runs the app itself for its install, update and uninstall hooks. `boot.ts` answers them before anything of the app loads ([`velopack.ts`](../../apps/studio/src/electron-main/lib/velopack.ts)): a shipping build puts itself in Explorer's Open With for every type it shows, writing the keys electron-builder's NSIS hooks wrote, and takes them out on uninstall (`windows-open-with.ts`). Uninstalling also removes the app's link protocol, which every launch registers. A preview claims no types, as its NSIS installer never did.

### Moving from the NSIS install

A build running from the NSIS install offers the move as its update ([`update-bridge.ts`](../../apps/studio/src/electron-main/lib/update-bridge.ts)). It reads the Velopack feed for the newest release no older than the running one, downloads the channel's Setup, and checks its signature the same way. Installing it, through the button or the automatic restart, and an ordinary quit with it ready alike, runs a script once the app has exited: the Setup silently; then, only when that left the app installed, the NSIS uninstaller with `/S`, keeping the desktop and Start menu shortcuts the Setup just made, which NSIS removes by the same names; then electron-updater's cache folders (the one the NSIS install's `app-update.yml` names and this build's), where the NSIS installer left a copy of itself and the app its downloads, several hundred megabytes nothing reads again; then the Velopack copy, when an install asked for a relaunch. A Setup that fails leaves the NSIS install as it was. The Velopack copy's first launch logs what the script did, and puts Open With back, since the NSIS uninstaller took out the keys the Setup had written. Settings and data are under the product name in AppData for both installs and stay where they are.

The updater compares a staged build with the running one and will not install the version it runs, so the move reports the running version as `0.0.0`.

## Linux install path

Linux releases publish three targets (`AppImage`, `deb`, `rpm`), each fed by the same update feed, so the install path is chosen by the package that produced the running installation rather than by the platform. A preview also builds a `tar.gz` for the test hosts, which nothing updates. electron-builder records that as a `package-type` file beside the app resources, holding `deb`, `rpm` or `pacman`; an AppImage build ships no such file. `isDebInstall` reads it, which is the same marker electron-updater consults to pick between its `DebUpdater`, `RpmUpdater`, `PacmanUpdater` and `AppImageUpdater`, so the two never disagree about which package is being replaced.

Everything but the Debian package installs through `autoUpdater.quitAndInstall()`, which reaches whichever of those installers matches, and leaves `autoInstallOnAppQuit` at its default so an ordinary quit applies a staged build too.

The Debian package is the exception, and two constraints shape it. `app.relaunch()` is unusable: it sets `PR_SET_NO_NEW_PRIVS=1` on the child and permanently strips the pkexec privileges later updates authenticate with. And electron-updater must not install from its own quit handler, which runs `dpkg` synchronously as a child of the exiting process: the transaction lands in the app's cgroup, so anything ending the app severs it with the package unpacked and its AppArmor profile removed, and takes the `apt-get install -f` recovery down with the process that would have run it. See [the finding](../findings/deb-update-left-the-package-unconfigured.md).

So the deb, and only the deb, turns `autoInstallOnAppQuit` off and writes a shell script into `userData` instead. The script re-runs itself inside a transient systemd scope to get out of the app's cgroup, waits for the app's pid to exit, runs `dpkg -i … || apt-get install -f -y` under `pkexec`, and relaunches unless an instance came back on its own while it worked. Its output is the only account there will ever be of an install that finishes after the process that asked for it is gone, so it goes to a log file the next start reads and then deletes.

That authentication prompt is also why the `installing` status carries a notice on this path and no other: declining the prompt is the one way an update quietly does not happen.

Every Linux package, the deb, rpm and pacman alike, installs as root through `pkexec`, so the update card and Settings say beforehand that the computer will ask for a password (`installAsksForPassword` in `update.ts`, served as `updates.installAsksForPassword`); an AppImage, macOS and Windows install without asking. A declined prompt on the deb comes back as the next launch's "didn't install" notice, since the script relaunches whatever the install did. On rpm and pacman, electron-updater runs the package manager while the app is still open, so a declined prompt is the install's own failure, which the toolbar's update card says in a toast.

Every Linux install first reads the staged artifact whole and checks its sha512 against the entry the feed published for it this session (`stagedArtifactProblem` in `update.ts`), whether the install is the deb handoff, an explicit `quitAndInstall()`, or electron-updater's own install on quit, which a `quit` handler registered ahead of electron-updater's checks first. electron-updater hashes an artifact it finds from an earlier launch, but of one it downloaded in the same run it checks only that the file exists, and the cache folder is in the home folder, where the agent can write when the person allows it. A package installs as root, and an AppImage replaces the app, so a file replaced there would otherwise run outside every sandbox. An artifact that fails is removed and the install refused with `StagedUpdateRejectedError`; the updater then forgets the staged build, so the next check downloads it again. macOS and Windows check the signature of what they install instead.

## Upstream

The manifest asks for `^6.8.9` and the lockfile currently resolves 6.8.9. 6.8.8 hardened the install path against relative `PATH` entries, path traversal, and environment-variable interception, so staying current on the 6.x line matters more here than in most dependencies.

7.x is in alpha and adds the primitives for the gaps documented above: an `autoInstallEvent: "manual" | "onQuit" | "onNextLaunch"` enum in place of the `autoInstallOnAppQuit` boolean, a guard against the OS killing an installer mid-write during shutdown, and re-validation of the cached installer at launch. Worth revisiting when it ships; it is a breaking API change (`quitAndInstall` takes an options object).

What 7.x does **not** change is any of what [What a check may download](#what-a-check-may-download) guards against. Through 7.0.0-alpha, `updateDownloaded` still opens by closing the proxy server, `executeDownload` still short-circuits a cached artifact into the same hook, and `squirrelDownloadedUpdate` is still never cleared. The gating has to survive the upgrade.
