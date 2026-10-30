# Plan: one window browser

Status: done. Landed. Part 1 named a target by its tab and made one browser; part 2 gave each tab its own lifetime, as approved below.

## Why

The in-app browser began as something only an agent opened: each task had a browser of its own, keyed by the task's id. The person's browser was later built on the same model as "the browser of the window's id". Once a task's own browser went, every API still asked whose browser it was, and the answer was always the window. Part 1 removed that question: a target is named by its tab's id, and one `windowBrowser` machine supervises every guest.

What part 1 left alone is the lifetime, and that is where the model is still wrong.

## How a guest lives today

A guest is created when a tab is opened or shown with none attached, and destroyed when its tab closes (the strip, Cmd+W, `tab close`, an agent closing a tab it opened, a chat's group dropped). Those paths are right and part 2 keeps every one.

The reaping is not:

- The window holds both leases (`retained` and `visible`) on the one browser for as long as it is open, so the machine sits in `Observed`, which has no timer. No guest is ever reaped for being out of sight; a long session keeps every tab's renderer alive.
- If the timers did fire, `Stopping` closes every guest at once. There is no per-tab decision anywhere.
- When the machine stops (its last guest closed or crashed, or a renderer reload took them all), the next registered tab spawns a fresh machine with no leases, because the window's subscriptions never acquire again. It sits in `Unobserved` and closes every guest it learned of an hour later, while their tabs stay in the strip. Inferred from the code, not seen.
- Daemon cleanup closes `agent-browser` sessions named by tab ids, but daemons are named by the agent's session (`<session>`, `<session>-ext`, `<session>-read`), so it never finds one. Daemons actually end on their own idle timeout or `close --all` at quit.
- A finished task's tabs keep their guests forever unless someone closes them.

## Part 2: a lifetime per tab, the way Chromium discards

Chromium's rules (read from source, `chrome/browser/performance_manager/policies/`): a hidden tab gets a timer when it is hidden (Memory Saver: 2, 4 or 6 hours by mode, default 4), the timer is cancelled when it is shown, a discard keeps the tab and its back/forward history and drops the renderer, and the page reloads only when the tab is focused again. A tab is protected from discarding while it is visible, was visible in the last 10 minutes, is the active tab of any window, is audible or was in the last minute, is capturing camera, microphone or screen, has had form input, is pinned, or has DevTools open. Under memory pressure, the least recently visible unprotected tab goes first, one at a time.

Part 2 applies the same shape to the window's tabs:

- **Leases move to tabs.** The renderer holds `visible` on each tab whose page is drawn (the tab up in its group, a page beside a chat or in a draft's band, Quick Look), read from `pageHostsAtom`, and nothing else. A tab with a guest and no `visible` lease is hidden and has a clock.
- **Discard, not close.** When a hidden tab's clock runs out, its guest is destroyed and the tab stays in the strip with its address. Showing it opens a guest at that address, the way a tab comes back after a launch today (`restoreUrl`). Back and forward history inside the page is lost, which Chromium keeps; the window's own steps for the tab are kept.
- **Protections**, checked when the clock runs out: on screen or shown within the last 10 minutes; driven by a task that is working; an agent command in the last 10 minutes; audible; a download in progress; DevTools open. A protected tab waits for its next check.
- **Clocks**: a tab the person has seen is discarded after 4 hours hidden. A tab an agent opened and nobody has looked at, once no working task drives it, after 1 hour.
- **The whole-browser reap goes**, and with it the respawn that closes everything an hour later. The renderer reloading still takes every guest down at once, and each comes back when shown.
- **Daemons end with the agent session**, not with a guest: a task finishing or a chat being trashed closes the `agent-browser` daemons named for its sessions.

Memory pressure is out: macOS gives Electron no reliable signal, and the clocks bound the count.

## Checking it

The machine gets table tests for each protection and clock with fake timers. The tab lifecycle only shows in the running app: open, hide, wait out a shortened clock, show again; a task driving a tab across the clock; Cmd+Shift+R; walk them with `studio-drive.mjs` on a disposable workspace.
