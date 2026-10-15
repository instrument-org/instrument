# Stay in the Dock when the last window closes, on macOS

Supersedes [Quit when the last window closes, on macOS too](2026-07-25-quit-when-the-last-window-closes.md).

## Context

The earlier decision made closing the last window quit the app on every platform, because agents kept working behind no window, with nothing saying they were and no way to stop them short of Cmd+Q on an app the user believed was gone.

That cost more than it saved. Work in this app takes minutes, and the natural move after starting it is to put the window away and come back when told. With close as quit, that move raised "Quit Instrument?" over the running work, and the only way to get the window out of the way was Minimize or Cmd+H, which few people reach for. Pressing Cmd+W once too often across the tabs quit the app. And the app is heading for more than one window, where whichever window happens to close last quitting the app is the Windows convention, not the Mac's.

The objection itself has an answer on macOS: the Dock icon and its running dot say the app is alive, a completion notification brings the chat back, and Cmd+Q is a quit that asks first.

## Decision

On macOS, closing the last window leaves the app running in the Dock, its agents and their jobs still going. Clicking the Dock icon opens a window, and so does clicking a completion notification. Cmd+Q is the quit, and it asks first whenever it would stop something: agents in the middle of a turn, and every job a chat left running, each named by the agent's own label for it.

Windows and Linux keep closing the last window as the quit, with the same question asked on `close` while the window still exists. There is no Dock to come back from there, and staying resident would need a tray icon.

## Consequences

- Closing a window on macOS never asks anything, since it stops nothing.
- Completion notifications show with no window open on macOS, and a click opens the app window at the chat.
- A staged update installs on quit, and a Mac app that stays in the Dock quits less often, so updates wait longer for it. The update badge is how they get applied sooner.
- A job an agent left running (a dev server, a watcher) used to stop without a word when the window closed, since the quit question counted only agents mid-turn. It now keeps running on macOS, and every quit names it before stopping it.

## Implementation

- [`quitsWithLastWindow`, the one rule every close path reads](../../apps/studio/src/electron-main/lib/quit.ts)
- [The app window's `close` and `closed` handlers](../../apps/studio/src/electron-main/windows/app-window.ts)
- [`window-all-closed` and `activate`](../../apps/studio/src/electron-main/index.ts)
- [The quit question's words](../../apps/studio/src/electron-main/lib/quit-prompt.ts)
