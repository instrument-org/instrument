# Whether queued landings and capped Stop checks keep the machine usable

**Status:** open · **Check after:** 2026-12-03, after a week of many sessions working at once · **Last checked:** never

## What we're waiting to learn

With a dozen or more agent sessions at work, the development machine sat near a load of 30 on 18 cores. Three worktrees were running `scripts/land.sh` onto the same branch together, each with the full checks (types, type-aware lint, knip, related tests). Every landing that moved the target sent the others back through their checks, and every session's Stop hook ran type-aware oxlint, knip and vitest with nothing bounding how many did so at once. The commit that adds `scripts/check-slots.sh` queues landings one at a time and lets two sessions' Stop checks run at once, across every checkout and worktree. The questions: does the machine stay responsive, and do the waits cost more than they save?

## The signal

`.git/check-slots/log` in the primary checkout gets one line per slot taken or given up: `<time> <name> took|gave-up <seconds waited>`, `<name>` being `land` or `stop-checks`.

- `stop-checks gave-up` lines: a session waited 7 minutes and skipped its checks, which its next Stop picks up.
- `took` lines with long waits: how long landings and turns are held up.
- Load average during a busy stretch (`uptime`), against the baseline of 25 to 33 on 18 cores.

No `gave-up` lines and waits mostly under a minute means the caps cost little.

## Where to look

The log above on the development Mac, and `uptime` or Activity Monitor while several sessions are working.

## What each answer means

- **Load well below core count, few long waits:** close it.
- **Load still near or above core count:** the remaining load is elsewhere (dev servers, evals, Electron launches, git polling across worktrees). Sample `ps -Ao pcpu,args -r` while it happens and pick the next cap.
- **Frequent `stop-checks gave-up`, or Stop waits over a few minutes:** two slots is too few for the work. Try three, or make the per-session process pool in agent-hooks smaller so each slot costs less.
- **Landings queued for many minutes:** the checks per landing are the cost. Look at which step takes longest in a landing's output before changing the queue.

## Result
