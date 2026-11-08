# Which parts of the app write their log too fast

**Status:** open · **Check after:** 2026-11-29, after a week or more on a beta that carries the log volume warnings · **Last checked:** never

## What we're waiting to learn

Whether any part of the app writes the main log fast enough to push everything else out of it. The main log rotates at 8 MB and keeps one archive, and a problem report carries only its last 512 KB, so one scope logging a line per event can leave a report with nothing but its own lines and cut the history we read problems against to hours. The commit that adds `apps/studio/src/electron-main/lib/log-volume.ts` counts the bytes each scope writes over a rolling hour and warns past two limits, so the next noisy scope shows up in a report rather than as a log that ends too soon.

## The signal

Two warnings in the main log, scope `log`, at most one of each per scope per hour, through the alarm gate every such warning shares (`packages/shared/src/alarms.ts`), which also stops at 40 alarm lines a launch:

- `Log volume: <scope> wrote <N> MB to the log within an hour`: one scope wrote over 1 MB within a rolling hour. `(none)` is lines logged with no scope; `(other)` is every scope after the first 200 a launch saw.
- `Log volume: the log took <N> MB within an hour (most: <scope> <N> MB, ...)`: every scope together wrote over 4 MB within a rolling hour, half a rotation, naming the three that wrote most.

The hour is six ten-minute buckets, so a total covers the last 50 to 60 minutes. A size is the line's length in characters as the transport writes it, which is its size in bytes give or take non-ASCII text, and MB is a million. The warnings themselves are not counted. Development builds count the lines their NDJSON dev log writes instead, by the bytes each entry took, and show the warnings in the terminal. A launch with neither line had no scope past 1 MB and no hour past 4 MB.

## Where to look

The installed app's main log on the primary Mac and on the test hosts, and problem reports, which carry the main log's last lines. In development the terminal shows the same warnings.

## What each answer means

- **One scope warns across launches:** it logs per event what it should log per change, or logs a payload whole. Make it log less, a count or a summary, and check the next launch's log for it.
- **Only the whole-log line, with no one scope past 1 MB:** many scopes are each moderately chatty. Look at the scopes it names and whether the 8 MB rotation still keeps a few days.
- **`(other)`:** something makes up scope names, such as a scope carrying an id. Find it and give it one fixed name.
- **No warnings at all:** close this as quiet, with the largest scopes in a real main log as a sanity check of the limits.

## Result

Not checked yet.
