# Which processes stay busy in real use, and whether tab sleep ended the hidden-tab cost

**Status:** open · **Check after:** 2026-11-07, once v2.0.0-beta.102 or later has run a week on the primary Mac and the test hosts · **Last checked:** 2026-10-24 (not yet on any build that logs it)

## What we're waiting to learn

A hidden agent tab kept the GPU process near 20% and its renderer near 7% for as long as the tab lived. 5fc9663c1 logs any process that stays at 15% CPU or more across three one-minute readings. 8be21ba7c puts tabs out of sight to sleep. Two questions:

- What stays busy in ordinary use, now that it is visible?
- Does sleep end the hidden-tab cost in real chats on every platform? Sleep was measured at 0% on macOS and Linux, including a minimized window. It was never tried in a person's own focused, frontmost window, or on Windows at all.

## The signal

From `apps/studio/src/electron-main/lib/process-cpu.ts`:

- `Sustained CPU: <label> at N% for <m>`, with `; GPU process at N%` when the hot process is not the GPU. The label is a process type, or the site's host for a browser tab.
- `Sustained CPU ended: <label> after <m>, average N%, peak N%`.
- `Sustained CPU: further reports suppressed until the next launch` means more than 20 episodes in one launch, which is itself a finding.

Beside it, from tab sleep: `guest asleep targetId=…` and `guest awake targetId=… frame=<yes|no> after=<N>ms`. `frame=no after=2000ms` means a wake that found no frame.

## Where to look

The installed app's main log on the primary Mac and on the Linux and Windows test hosts, from v2.0.0-beta.102.

## What each answer means

- **A browser tab's host in a sustained-CPU line while the tab should be asleep:** something keeps that guest awake. Check what `mayGuestSleep` refused (sound, download, DevTools, full screen, recording).
- **Renderer or GPU episodes with no browser tab involved:** an app surface animates while idle. Find it the way the working-indicator shimmer was found.
- **`frame=no` wakes on Windows:** the covered or minimized window is not drawing. Commands still run, but each one after a sleep waits 2 s.
- **No sustained-CPU lines in a week:** close as answered. The log stays, since it costs nothing while quiet.

## Result so far

2026-10-24, tab sleep on the Windows test host (v2.0.0-beta.103, the installed app, with a page running CSS animations, a canvas loop and a 100 ms timer):

- Asleep: GPU process 0.3%, the tab's renderer 0.0%. The tab slept 5 s after the agent opened it.
- Kept awake by commands: GPU process 8.4%, the tab's renderer 8.9%.
- Wakes found a frame in 0 to 3 ms, and commands took 200 to 470 ms.
- With the window minimized, wakes still found a frame in 8 to 24 ms, a click registered, and a screenshot showed the page's current state. The 2 s wait feared for an occluded window on Windows did not happen.

So sleep behaves on Windows as on macOS and Linux. What remains is the sustained-CPU log over a week of real use.
