# Mac native bridge

Studio reaches macOS frameworks Electron does not cover through a bridge in two halves, built from [`apps/studio/native/mac-helper`](../../apps/studio/native/mac-helper) and reached from JavaScript through one front door, [`apps/studio/src/electron-main/lib/mac-native.ts`](../../apps/studio/src/electron-main/lib/mac-native.ts). Neither half exists off macOS, and every caller treats `unsupported` as an ordinary answer.

## The two halves

| | Module (`instrument-mac.node`) | Helper (`instrument-mac`) |
| --- | --- | --- |
| Source | `native/mac-helper/addon/addon.m`, Objective-C over Node-API | `native/mac-helper/Sources/main.swift`, Swift |
| Runs | inside Studio's main process | as a child process, one command per call |
| For | what macOS keys to the app's own bundle: notification permission, and whether the app may control another app; and what the file browser asks of every folder it lists: packages, hidden entries, aliases, Finder icons; and every file the Finder's Copy put on the pasteboard, which Electron reads only the first of; and whether one of macOS's permission prompts is on screen (a window of UserNotificationCenter, named by the window list without the screen recording permission), which is how a look macOS holds is known to be waiting on the person | the user's data: Calendar, Reminders, Contacts, and which iCloud Drive app folders the Finder shows |
| Reached by | `mac-native.ts`, and the folder browser's listing ([`chat/finder-entries.ts`](../../packages/workspace/src/lib/chat/finder-entries.ts)) and thumbnails ([`file-thumbnails.ts`](../../apps/studio/src/electron-main/lib/file-thumbnails.ts)) | `mac-native.ts`, the Calendar, Reminders and Contacts apps' MCP server ([`lib/mac-apps/helper-apps.ts`](../../packages/workspace/src/lib/mac-apps/helper-apps.ts)), and the folder browser's iCloud Drive listing ([`chat/icloud-drive.ts`](../../packages/workspace/src/lib/chat/icloud-drive.ts)) |

Which half a capability belongs in is decided by whose identity macOS checks:

- **The app's own identity** goes in the module. Apple's notification center answers only for an app bundle, about that bundle. A child process has none, and asking from one raises an Objective-C exception that ends the process. The module guards against that, answering `unsupported` outside an app bundle (plain `node`, a test), because the same exception in the main process would take the app down.
- **What is asked too often for a process** also goes in the module, when it reads nothing privacy-guarded: the browser lists a folder every few seconds while it is open, and starting a process per listing would cost more than the answer. Work like this runs on a background queue, since Electron's JS thread is AppKit's main thread.
- **Privacy-guarded data** goes in the helper. macOS attributes a child's request to the app responsible for it, the one at the top of its process tree, so the prompt names Instrument and the grant covers every later call, from a task or from onboarding. A crash there costs one command, not the app.

Mail, Notes and Messages are in neither half: Apple offers no framework for their data, so their apps drive them through AppleScript the app ships, with what the agent passes reaching the script only as its `argv` ([agent-sandbox.md](agent-sandbox.md), the user's other apps).

## The Mac apps' MCP server

The agent reaches all six through one MCP server the app ships, [`lib/mac-apps`](../../packages/workspace/src/lib/mac-apps), built as `out/main/mac-apps-server.js` and started per call like any local MCP app's server, by the manifest's `runtime: bundled` and the server it names (`package: apple-calendar`). The tools are TypeScript with Zod schemas, and wrap the helper's JSON commands and the scripts.

- **Who macOS asks about.** The server runs as Node from the app's own executable (`process.execPath` under `ELECTRON_RUN_AS_NODE`), a plain child of the app's main process, and starts the helper and `osascript` as plain children of its own (`backend.ts`). Nothing on the way disclaims responsibility, so the app stays the responsible process for the whole tree: the EventKit, Contacts and Automation prompts name Instrument, and the grants are Instrument's. A launcher that disclaimed (`responsibility_spawnattrs_setdisclaim`, as some third-party servers ship) would move the prompt and the grant to itself.
- **macOS refusing.** The helper's exit code 2, AppleScript's -1743, or an Apple Event that timed out (-1712, which is what one does while macOS's prompt is up) comes back as an `isError` result naming the app under `_meta["tryinstrument.com/macos-refusal"]` (`refusal.ts`). The `apps.call` capability asks macOS in its gate before the call and reads that key in its run after it (`capabilities/apps.ts`, `lib/apps/mac-app.ts`); either way the chat's macOS card goes up (`macosAppCard`) as the dispatcher's `card` outcome, which records it as a raised ask: `instrument app call` exits 2, a script gets `CardShown`, and the turn ends on the card.
- **Testing without the person's data.** `src/test/helpers/mac-apps-stand-in.ts` is the same server over a stand-in for the helper and the scripts, which the unit tests and the evals (`macApps` on a case) start in its place.

## Adding a capability

1. **Native side.**
   - In the module: add a block to `FUNCTIONS` in `addon.m`. It receives `done` and calls it once with a dictionary (or `@{@"error": …}`). `answer` runs it off the JS thread and resolves a Promise with the JSON.
   - In the helper: add a `case` to `main.swift` that `emit`s JSON or `fail`s with a sentence.
2. **A typed wrapper in `mac-native.ts`** that parses the JSON with a Zod schema before trusting it.
3. **A route in [`rpc/routes/mac.ts`](../../apps/studio/src/electron-main/rpc/routes/mac.ts)** when a page needs it. For the agent, a tool on the Mac app whose data it reads, in `lib/mac-apps` (`defineTool` and `runHelper`), which the app-call path gates as it does the rest of that app's.

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
