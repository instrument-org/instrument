# Computer use

Status: open. Behind the `computer_use` feature flag, on macOS, Windows and Linux.

Computer use is the agent operating the person's other apps: reading what a window shows and pressing, typing and scrolling in it, when no file, command line tool, app in Apps or `agent-browser` can do the job. It rides on [agent-desktop](https://github.com/vercel-labs/agent-desktop) (Apache-2.0), a Rust CLI that reads and acts through each system's accessibility API.

## Shape

- **`instrument computer` is registry capabilities** ([`capabilities/computer.ts`](../../packages/workspace/src/lib/capabilities/computer.ts)), generated like every other `instrument` command. They run on the main thread, since the host's config is live there; the bash worker builds the command only to send the call back.
- **The driver runs per call as a plain child of the main process** ([`lib/computer/driver.ts`](../../packages/workspace/src/lib/computer/driver.ts)), so macOS holds the app responsible for it. There is no daemon, and no second row in System Settings.
- **A chat gets one session of the driver's**, with traces off, since they would keep what windows showed. A session is what the agent's cursor belongs to, and that cursor's process outlives the call that drew it, so quitting ends every session, and the first start after a crash clears away what the last run left.
- **The session is the driver's multi-agent kind, with one agent in it.** The driver's plain `cursor-overlay enable` draws its cursor at once saying "Hey, let's play with this computer!", whatever `--label` says, and a multi-agent `enable` only saves the settings. So the cursor first appears on its first move with our label, and every action names the agent. The driver's other way past the greeting is a cursor image of our own, which means shipping art that Windows samples without smoothing.
- **Studio carries the executable and its helper** in `resources/agent-desktop/`, vendored by [`scripts/download-agent-desktop.ts`](../../apps/studio/scripts/download-agent-desktop.ts) against pinned hashes, and is the host ([`lib/computer-use.ts`](../../apps/studio/src/electron-main/lib/computer-use.ts)). About 4 MB on macOS.
- **The agent reads a tree of text, not the driver's JSON** ([`lib/computer/tree-text.ts`](../../packages/workspace/src/lib/computer/tree-text.ts)): a line per element with its ref. `--json` gives the driver's own answer.

## Permissions are per app

Computer use asks what every other route to an app asks, so there is no second permission scheme ([permissions are folders and apps](../principles/permissions-are-folders-and-apps.md)).

- Every command resolves to one app ([`lib/computer/targets.ts`](../../packages/workspace/src/lib/computer/targets.ts)), known by its bundle id on macOS, its desktop id on Linux where it has one, and its program on Windows, and passes `appLevel`: a chat's grant from an `ask_permission` card, its "Not now", and a rule in Settings › Permissions all hold. A substring of a name never matches. A path is no app, since Linux's driver would start what's there outside the sandbox.
- A command that acts names a ref, not an app. Each ref's snapshot id is remembered with the app it was taken of, and the app is asked again at every action, so a "Not now" stops the next one. A ref from another chat, or one no snapshot gave out, is refused.
- A window named with `--window` has to belong to that app, by its process, or by its program on Windows.
- The agent never drives this app's own windows, whose cards are the person's to answer, or the prompts a system draws to ask the person themselves (`SecurityAgent` and `universalAccessAuthWarn` on macOS, `consent` and `CredentialUIBroker` on Windows, `gnome-shell` and `gcr-prompter` on Linux). No rule opens those.
- Coordinates aren't offered, since a point carries no app. Neither are the clipboard, notifications, desktop-wide screenshots, or `--force`, which is how the driver's own refusal of quitting shortcuts stays on.
- An app whose yes reaches past itself, a terminal, a file manager or a system's settings, says so on its card. A terminal is a shell outside the sandbox, and a person answering about one app should hear that ([the agent works at real paths](../decisions/2026-10-11-the-agent-works-at-real-paths.md)).
- `instrument computer apps` names what's running and this chat's answer for each, so the agent knows what to ask for. Windows and their titles need the app's yes.

## What each grant buys

| macOS grant | Needed for | Setup |
| --- | --- | --- |
| Accessibility | Reading trees and every action | Required. It applies at once, with no relaunch. |
| Screen Recording | `instrument computer screenshot` | Optional. Everything else works without it. macOS offers to quit and reopen the app, but each call is a new process, which has the grant at once, so Later is fine. |

Settings › Computer Use walks through both, reading each through the driver itself, which is the proof that a grant reaches what the agent runs. Screen Recording is asked through the driver as well, since Electron's capture API raises no prompt and lists nothing in the pane. Its first capture raises macOS's own consent to skip the private window picker, which setup brings up while the person is there rather than leaving it for a chat. A capture goes ahead while that consent is still unanswered. Windows and Linux ask for nothing, and the page says so.

## What it leaves the person

Actions go through the accessibility API, so they leave the person's pointer and focus alone, and an element with no such route is refused rather than taking them. The agent's own cursor, a labeled arrow drawn over the screen, shows where it is working. `--headed` takes the real pointer and focus, and a double-click, a hover and a drag need it, as does the first window of an app that shows none until it is brought forward. So the agent stops at apps that draw their own controls until someone says it may take the pointer. A driver with its own background input route (Cua Driver's per-process events) would get further there, at about 30 times the size, with a daemon and a second grant.

## On each system

| | macOS | Windows | Linux, GNOME on Wayland |
| --- | --- | --- | --- |
| Reads through | Accessibility | UI Automation | AT-SPI |
| An app goes by | Bundle id | Program, shown by the end of its window's title | Desktop id, else its program |
| `open` | The driver's launch, in the background | The Start menu, and the new window comes to the front | The driver's launch |
| Setup | Accessibility, and optionally Screen Recording | None | None |
| The agent's cursor | Drawn | Drawn | Not drawn |
| `screenshot` | With Screen Recording | Yes | Refused |
| Hover, double-click, drag | With `--headed` | Not run | Refused |

Windows differs most, because the driver's two inventories disagree there. `list-apps` names `ApplicationFrameHost.exe` in place of every packaged app in it, and `list-windows` names the real program, so apps are read from windows alone. That program is what a yes is asked and kept under, for a running app, because a title moves with the document and any program can put anything there. So a card for one reads `CalculatorApp` or `mspaint`, and a window titled `Budget - Calculator` gets nothing from a yes to Calculator. The end of the title (`Untitled - Notepad`) is only how `apps` shows the app and a way to find it, since a packaged app's program often doesn't say what it is. A file's `FileDescription` is no help: Calculator's is blank and Notepad's is `Notepad.exe`.

The driver's own launch can't serve Windows: it takes only System32 names and absolute paths, and spends its whole timeout on the stubs those lead to, whose real app is another process. `open` reads the Start menu (`Get-StartApps`) and starts the entry through `shell:AppsFolder`, which reaches packaged and classic apps alike. A new window that says it's the app has the person's yes carried to its program; one that doesn't is reported and asks for itself, since it may be something else opening at that moment. File Explorer is refused up front, because the driver won't touch `explorer.exe` and its windows never list.

Some controls have no way in without focus. Windows's Notepad refuses `type`, and `set-value` fills it without taking anything, so the refusal says so.

## Still open

- **Windows beyond the test VM.** It has run on one ARM VM, as the x64 build under emulation. A native x64 machine, a classic app with its own window frame, Electron apps and `--headed` input haven't been run. `--headed` typing garbled text once in that VM.
- **An app the agent built, on macOS.** `open` finds an app through Spotlight and starts it outside the sandbox, so a bundle the agent wrote somewhere indexed, the output folder for one, could be started after a yes to a name that reads like any other. Linux's equivalent is closed for paths, and its `.desktop` folders and `PATH` are read-only to the agent. Checking where the bundle lives before launching would close it. This hasn't been tried on a real Mac.
- **A name that starts a closed program on Linux.** Only the driver knows which program a name starts, so a yes to `Calculator` can start a `gnome-calculator` marked Not allowed. It stays closed to the agent, but it has started.
- **The agent's shell on Windows.** When computer use couldn't reach Calculator, a model went to `explorer.exe`, PowerShell and `taskkill` from its shell, none of which ask. With the app reachable it stopped needing to, and it still tried `explorer.exe` once before reading the help.
- **Identical controls on Windows and Linux** can only be told apart with a headed click.
- **Where it shows.** A flag and a Settings page are enough to try it. A shipped feature would offer setup from onboarding, or at the moment a task needs it.
- **Windows on another Space.** The driver refuses a window that isn't exposed through accessibility, so the command says to bring it up. A minimized window reads fine; another Space hasn't been run.
- **Asking before `--headed`.** The help says to, and a model passed it unasked when `open` said there was no window. A card, or bringing the app forward and handing focus back, would hold where the words don't.
- **Self-signed and ad hoc builds.** A grant follows the signature, so a build whose signature changes asks again.
- **Evals.** [`evals/cases/computer-use.ts`](../../packages/workspace/evals/cases/computer-use.ts) covers finding the command, asking for the one app, and leaving it alone when it isn't needed.
