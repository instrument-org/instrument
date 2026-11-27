# How often the main thread freezes in real use, and whether the watchdog tells the truth

**Status:** open · **Check after:** 2026-12-05 · **Last checked:** never

## What we're waiting to learn

How often released builds freeze outright (the main thread stuck for 10 s or more), how long a freeze lasts before the person gives up, whether freezes are loops or blocked calls, and whether the watchdog that reports them is right and cheap. A sleeping browser tab's wake loop that never yielded froze released builds for three weeks, and the only trace was a generic "didn't close properly" report at the next launch, which every other force-quit also files. The freeze watchdog ([`crashes-and-freezes.md`](../architecture/crashes-and-freezes.md#the-freeze-watchdog)) was added so the next one is its own problem with a length and a CPU reading. The commit that added it carries this file in its `Follow-up:` trailer.

## The signal

- **Reports titled Instrument stopped responding:** kind `hang`, fingerprint `hang:` of `main-thread-freeze`, one issue in the reports service. Each report's details say `ended: stopped responding, its main thread frozen for <N> s, CPU <user>% user and <system>% system` (with `, <S> s of it with the whole app starved` after the length when the whole app was starved too, as under heavy swapping) and `frozenSince:`. Count them, bucket the length (10 to 30 s, 30 s to 2 min, longer) and the CPU (over 80% user is a loop, under 20% total is a blocked call).
- **Reports titled Instrument didn't close properly** over the same builds: the generic hang. Their rate beside the freeze reports says how much of it was freezes all along.
- **`Main thread frozen for <N> s, … and counting`** in a main log, written by the worker, each followed either by `Main thread came back from a freeze of <N> s` (recovered, logged at most once an hour) or by nothing and then a launch's `ended with its main thread frozen` line (ended frozen). Freezes that recovered never reach a report, so the logs are the only place to count them.
- **False positives:** a `frozen` line within a few seconds of the computer waking (macOS `pmset -g log` Wake or DarkWake, the Windows System log's power events), or one whose recovery came at once with low CPU while nobody was using the app. Either means the held-process rule missed a case.
- **Its cost:** the worker's heap (`getHeapStatistics()` on it from the main process's inspector) and the main process's memory beside a build without it. In development on macOS it measured about 4.4 MB of heap and 4 to 7 MB of the process, and about 5 ms of work in 30 s.
- **Nothing at all** over three weeks of daily use means no freeze happened, or the worker never started: check a log for the worker failing (`Could not start the freeze watchdog`, `The freeze watchdog stopped`) before concluding the first.

## Where to look

The reports viewer and `reports show` for the two hang fingerprints. The installed app's main log on the primary Mac, the laptop, and the Windows and Linux test hosts, for builds from the first beta that carries the watchdog.

## What each answer means

- **Freeze reports with high user CPU:** a loop on the main thread. Ask the next person who sends one for a sample of the spinning process (`sample <pid> 5` on macOS) before they force-quit, and consider having the worker take a main-thread stack through the inspector on a freeze, which is the one thing it cannot say now.
- **Freeze reports with low CPU:** a blocked synchronous call. Look for synchronous file, keychain or native calls on the paths the log tail names.
- **Generic hang reports still outnumber freeze reports by far:** most force-quits were not freezes of 10 s (people quitting a stuck-looking window sooner, or freezes during launch before the watchdog starts). Consider starting it earlier in launch, or a shorter threshold.
- **False positives after sleep or wake:** tighten the held-process rule (a longer grace after a late check) and recheck.
- **Recovered freezes, many, all short (10 to 15 s) and around launch or update restarts:** startup work holding the thread; take them to [`main-thread-stalls.md`](main-thread-stalls.md), which tracks startup pauses.
- **The worker costs more than the numbers above:** cap its heap with `resourceLimits`; a cap measured only about 1 MB smaller at start, so only do it if it grows.

## Result

Not checked yet.
