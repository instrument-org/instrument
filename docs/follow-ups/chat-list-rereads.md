# Whether the chat list reads rows again it did not need to

**Status:** open · **Check after:** 2026-12-10, after a week on a beta that times reads without the time the computer slept · **Last checked:** 2026-11-26

## What we're waiting to learn

Whether the chat list still reads more rows than changed. A list that re-reads everything on every event has been fixed three times (1c0ca5c5b, the task list rescanning per event; 57d9dc08c, the whole chat list rebuilt per change; 52db50f29, every chat row read again per edit to the apps folder), and none of them sent a window extra bytes, so the RPC payload warnings ([rpc-payload-sizes.md](rpc-payload-sizes.md)) cannot see the next one. The commit that adds `packages/workspace/src/lib/chat/chat-list-rereads.ts` times and counts every burst of the process's one chat list reading (`readChatList` in `live-chat-list.ts`) and warns past limits, so the next case shows up in real use.

## The signal

Three warnings in the main log, through the shared alarm gate (each key at most once an hour, at most 40 alarm lines a launch):

- `Chat list: read <N> rows again in <ms> ms for <cause> (<k> new to the list; <M> rows in <n> reads in the last minute; <L> listed)`: one burst after the first read read more than 100 rows or took more than 200 ms. `<cause>` is what woke it: `record changes`, `a change to the apps`, `a refresh` (a request reading its chat's row once it has written), or `held memory-only changes` (a streaming reply's row, read at most every 500 ms). One key per cause. `<k>` is how many of the rows were chats the reading had never read, which every burst picks up whatever woke it. The time covers the whole burst: the apps read for an app change, the index's list of chats, and the rows.
- `Chat list: read <M> rows again in <n> reads within a minute (<L> listed; the last for <cause>)`: the rows read in a rolling minute (six 10 s buckets) passed 1,000, in bursts of any size. A slower leak of the same kind.
- `Chat list: first read of <N> rows took <ms> ms`: the first read of a reading, every row by design, took more than 2 s. That is what every window waits on at launch.

A launch with none of them read no burst past the limits.

## Where to look

The installed app's main log on the primary Mac and on the test hosts, and problem reports, which carry the main log's last lines. In development the lines also print in the terminal.

## What each answer means

- **A burst line where `<N>` is close to `<L>` and `<k>` is small:** something reads every row for a change to one. Find what the cause reads and narrow it to the chats it moved, as 52db50f29 did for the apps.
- **A burst line where `<k>` is most of `<N>`:** chats arrived behind the list's back (a sync, an import, a migration). Expected once; across launches, find why the index lists chats no change named.
- **A burst line for its time alone, with few rows:** a row is slow to read (a big log, a slow disk). Look at that chat's records before the list.
- **The minute line without burst lines:** small bursts at a high rate, likely a change published per event that moves rows already current. Check what publishes `record.changed` that often.
- **The first-read line:** launch waits on the list. Measure the first read on that workspace and decide whether rows need a cheaper first read.
- **No warnings after real agent turns and app edits:** the limits may be too high. Lower them before closing this, rather than closing it as quiet.

## Result, 2026-11-26

Read the installed main logs on the primary Mac (November 9 to 26) and a laptop (November 17 to 26), about two weeks on betas carrying the warnings.

- **First read:** five lines on the primary Mac, one per cold launch after a restart, 441 to 477 rows in 2.6 to 44.3 s (the longest the first launch after a reboot, with the workspace in a sync engine's folder). Each finished within about a second of the bookmarks store opening, which took as long, and windows wait on both. So launch waits on the list: cold I/O shared with the bookmarks read, not the rows themselves. None on the laptop.
- **A change to the apps:** five on each Mac, every row read (430 to 724) with none new, in 5 to 315 ms. Expected while the set of apps moves, since a row shows its apps; on the laptop the set moved three times within a minute once, which is worth explaining.
- **Record changes:** 14 lines of one row, a chat new to the list, in 0.2 to 1.5 s, which is a new chat arriving by sync; on the laptop most landed on a dark wake. One of them read 217 s: the read spanned a sleep, since Node's clock counts the time the computer sleeps. The commit that adds `packages/shared/src/process-holds.ts` times reads without the time the process was held.
- **Minute line:** once, on the laptop: 1,389 rows in 21 reads within a minute, three of them whole re-reads for the apps.
- No `a refresh` or `held memory-only changes` line.

The limits caught real cases, so they are not too high. Nothing reads every row for a change to one chat.

## Next check

After a week on a beta carrying the held-time fix: a one-row record-change line over a few seconds would now be a slow read, not a sleep. Read why the apps set moves back and forth within a minute, and whether first reads still match the bookmarks step at cold launch.
