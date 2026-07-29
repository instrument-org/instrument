# Quit when the last window closes, on macOS too

## Context

Electron's boilerplate keeps an app resident on macOS when its last window closes, because that is the platform convention: the menu bar stays, the dock icon stays, and the user quits explicitly with Cmd+Q. Studio shipped that default.

It fits apps whose windows are documents. It does not fit this one. Closing the window left the process running with agents still working — writing files, spending tokens, driving browsers — behind no window at all. There is no tray icon, no menu-bar affordance, and no background mode: nothing tells the user work is still happening, and nothing lets them stop it short of Cmd+Q on an app they believe they already closed. The running-agent warning they would have seen on Cmd+Q never fired, because closing a window is not a quit.

## Decision

Closing the last window quits the app on every platform. The window's `close` handler runs the same running-agent confirmation as Cmd+Q, so a close and a quit are the same operation reached two ways.

Windows and Linux already worked this way by platform convention. This makes macOS match, rather than special-casing it.

## Consequences

- On macOS, clicking the red close button with an agent running now raises the "agents are still running" warning as a sheet on the window. Cancel keeps the window; Quit tears down and exits.
- Minimize and Cmd+H remain the ways to get the window out of the way while agents keep working. Closing is not one of them.
- The dock icon goes away after a close, which is unusual for a macOS app. That is the point: the app is gone, and nothing is running unseen.
- "Last window" is counted, not assumed, so this stays correct if a second window ever exists — closing a non-final window will not prompt or quit.

## Implementation

- [Main window close handler](../../apps/studio/src/electron-main/windows/main/index.ts)
- [window-all-closed](../../apps/studio/src/electron-main/index.ts)
- [Quit approval, shared by close and before-quit](../../apps/studio/src/electron-main/lib/quit-guard.ts)
- [Why the confirmation cannot live on `before-quit` alone](../findings/quit-confirmation-outlives-the-window.md)
