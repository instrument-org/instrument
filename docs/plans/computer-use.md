# Computer use

Status: open. Behind the `computer_use` feature flag, on macOS only.

Computer use is the agent operating the person's other apps: reading what a window shows and pressing, typing and scrolling in it, when no file, command line tool, app in Apps or `agent-browser` can do the job. It rides on [agent-desktop](https://github.com/vercel-labs/agent-desktop) (Apache-2.0), a Rust CLI that reads and acts through each system's accessibility API.

## Shape

- **`instrument computer` is registry capabilities** ([`capabilities/computer.ts`](../../packages/workspace/src/lib/capabilities/computer.ts)), generated like every other `instrument` command. They run on the main thread, since the host's config is live there; the bash worker builds the command only to send the call back.
- **The driver runs per call as a plain child of the main process** ([`lib/computer/driver.ts`](../../packages/workspace/src/lib/computer/driver.ts)), so macOS holds the app responsible for it. There is no daemon, and no second row in System Settings.
- **Studio carries the executable and its helper** in `resources/agent-desktop/`, vendored by [`scripts/download-agent-desktop.ts`](../../apps/studio/scripts/download-agent-desktop.ts) against pinned hashes, and is the host ([`lib/computer-use.ts`](../../apps/studio/src/electron-main/lib/computer-use.ts)). About 4 MB on macOS.
- **The agent reads a tree of text, not the driver's JSON** ([`lib/computer/tree-text.ts`](../../packages/workspace/src/lib/computer/tree-text.ts)): a line per element with its ref. `--json` gives the driver's own answer.

## Permissions are per app

Computer use asks what every other route to an app asks, so there is no second permission scheme ([permissions are folders and apps](../principles/permissions-are-folders-and-apps.md)).

- Every command resolves to one app's bundle id ([`lib/computer/targets.ts`](../../packages/workspace/src/lib/computer/targets.ts)) and passes `appLevel`: a chat's grant from an `ask_permission` card, its "Not now", and a rule in Settings › Permissions all hold. A substring of a name never matches.
- A command that acts names a ref, not an app. Each ref's snapshot id is remembered with the app it was taken of, and the app is asked again at every action, so a "Not now" stops the next one. A ref from another chat, or one no snapshot gave out, is refused.
- A window named with `--window` has to belong to that app, by its process.
- The agent never drives this app's own windows, whose cards are the person's to answer, or the prompts macOS draws to ask the person themselves (`SecurityAgent`, `universalAccessAuthWarn`, `UserNotificationCenter`, `loginwindow`). No rule opens those.
- Coordinates aren't offered, since a point carries no app. Neither are the clipboard, notifications, desktop-wide screenshots, or `--force`, which is how the driver's own refusal of quitting shortcuts stays on.
- `instrument computer apps` names what's running and this chat's answer for each, so the agent knows what to ask for. Windows and their titles need the app's yes.

## What each grant buys

| macOS grant | Needed for | Setup |
| --- | --- | --- |
| Accessibility | Reading trees and every action | Required. It applies at once, with no relaunch. |
| Screen Recording | `instrument computer screenshot` | Optional. Everything else works without it. macOS offers to quit and reopen the app, but each call is a new process, which has the grant at once, so Later is fine. |

Settings › Computer Use walks through both, reading each through the driver itself, which is the proof that a grant reaches what the agent runs. Screen Recording is asked through the driver as well, since Electron's capture API raises no prompt and lists nothing in the pane.

## What it leaves the person

Actions go through the accessibility API, so they leave the person's pointer and focus alone, and an element with no such route is refused rather than taking them. `--headed` takes them, and a double-click, a hover and a drag need it. So the agent stops at apps that draw their own controls until someone says it may take the pointer. A driver with its own background input route (Cua Driver's per-process events) would get further there, at about 30 times the size, with a daemon and a second grant.

## Still open

- **Windows and Linux.** The driver has both, and neither is carried. An app's identity there isn't a bundle id, so `appBundleId` and the card need a second answer first, and identical controls on those systems can only be told apart with a headed click.
- **Where it shows.** A flag and a Settings page are enough to try it. A shipped feature would offer setup from onboarding, or at the moment a task needs it.
- **Windows on another Space.** The driver refuses a window that isn't exposed through accessibility, so the command says to bring it up.
- **Self-signed and ad hoc builds.** A grant follows the signature, so a build whose signature changes asks again.
- **Evals.** [`evals/cases/computer-use.ts`](../../packages/workspace/evals/cases/computer-use.ts) covers finding the command, asking for the one app, and leaving it alone when it isn't needed.
