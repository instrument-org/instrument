# Which parts of the app write their log too fast

**Status:** open · **Check after:** 2026-12-10, after a week or more on a beta that carries the day warning · **Last checked:** 2026-11-26

## What we're waiting to learn

Whether any part of the app writes the main log fast enough to push everything else out of it. The main log rotates at 8 MB and keeps one archive, and a problem report carries only its last 512 KB, so one scope logging a line per event can leave a report with nothing but its own lines and cut the history we read problems against to hours. The commit that adds `apps/studio/src/electron-main/lib/log-volume.ts` counts the bytes each scope writes over a rolling hour and warns past two limits, so the next noisy scope shows up in a report rather than as a log that ends too soon.

## The signal

Two warnings in the main log, scope `log`, at most one of each per scope per hour, through the alarm gate every such warning shares (`packages/shared/src/alarms.ts`), which also stops at 40 alarm lines a launch:

- `Log volume: <scope> wrote <N> MB to the log within an hour`: one scope wrote over 1 MB within a rolling hour. `(none)` is lines logged with no scope; `(other)` is every scope after the first 200 a launch saw.
- `Log volume: the log took <N> MB within an hour (most: <scope> <N> MB, ...)`: every scope together wrote over 4 MB within a rolling hour, half a rotation, naming the three that wrote most.
- `Log volume: <scope> wrote <N> MB to the log within a day`: one scope wrote over 1 MB within a rolling day (24 hour-long buckets) while staying under the hourly limit: a steady drip that takes an eighth of a rotation a day. At most one a day per scope, and none for a day after that scope's hourly warning. The counts live in memory, so a launch counts only its own day.

The hour is six ten-minute buckets, so a total covers the last 50 to 60 minutes. A size is the line's length in characters as the transport writes it, which is its size in bytes give or take non-ASCII text, and MB is a million. The warnings themselves are not counted. Development builds count the lines their NDJSON dev log writes instead, by the bytes each entry took, and show the warnings in the terminal. A launch with neither line had no scope past 1 MB and no hour past 4 MB.

## Where to look

The installed app's main log on the primary Mac and on the test hosts, and problem reports, which carry the main log's last lines. In development the terminal shows the same warnings.

## What each answer means

- **One scope warns across launches:** it logs per event what it should log per change, or logs a payload whole. Make it log less, a count or a summary, and check the next launch's log for it.
- **Only the whole-log line, with no one scope past 1 MB:** many scopes are each moderately chatty. Look at the scopes it names and whether the 8 MB rotation still keeps a few days.
- **`(other)`:** something makes up scope names, such as a scope carrying an id. Find it and give it one fixed name.
- **Only the day line:** a scope logs a little per event all day. Same fix as a scope past its hour.
- **No warnings at all:** close this as quiet, with the largest scopes in a real main log as a sanity check of the limits.

## Result

Checked 2026-11-26 against the installed app's main log on two Macs: the primary desktop (two months, 4.3 MB, never rotated) and a laptop with a password manager extension installed in the in-app browser (ten days across one rotation).

- No hourly warning on either Mac, and none in development logs.
- The sanity check failed on the laptop: the extension's background worker console, forwarded to the log at info under `BrowserViewManager`, was 94% of the current log, 5.4 MB in its busiest day at 35 to 500 KB an hour, and had cut the rotation from about eight days to two. Every other scope on either Mac stayed under 0.2 MB a day.
- The commit that stops forwarding extension worker console output (Chrome keeps it in the worker's DevTools) fixes the cause; ten days of that log replayed without those lines go from 15.5 MB to 1.4 MB. The day warning was added beside it so the next drip shows. Replaying both Macs' logs through the meter, it fires only for that scope (five times in ten days on the laptop, never on the desktop).

Left open for a week on a beta carrying the day warning.
