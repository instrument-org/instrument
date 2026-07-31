# A dependency's tool auto-detection froze the app on Windows

`@parcel/watcher` picks its backend automatically when `subscribe` is not given one, and it prefers Watchman. On Windows it looks for Watchman by running `watchman get-sockname` through `cmd.exe`. On a machine without Watchman installed that probe opens a console window and takes about six seconds to fail before falling back to the OS-native backend.

That runs on the thread that owns the app window. Studio subscribed twice on the launch path, so the app froze for roughly twelve seconds with two console windows flashing behind it, and Windows painted "Not Responding" over a build that was still starting. macOS and Linux were unaffected: their probe is cheap and opens nothing.

The fix is `backend: NATIVE_WATCHER_BACKEND` on every `subscribe`. `task-file-watcher` had always passed it; `workspace-skill-watcher` did not, and the skill watcher is the one on the launch path. Both now take the pin from `native-watcher-backend.ts`, whose `NativeWatcherApi` makes `backend` a required option so a third watcher cannot reach the auto-detection path without a type error.

## What made this expensive to find

The console windows were the diagnostic signal and they were read as cosmetic. Three hypotheses were investigated and discarded first, all of them real unguarded process spawns that were simply not this bug: the PowerShell file-open resolver, `electron-updater`'s Authenticode verification, and the `data-gitCommit` load-time migration through dugite. Each was reached by reading the code for something that looked expensive, which is a method that produces plausible answers indefinitely.

Three observations would have cut it short, and are worth reaching for first next time.

**A freeze that shows "Not Responding" is the main process, and it is synchronous.** Electron's main process owns the native window's message loop. That single fact excludes every async candidate, which was most of what got investigated.

**"Works in dev, fails in the packaged build" usually is not about packaging.** Dev uses a separate `userData` directory, so it is a different workspace with different data on disk. Rule out the data difference before reasoning about `app.isPackaged`.

**The freeze survived with only the new-tab screen open.** That excluded everything task-scoped and should have narrowed the search to the launch path immediately.

## The general shape

A dependency that auto-detects an optional tool by shelling out is a main-thread hazard on Windows, where process creation is expensive and console subsystem programs get a window. The cost is invisible on the maintainer's machine if the tool is installed, and invisible on macOS regardless. When a library offers an explicit choice instead of detection, take it, and make the option required at the type level rather than documented, because the failure only appears on one platform and only for users who lack the tool.

Boot-step timing (`boot-timing.ts`) covers the linear main-process launch sequence, but it would not have caught this one: the skill watcher subscribes from an RPC route the renderer calls after the window opens, not from `bootstrapPrimaryInstance`. The instrument that finds this class unprompted is a main-thread stall watchdog, scoped in [privacy-first-diagnostics-and-feedback.md](../plans/active/privacy-first-diagnostics-and-feedback.md).

## Upstream

parcel-bundler/watcher#155 and #168. Neither is fixed; the pin is the durable answer regardless, since bypassing Watchman is what we want on every platform.
