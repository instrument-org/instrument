# How often and how long the main thread stalls in real use

**Status:** open · **Check after:** 2026-11-14, after a week on the first beta that carries the attribution fix below · **Last checked:** 2026-10-24

## What we're waiting to learn

How often the main process stalls during real agent work, for how long, and under which RPC procedures. 7d42233f6 turned the stall log on in every build "so the numbers come from real use before deciding whether the workspace should leave the main process". That decision is step 2 of [`agent-turn-off-the-main-thread.md`](../plans/active/agent-turn-off-the-main-thread.md). Its own open question: whether an open native menu or dialog reads as a stall.

## The signal

`Main thread stalled for <N>ms during <procedures>` or `… outside RPC`, either followed by `(in flight: <procedures>)`, from `apps/studio/src/electron-main/lib/main-thread-stalls.ts`. Count the lines and bucket them by duration (under 1 s, 1 to 3 s, 3 to 10 s, 10 s and over), then by the `during` procedures.

`during` names only calls that started or settled since the timer last ran, the moments their own code runs on the main thread. `in flight` names calls that were only waiting across the stall, such as a request to the platform API, and is context, not a cause. Builds before the fix put both in one `during` list, which is why `billing.status`, a request that waits on the network, sat on 58 of the first reading's 80 lines. Read only lines from a build with the fix.

## Where to look

The installed app's main log on the primary Mac and on the test hosts, from the first beta whose stall lines can carry `(in flight: …)`.

## What each answer means

- **Stalls of a second or more during agent turns, attributed to workspace calls:** evidence for moving the workspace off the main thread. Take it into the plan's step 2.
- **Only short stalls (under 1 s), or mostly outside RPC:** the plan's step 2 loses its urgency. Look at what runs outside RPC (file watching, window events) before moving anything.
- **Stalls lining up with an open menu or dialog:** the log is measuring a modal loop, not work. Exclude those times and read again.

## Result so far

2026-10-24, primary Mac, about a day and a half on beta 100 and 101: 80 stalls. 76 were under 1 s, 4 were 1 to 3 s, none longer. By procedure: 53 named `billing.status` alone, 18 were outside RPC, and the rest mixed `billing.status` with file and drag calls. Not decisive, because those builds counted waiting calls as running; the attribution fix landed the same day.
