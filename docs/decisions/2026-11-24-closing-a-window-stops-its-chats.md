# Closing a window stops the chats at work in it

Date: 2026-11-24

Partly supersedes [Stay in the Dock when the last window closes, on macOS](2026-10-15-stay-in-the-dock-when-the-last-window-closes.md): the app still stays in the Dock on macOS, but a closed window's chats stop with it.

## Context

The earlier decision left a closed window's agents working on macOS and asked nothing on a close. To the person, closing a window means stopping what it shows, not putting it away while it carries on.

## Decision

- Closing a window, the last one on macOS included, stops the chats at work in its tab groups, and asks first when one is working ([`ask-before-closing.ts`](../../apps/studio/src/electron-main/windows/ask-before-closing.ts)).
- Work that runs with no window is a design of its own, never a side effect of a close.

## Consequences

- On macOS the app still stays in the Dock when the last window closes, and Cmd+Q is still the quit.
- A window whose page does not answer within 1.5 seconds closes anyway, so a stuck page never holds it open.

## Implementation

- `9acbb1848`: the question a close asks, and the window close that waits on it.
- [The app window's `close` handler](../../apps/studio/src/electron-main/windows/app-window.ts)
