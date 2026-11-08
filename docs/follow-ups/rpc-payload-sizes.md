# Which RPC procedures send a window megabytes

**Status:** open · **Check after:** 2026-11-29, after a week or more on a beta that carries the payload warnings · **Last checked:** never

## What we're waiting to learn

Whether any procedure besides the one that prompted this sends a window far more than it shows. The chat list stream sent its whole list, about 400 KB, on every change, about 27 MB in one three-minute agent turn, and nothing in the app noticed until a renderer probe counted bytes. The commit that adds `apps/studio/src/electron-main/lib/rpc-payloads.ts` meters every message the main process's RPC router sends a window, per procedure, and warns past two limits, so the next one shows up in real use instead of in a measuring session.

## The signal

Two warnings in the main log, scope `rpc`, at most one of each per procedure per hour, through the alarm gate every such warning shares (`packages/shared/src/alarms.ts`), which also stops at 40 alarm lines a launch and then logs one line saying the rest are held back:

- `RPC payload: <procedure> sent <N> MB in one message to window <id> (<n> messages, <M> MB in the last minute)`: one message over 1 MB. A procedure that sends a whole collection, a file or a picture as one answer.
- `RPC payload: <procedure> sent <N> MB in <n> messages to window <id> within a minute`: one procedure sent one window over 10 MB within a rolling minute, in messages of any size. A stream that resends what it already sent.

`<procedure>` is the dotted path (`workspace.chats.live.rows`). `(unknown)` means the message's call was not one the meter had seen start, such as a call older than the thousand calls a window's meter follows. Sizes are each frame's string length, which for oRPC's JSON is its size in bytes give or take non-ASCII text. A launch with neither line sent no procedure past either limit.

## Where to look

The installed app's main log on the primary Mac and on the test hosts, and problem reports, which carry the main log's last lines. In development the same lines also print in the terminal, which shows warnings.

## What each answer means

- **A procedure warns within a minute repeatedly, across launches:** it resends unchanged data. Make it send only what changed, and check with the renderer perf probe (`perf-probe-page.js`) that its bytes drop.
- **A procedure warns for one message only, rarely:** look at whether the answer is ever shown whole. A file read or a picture can be fine; a list nobody scrolls through is not.
- **Only `(unknown)`:** the meter lost track of calls. Read how many calls the window had open and whether the frames still open as `readFrameHead` expects.
- **No warnings at all after real agent turns:** the limits may be too high to catch the next case. Lower them before closing this, rather than closing it as quiet.

## Result

Not checked yet.
