# How often and how long the main thread stalls in real use

**Status:** open · **Check after:** 2026-12-10, after a week on a laptop beta that leaves held time out of stalls · **Last checked:** 2026-11-26

## What we're waiting to learn

How often the main process stalls during real agent work, for how long, and under which RPC procedures. 7d42233f6 turned the stall log on in every build "so the numbers come from real use before deciding whether the workspace should leave the main process". That decision is step 2 of [`agent-turn-off-the-main-thread.md`](../plans/agent-turn-off-the-main-thread.md). Its own open question: whether an open native menu or dialog reads as a stall.

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

## Result, 2026-11-08

Read the installed main logs on the primary Mac, laptop and Windows test host. Only periods with a confirmed running build carrying attribution fix 09f387a48 were counted: beta.106 on the primary Mac from October 26, beta.105 on the laptop from October 25, and beta.109 on Windows from October 27. Earlier warnings were excluded even when they fell on the fix's release date.

| Computer | Under 1 s | 1 to under 3 s | 3 to under 10 s | 10 s or more | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Primary Mac | 124 | 13 | 1 | 2 | 140 |
| Windows test host | 56 | 5 | 2 | 0 | 63 |
| Laptop | 133 | 181 | 2,649 | 786 | 3,749 |

On the primary Mac, 106 warnings were outside RPC. The longest were 10.8 s outside RPC and 10.5 s during the project-list call, both around launch. Since October 30 there were only 21 warnings: 19 under a second and two outside RPC at 1.0 and 2.2 s. The earlier sample includes four directory-list pauses around 1.4–1.5 s and one message-create pause at 1.1 s. Those remain observations, not proof that agent execution caused the delay.

On Windows, the seven pauses of a second or more clustered around startup and update restarts. The longest was a 5.9 s startup pause involving initial workspace/window subscriptions. None of those longer pauses was attributed to an active agent turn. One 1.4 s outside-RPC pause occurred during an existing session; native-modal effects were not ruled out.

The laptop's raw total is misleading as a measure of foreground freezes. Of its 735 warnings from November 2 through 8, 732 occurred within ten seconds of an OS Wake or DarkWake in the retained power log, including every one of the 142 directory-list attributions in that period. The other three were outside RPC, at 563, 563 and 317 ms. Timer lateness across a wake must be separated before treating a procedure named at that time as the cause. This correlation does not establish how responsive the app was after each wake.

November 1 accounts for 2,719 laptop warnings, including 2,499 between 3 and 10 s, often repeated around 7.5–8.3 s. Retained OS power evidence does not cover most of that period. Background timer throttling is plausible, but neither it nor actual foreground blocking was established. Do not count that historic bulk as confirmed app freezes.

The recent evidence does not show sustained multi-second stalls attributed to agent turns. It does show startup pauses worth tracking and a wake-related limitation in the timer monitor. Keep this open: compare warnings against OS wake and foreground-use evidence before using their rate to prioritize the process split. No controlled menu/dialog check or stack capture was performed.

## Result, 2026-11-26

Read the installed main logs on the primary Mac (since November 8, betas 134 to 2.1.0-beta.5) and the laptop (November 17 to 26), with the laptop's power log for wakes.

| Computer | Under 1 s | 1 to under 3 s | 3 to under 10 s | 10 s or more | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Primary Mac | 147 | 9 | 2 | 0 | 158 |
| Laptop | 60 | 63 | 113 | 925 | 1,161 |

On the primary Mac, 10 of the 11 stalls of a second or more were outside RPC; the one inside was 1.5 s during a browser focus call. The worst cluster (4.9 and 5.9 s outside RPC) came minutes before a system memory-pressure event caused by development tools, not the app. No stall was attributed to workspace calls during an agent turn.

The laptop's numbers are not stalls. Node's clock on macOS (`performance.now()` and every timer, libuv's `uv_hrtime` on `CLOCK_MONOTONIC_RAW`) keeps counting while the computer sleeps, so the first tick after a wake is late by the whole sleep. The monitor left out only the time between the power monitor's `suspend` and `resume`, which Chromium sends for full sleeps and wakes, never for dark wakes. A process launched while the computer sleeps, which is every unattended update install overnight, therefore never saw a `suspend`, and logged the sleep before each dark wake as a stall until the next full wake: 996 of the 1,012 stalls inside the power log's coverage came from such a process before its first `resume`, up to 17.9 minutes. The freeze watchdog stayed silent through the same nights, because it treats a check of its own that comes late as the whole process held. Without those, the laptop had 8 stalls in a week, the longest 2.1 s.

By the plan's own reading ("only short stalls, or mostly outside RPC"), step 2 of [`agent-turn-off-the-main-thread.md`](../plans/agent-turn-off-the-main-thread.md) loses its urgency. The commit that adds `packages/shared/src/process-holds.ts` has the freeze watchdog add up the time the process was held, and the stall monitor judges a late tick a second and a half later, once the watchdog has checked, logging only the lateness no hold accounts for. It no longer relies on the power monitor at all. Holding a development build's main process with `SIGSTOP` for 20 and 40 s logged two stalls of that length before the change and none after. No menu or dialog check was done.

## Next check

On the laptop, after a week on a beta carrying that commit: expect a handful of stalls a week, none of minutes. Many long stalls clustered on dark wakes would mean holds the watchdog does not see (under 2 s each, or a watchdog that failed to start: look for `Could not start the freeze watchdog`). Then close this, unless the primary Mac starts showing stalls of a second or more during agent turns.
