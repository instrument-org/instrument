# Crashes and freezes

How Studio's main process notices that the app crashed or stopped responding, writes it down somewhere that outlives the session, and turns the way the last session ended into a problem the person can send. Most of it is in [`register-crash-diagnostics.ts`](../../apps/studio/src/electron-main/lib/register-crash-diagnostics.ts) and [`problem-reports.ts`](../../apps/studio/src/electron-main/lib/problem-reports.ts); what a report carries and why is in [`privacy-first-diagnostics-and-feedback.md`](../plans/privacy-first-diagnostics-and-feedback.md).

## While the app runs

The main process is the only one left to record that something died, and a file is the only record that outlives the session. Every file named here is in the userData folder.

- **A throw in main** (an uncaught exception or an unhandled rejection) is recorded as an exception event and the app carries on. The session's last uncaught throw is also written synchronously to `last-crash.json`, since the logger and the exception store both write later than a force-quit might come.
- **A renderer or child process that ends abnormally** is recorded as a `fatal` event with the `process-gone` mechanism.
- **A native crash** leaves a minidump: Crashpad runs with uploading off and keeps them under `crashDumps`.
- **The session marker**, `app.lock`, is written at start and removed on Node's `exit`, which every orderly ending reaches, or when a Windows session ends, which ends the process before `exit`. It names its process, so a second instance sharing the data folder leaves a live one alone.
- **The stall monitor** ([`main-thread-stalls.ts`](../../apps/studio/src/electron-main/lib/main-thread-stalls.ts)) runs a 100 ms timer on the main thread and logs each tick 250 ms late or more, naming the RPC procedures that ran meanwhile. It can only log a stall once the stall is over, so a main thread that never comes back is invisible to it.
- **The freeze watchdog** (below) sees the stall that never comes back.
- **The quit watchdog** ([`quit-watchdog.ts`](../../apps/studio/src/electron-main/lib/quit-watchdog.ts)) is a worker armed when quit teardown starts, which kills the process if teardown overruns its deadline, since that deadline is a timer on a main thread that may be stuck.

## The freeze watchdog

The main thread also hands every click and key to the windows, so a main thread that stops getting back to its event loop is an app that does not respond at all, even with every renderer free. A loop that never yields does this, and so does a loop of promises that settle at once, since microtasks never let a timer run. Without the watchdog such a freeze ends in a force-quit that the next launch can only call a session that did not close properly.

[`freeze-watchdog.ts`](../../apps/studio/src/electron-main/lib/freeze-watchdog.ts) starts a worker thread ([`freeze-watchdog-worker.ts`](../../apps/studio/src/electron-main/lib/freeze-watchdog-worker.ts)) beside the stall monitor, once the app is ready. Main adds one to a counter in a `SharedArrayBuffer` on every stall monitor tick. The worker reads it every second ([`main-thread-freezes.ts`](../../apps/studio/src/electron-main/lib/main-thread-freezes.ts), where the decisions are kept apart from the timer and the files so tests drive them with made-up times):

- **Frozen:** the counter has not moved for 10 s of checks that came on time. The worker appends one line to the log itself, in the log's own format, since main's logger appends from main's event loop and writes nothing during a freeze: `Main thread frozen for <N> s, CPU <user>% user and <system>% system, and counting`. It also writes `main-freeze.json`: the process, the build, when main last moved the counter, how long it has been stuck and the CPU. It writes the marker whole and renames it into place, again every 5 s for the first minute and every minute after that.
- **Held, not frozen:** a check that came more than 2 s after the one before means the worker was held too: the computer slept, or the system throttled the whole process. That time is not counted. Where the clock stops during sleep (macOS, Linux), a sleep does not show at all, and main's own timer runs as soon as it wakes.
- **Recovered:** the counter moves again. The worker removes the marker and tells main, which logs `Main thread came back from a freeze of <N> s, …` through the alarms gate (`@instrument-org/shared/alarms`), once an hour at most. The stall monitor logs the same stall's exact length when it ends.

The CPU is the whole process's, from `process.cpuUsage()` in the worker, in percent of one core. A loop shows near 100% user; a call blocked waiting on something (a file on a network disk, a lock) shows near nothing. That is all the watchdog knows about the cause: it takes no stack.

A launch logs at most 20 freeze lines, then one saying the rest are left out. The worker is unref'd, so it never keeps the app from exiting. Measured in development on macOS, a worker uses about 4.4 MB of heap (7 MB allocated, most of it Node's own start) and adds 4 to 7 MB to the process, and its checks keep its thread busy about 5 ms in 30 s. Nothing in it is platform-specific: worker threads, `Atomics` and `process.cpuUsage()` work the same on Windows and Linux, where the CPU is likewise the whole process's.

A freeze that starts before the app is ready, while launch work runs before the stall monitor starts, is not seen. A main process paused at a debugger's breakpoint for 10 s is frozen to the watchdog like any other.

## At the next launch

`registerCrashDiagnostics` reads what the last session left, before any store opens:

1. `last-crash.json`, folded into the log and the exception store, then removed.
2. `app.lock`: still there, and not held by a running process, means the last session never exited. One started before the computer last started ended with the computer, which is not counted.
3. `main-freeze.json`: still there, and not held by a running process, means a session ended frozen. It is logged and removed, and handed on when it names the same process as `app.lock`.
4. The minidumps written since the last start that reported any, logged by path.

Once the app is ready (redacting a report needs the signed-in accounts), `recordEndedSession` turns that into one problem for the bell, or none:

| Last session                                   | Problem                                      | Kind and fingerprint                             |
| ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Exited                                         | none, whatever it survived                    |                                                  |
| Never exited, frozen at the end                | Instrument stopped responding                 | `hang`, of `main-thread-freeze`                  |
| Never exited, a throw or a dump on record      | the throw's own words, or Instrument quit unexpectedly | `crash`, the throw's fingerprint, or of `native` |
| Never exited, nothing on record                | Instrument didn't close properly              | `hang`, of `unclean-exit`                        |

A freeze wins over a throw or a dump, because the freeze is what ended the session; its report says how long main was frozen, since when, and the CPU, and carries the recent exceptions without calling any of them the cause. In development, stopping the dev server ends every session without exiting, so only a freeze or a crash is recorded there, never the bare hang.

Waiting problems are kept in `pending-problems.json`, one per fingerprint with a count, until the person sends or dismisses them from the bell, or until the next launch sends them when they turned on sending error reports automatically. The reports service knows four kinds (`crash`, `hang`, `error`, `feedback`) and groups reports into issues by fingerprint, so a freeze is a `hang` with a fingerprint of its own and needs nothing new from the service.
