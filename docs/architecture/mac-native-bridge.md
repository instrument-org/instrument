# Mac native bridge

Studio reaches macOS frameworks Electron does not cover through a bridge in two halves, built from [`apps/studio/native/mac-helper`](../../apps/studio/native/mac-helper) and reached from JavaScript through one front door, [`apps/studio/src/electron-main/lib/mac-native.ts`](../../apps/studio/src/electron-main/lib/mac-native.ts). Neither half exists off macOS, and every caller treats `unsupported` as an ordinary answer.

## The two halves

| | Module (`instrument-mac.node`) | Helper (`instrument-mac`) |
| --- | --- | --- |
| Source | `native/mac-helper/addon/addon.m`, Objective-C over Node-API | `native/mac-helper/Sources/main.swift`, Swift |
| Runs | inside Studio's main process | as a child process, one command per call |
| For | what macOS keys to the app's own bundle: notification permission; and what the file browser asks of every folder it lists: packages, hidden entries, Finder icons | the user's data: Calendar, Reminders, Contacts, and which iCloud Drive app folders the Finder shows |
| Reached by | `mac-native.ts`, and the folder browser's listing ([`chat/finder-entries.ts`](../../packages/workspace/src/lib/chat/finder-entries.ts)) and thumbnails ([`file-thumbnails.ts`](../../apps/studio/src/electron-main/lib/file-thumbnails.ts)) | `mac-native.ts`, the agent's `calendar` and `contacts` commands ([`shell-commands/mac-helper.ts`](../../packages/workspace/src/lib/shell-commands/mac-helper.ts)), and the folder browser's iCloud Drive listing ([`chat/icloud-drive.ts`](../../packages/workspace/src/lib/chat/icloud-drive.ts)) |

Which half a capability belongs in is decided by whose identity macOS checks:

- **The app's own identity** goes in the module. Apple's notification center answers only for an app bundle, about that bundle. A child process has none, and asking from one raises an Objective-C exception that ends the process. The module guards against that, answering `unsupported` outside an app bundle (plain `node`, a test), because the same exception in the main process would take the app down.
- **What is asked too often for a process** also goes in the module, when it reads nothing privacy-guarded: the browser lists a folder every few seconds while it is open, and starting a process per listing would cost more than the answer. Work like this runs on a background queue, since Electron's JS thread is AppKit's main thread.
- **Privacy-guarded data** goes in the helper. macOS attributes a child's request to the app that launched it, so the prompt names Instrument and the grant covers every later call, from a task or from onboarding. A crash there costs one command, not the app.

## Adding a capability

1. **Native side.**
   - In the module: add a block to `FUNCTIONS` in `addon.m`. It receives `done` and calls it once with a dictionary (or `@{@"error": …}`). `answer` runs it off the JS thread and resolves a Promise with the JSON.
   - In the helper: add a `case` to `main.swift` that `emit`s JSON or `fail`s with a sentence.
2. **A typed wrapper in `mac-native.ts`** that parses the JSON with a Zod schema before trusting it.
3. **A route in [`rpc/routes/mac.ts`](../../apps/studio/src/electron-main/rpc/routes/mac.ts)** when a page needs it. For the agent, a command in `packages/workspace` that runs the helper (see `createMacHelperCommand`).

Two Objective-C traps are worth knowing before the first change:

- **Booleans.** `@(a == b)` boxes a number, which JSON carries as `0` or `1`. Write `cond ? @YES : @NO`.
- **Deprecated aliases.** A Swift dictionary literal keyed by an enum traps at run time on a duplicate key, and some status enums keep a deprecated alias with the same value (`EKAuthorizationStatus.authorized` is `.fullAccess`). Map those with a `switch`.

## Building and packaging

`pnpm build:mac-helper` (run by `build:vite`, so every package build includes it) compiles both as universal binaries and puts them in `native/mac-helper/.build/bridge`, which is git-ignored:

- **The helper:** with `swift build`.
- **The module:** with `clang` against the [`node-api-headers`](https://www.npmjs.com/package/node-api-headers) package. Node-API is ABI-stable, so one build loads in any Electron, with no node-gyp and no per-version rebuild.

`mac.extraResources` in [`electron-builder.ts`](../../apps/studio/electron-builder.ts) copies both to `Contents/Resources/bin`. A checkout's `pnpm dev` loads them from the build directory, and runs without them when they have not been built.

The app's Info.plist names the reason for each guarded kind of data (`NSCalendars…`, `NSReminders…`, `NSContactsUsageDescription`). Without one, macOS refuses the access outright rather than asking. The app's and helpers' entitlements claim `com.apple.security.personal-information.calendars` and `…addressbook`, which the hardened runtime requires before EventKit or Contacts answers.

## Testing

What runs where:

- **Anywhere:** the helper runs from a terminal, but macOS then asks on the terminal's behalf, not Instrument's.
- **The dev Electron:** loads the module, but answers as Electron's own bundle.
- **Only a packaged build launched through Launch Services** shows the real behavior: prompts naming Instrument, and grants that survive a relaunch. An app started from a terminal makes the terminal the responsible app.
- **Only a Developer ID signed build** shows notifications at all; Electron declines to show one from an unsigned app.
