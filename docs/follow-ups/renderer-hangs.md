# Where app windows freeze, from the stacks their hangs record

**Status:** open · **Check after:** 2026-12-07, or once a build carrying the `unresponsive` events has run two weeks of daily use on macOS and Windows · **Last checked:** never

## What we're waiting to learn

How often an app window's renderer stops responding in real use, and what JavaScript it is stuck in when it does. Until now a frozen window left nothing behind unless the main thread froze with it ([`main-thread-freezes.md`](main-thread-freezes.md)), so a window that went unresponsive for twenty seconds and came back was invisible. The commit that adds this follow-up records each hang of an app window as an exception event with the stack Chromium collects from the hung renderer, which it gives only to a page that opts in with its `Document-Policy` header (the app scheme and the dev server both send it).

## The signal

Exception events with mechanism `unresponsive`, named `RendererUnresponsive`, message `A window stopped responding`, one per hang (Chromium repeats the event while a hang lasts; a `responsive` ends it). In a main log, the line `unresponsive type=window id=<n>` followed by the stack. The event's data carries `stackMs`, how long collecting the stack took.

| What shows | What it means |
| --- | --- |
| Events with stacks whose frames point into the renderer bundle | A script hang; map the frames through the build's source maps and group by the top app frame |
| Events ending `(no JavaScript stack)` | The renderer was stuck outside JavaScript (layout, paint, the GPU), or the page did not carry the header |
| Mostly `(no JavaScript stack)` on one platform | Check that platform's app scheme responses still carry `Document-Policy` before reading it as a layout or GPU problem |
| Several events per hang, or one every few seconds while a window is fine | The once-per-hang guard or Chromium's hang timer misfires; fix that before counting |
| Nothing over two weeks | No hang lasted long enough to report, or none happened in a window Chromium counted as visible (a covered window's hang is never reported); a hang forced in a dev build tells which |

## Where to look

The exception events in problem reports and the reports service, by the `unresponsive` mechanism. The installed app's main log on the primary Mac and the Windows test host.

## What each answer means

- One stack dominating: fix that code path, the way the sleeping-tab wake loop was fixed.
- Stacks spread across many paths with long `stackMs`: the renderer is starved in general; profile a long session rather than chase single frames.
- Mostly no stack: the hangs are in rendering; look at what the window was drawing (a long transcript, a big file view) through the report's breadcrumbs.
- Nothing: keep the signal and close this as not recurring.

## Result

Not yet checked.
