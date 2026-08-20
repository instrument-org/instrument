# Wake on background job exit

Status: **draft, not started.** Follow-on to [background shell processes](background-shell-processes.md), which should land first. Nothing here changes the shell; it is one subscriber, one tool input, and one transcript marker.

## Problem

A background job that finishes after the turn ends is silent. The agent learns about it in exactly two ways, and both require it to already be running:

1. `fg` inside a live tool call, bounded by that call's `yieldMs`.
2. The background-processes part at the start of the *next* turn, which only exists once the user speaks.

So: start a 40 minute build, end the turn, and the result sits in a log file until a human comes back. The agent asked a question it cannot hear the answer to.

## Approach

The agent already has everything it needs to *express* a wake condition. `sleep`, `until`, `while`, and `timeout` all work in the sandbox today, so "wake me when the build finishes" is an ordinary shell loop that exits when the condition holds, run as an ordinary background job:

```bash
until rg -q 'compiled successfully' work/build.log; do sleep 2; done
```

started with a small `yieldMs` so it is promoted immediately. Nothing about that needs building.

What is missing is delivery. When that job exits, nothing starts a turn.

### No new tool

This is deliberate and worth stating, because the obvious alternative is a scheduling tool. Two of them were considered and rejected:

- A timer tool (`wake me in N seconds`) duplicates a job the shell already does, and adds a second concept for the same user-visible behavior.
- A dedicated monitor tool (one notification per line of output) is a different feature, streaming rather than completion, and can be added later without disturbing this.

The wake primitive is the background job. The condition is bash. That keeps one concept, keeps it composable (`until ... && pnpm test`), and needs no new vocabulary in the tool description beyond a sentence explaining the idiom.

### The seam

Three pieces already exist:

| Piece | Where | State |
| --- | --- | --- |
| The exit event | `publisher` topic `backgroundProcesses.changed`, documented as firing when a process "appeared, ended, or was removed" | built, one subscriber (the header pill) |
| Start-a-turn | The `session.run` RPC route, whose own comment says it exists so "the user is not made to say something to get it". Raises `runTurn`, which sends to the live session or spawns one with `runRequested: true` | built, this is the try-again path |
| The message body | `createBackgroundProcessesPart`, which already composes the running/ended prose including the "anything that depended on this is no longer true" retraction | built |

So the work is a second subscriber on `backgroundProcesses.changed` that, when a job with wake intent exits:

1. checks the session is not alive,
2. debounces a burst of exits into one turn, **naming every one of them**,
3. calls `newMessage()` with a system-authored prompt naming the job, its exit code, and **the path to its log**, not the output itself,
4. calls the same path `session.run` takes.

Point at the log rather than inlining it. Claude Code's own notification is five lines (task id, tool-use id, output file, status, one-sentence summary) and the agent reads the file if it cares, so a wake costs the same context whether the job printed one line or ten thousand. We already record `logFilePath` on every promoted process, so this is free.

Step 4 is why this is small: try-again already solved "start a turn without a user message," so a wake is that plus a reason.

### Which jobs wake

**Decision: an explicit opt-in on the `bash` call.** A new optional input, `wakeOnExit`, defaulting false.

The alternative is inferring intent from shape (exited on its own, was started with a small `yieldMs`, ran under some duration). Rejected because the rule would be invisible to both the agent and the user: a dev server crashing overnight would start an unattended turn nobody asked for, and "why did it not come back" would have no answer anyone can read. The flag costs one field and makes the intent inspectable in the transcript and in the process list.

Consequences:

- The tool description gains a short paragraph: what the flag does, the `until` idiom, and the coverage rule below.
- The process registry records the flag so `jobs` and the UI can show it.
- The agent states intent at the moment it has it, rather than the system reconstructing it later.

### Coverage rule for the prompt

Worth copying wholesale from Claude Code's `Monitor` description, because it is the failure mode that makes this feature feel broken rather than absent:

> A filter matching only the success marker stays silent through a crash, a hang, or an unexpected exit, and silence is indistinguishable from still running.

So the description should tell the agent to widen the condition to every terminal state, and to put a ceiling on it. Make the ceiling wake too rather than exit quietly: a watcher that gives up without saying so is indistinguishable from one still waiting, and waking hands the decision back to the agent instead of ending the chain by omission.

```bash
# Wrong: never exits on failure
until rg -q 'compiled successfully' work/build.log; do sleep 2; done

# Right: exits on every terminal state, with a deadline
timeout 1800 sh -c "until rg -qE 'compiled successfully|Failed to compile|ERR_' work/build.log; do sleep 2; done"
```

### Waking on an external service

The same mechanism covers "wake me when something happens over there," but only if the service offers a **waitable read**: a request that blocks until an event or a deadline, then exits. `curl --max-time 300 'https://svc/wait?since=<cursor>'` is one background job, one wake, and the payload arrives in the job's output.

Three sandbox facts constrain what such a service must look like, and they are not negotiable from our side:

- **Nothing can push in.** There is no inbound path into a task, and none is planned. A webhook aimed at the agent has nowhere to land. The event has to be something a process inside the sandbox can wait on.
- **A stream is the wrong shape.** SSE and WebSocket do not exit, so they map to per-line streaming, which is out of scope here. `curl ... | head -1` does not rescue it: if the stream goes quiet after the match the pipeline hangs.
- **State does not survive the turn.** Each wake is a fresh turn over a shell that remembers nothing, so the service needs a cursor the agent can persist in the task dir and replay from. Without one, anything that happened while the app was closed is lost silently, which is the failure this whole feature exists to avoid.

Exit codes carry the only structured signal a wake has, so a client wrapper should separate "events, here they are" from "deadline passed, nothing happened, re-arm" from "auth failed or the service is down, stop." Note also that a job's command line is shown in `jobs` and in the header popover, so credentials belong in a header read from a file, never in the URL.

Public hosts only: `denyPrivateRanges` is enforced unconditionally for `curl`, so a service on loopback or a private range is unreachable except through the real-binary escape hatches. Those hatches are also the fallback when a service offers only a socket: `tsx` is a real host process, so a short script that opens a WebSocket, waits for the first event and exits is a waitable read built from a stream, without the service changing at all.

One conflict to design around: a job's command line is shown in `jobs`, in the header popover, and in the stored transcript. A service whose credential lives in the URL therefore puts that credential on screen and in the task's permanent record. Keeping it in a file and referencing it unexpanded (`curl -s "$(cat work/.token-url)"`) works, because the command is displayed as written rather than as expanded, but the durable fix is a credential in a header that can be revoked.

### Two failures observed in a real watcher

A separate project ran this exact pattern against Claude Code for a full working day: a poll script armed in the background, a notification on exit, a reply, and a re-arm. Roughly twenty cycles, unattended, ending only when the person came back and said to stop. Two things went wrong, and both apply here.

**A burst collapsed into one event.** The first watcher reported only the newest message. The person dictated several in a row while the agent worked, and the agent answered the last one as though it were all of them. Six messages were lost that way, including a rejection of work that had just been built. The fix was to baseline on arming and report everything since, rather than the latest.

Our debounce has the identical hazard: two jobs finishing inside the same window must both be named in the wake, and a wake that says only "bg_3 finished" when `bg_2` also exited is the same bug with different nouns.

**Re-arming is entirely on the agent, every single turn, forever.** Nothing re-arms a watcher automatically, so one forgotten re-arm ends the watch silently, and the person keeps talking to something that stopped listening. Claude Code carries a keepalive for exactly this on its own loop tool; we will not.

The cheap mitigation is already built. The background-processes part names what is running at turn start, and the header pill disappears when nothing is. So the *absence* of the "will continue when this finishes" line is the signal that the watch ended, which is why that line has to be on the row rather than only in the transcript. Worth going further: when a job with `wakeOnExit` exits and the turn ends without arming another, say so, because the person's mental model is that something is still watching.

One more, less severe: nothing prevented two watchers on the same channel, and the trace shows several double-arms. Our existing note already tells the agent what is running and not to start a second copy, so this is covered as long as `wakeOnExit` jobs appear in it.

## Runaway prevention

Two bounds, because they stop different things.

**A floor between wakes.** No session wakes more often than once every 30 seconds. This absorbs a burst of jobs finishing together and a watcher that exits instantly by mistake. It slows a runaway; it does not stop one.

**A cap on consecutive unattended turns.** After N turns started by a wake with no user message in between, stop waking that session until the user speaks. This is the bound that actually holds, because the failure it catches is the agent waking, arming another watcher, waking again, forever. A floor makes that loop slow rather than bounded.

Suggested N is 20, not a small number. A legitimate chain is longer than it first looks: "check that PR every hour for the rest of today" is a perfectly reasonable ask that arms a new watcher each time, and a cap of 5 would cut it off at lunchtime. Meanwhile a genuine runaway hits 20 in ten minutes against the 30 second floor, which is fast enough. The cap is a backstop against an unbounded loop, not a policy about how much work a task may do.

The user's own message resets the count.

The number has one real measurement behind it. A day-long run of this pattern in another project produced **20 wake cycles**, with a longest unbroken run of 14 between anything typed into a composer, and it ended because the person came back rather than because the work finished. So 20 holds on the only sample there is, with little to spare. What actually keeps it from binding is the reset rule below, not the ceiling.

**And so does any inbound human-authored message**, not only composer input. A wake source can relay a person: a message dictated from a phone into an external conversation is a user speaking, arriving through a different door. Counting those against the cap would silence the agent mid-conversation, which is the opposite of what the wake is for. A build finishing is not a reset; a person's message is, wherever it came from.

Practically this means the cap counts *unanswered* wakes rather than consecutive ones, and whatever delivers an external event has to say whether it carries human authorship.

When the cap trips, say so in the transcript rather than going quiet. A feature that silently stops is worse than one that never started.

## Deliberately out of scope

- **Surviving app quit.** The process registry is in memory and dies with the app. That is accepted: a wake is a within-session promise, and the existing background-processes part already retracts stale claims after a restart.
- **Cost visibility.** An unattended turn spends money while the user is away. Not addressed now, on the basis that private beta with few users makes it a later problem. Revisit before any wider release.
- **Per-line streaming.** `Monitor`-style one-notification-per-event is a separate feature.
- **Scheduling.** No timer, no cron, no recurrence. See below, because the boundary is easy to misread.

### What this does not give you: standing recurrence

"Check this page for a discount every day" is **not** this feature, and it is worth being precise about why, because the shape looks close enough to assume otherwise.

Expressed as a wake it would be `sleep 86400` exiting, waking the agent, and the agent arming another one. That fails twice over, on two decisions taken deliberately above:

1. **It dies on quit.** Daily means overnight, and overnight means the app was closed. The registry is in memory by design, so the chain ends the first evening.
2. **It is an unbounded self-perpetuating loop**, which is exactly what the consecutive-wake cap exists to stop. Even at 20 it ends inside a month.

Anything shorter than one sitting works fine: "tell me when the build finishes," "look at that PR in an hour," "check every hour for the rest of the afternoon." The dividing line is whether the promise outlives the app session, not how long the interval is.

Standing recurrence is a different feature and a bigger one: an on-disk registry, a scheduler that runs with no task open, and cost visibility promoted from deferred to mandatory, because a daily unattended turn spends money indefinitely and unwatched. Both reference products build it separately from their event-driven paths, and both make it durable and user-visible rather than a chat side effect.

It is also a **human-facing** feature rather than an agent capability: the user should be able to see, edit, pause and delete a standing job in the UI, which means the surface comes first and any agent tool for it comes after, if at all. So do not close this gap by giving the agent a cron tool. That would put a durable, money-spending commitment behind a chat message with nothing to inspect it in, which is the one shape both reference products avoided.

## What the user sees

The session's `Done` state is `type: "final"`, so the actor genuinely terminates and a wake spawns a fresh one over the same stored messages, the same path the run-again button takes. The turn is not held open, which means the between-state needs nothing built:

| While a wake is pending | Why |
| --- | --- |
| No stop button on the composer | `isStoppable={isAgentAlive}`, and `agent.alive` is gone |
| Composer free, messages send rather than queue | `enqueue` only fires while alive |
| No spinner or busy state | `agent.running` drives those and is also gone |
| Cancel is the job's own Stop | Killing the process cancels the wake; the control already exists in the header popover |
| Stop button returns on its own when the wake fires | The new session tags `agent.alive` like any other turn |

Two things to add:

**On the process row**, a line stating the promise, so the pending wake is visible before it fires:

> Will continue the task when this finishes

**Above the woken turn**, a marker the *user* reads, not only the turn-start part the model reads:

> Continued because `bg_2` finished.

Without the second one, a finished task spontaneously starts talking and the feature reads as the app acting unprompted. This is the single most important piece of UI in the change.

## Races

User sends a message at the same moment a job exits. Already handled: `runTurn` routes to the live session when one exists, and `ProcessingQueuedMessages` drains the queue before the machine reaches `Done`. The debounce is only needed for several jobs finishing together.

## Success criteria

- A job started with `wakeOnExit` that exits after the turn ends starts a new turn carrying its exit code and output tail.
- A job started without the flag never starts a turn, including on crash.
- The user can tell, before it fires, that a wake is pending, and afterward, why the turn happened.
- Stopping the process cancels the wake.
- A wake loop is bounded by the consecutive-turn cap, and the transcript says when the cap trips.
- No change to `jobs` / `fg` / `kill` semantics, and no new agent tool.

## Where the shape came from

Claude Code routes "tell me when the build finishes" away from its scheduling tools and into the background shell, with the condition written as an `until` loop; its timer tool exists only for pacing the model's own iterations and for polling state the harness cannot observe. Codex has no equivalent: its `automation_update` tool schedules by RRULE and its shell sessions do not notify. The design here follows Claude's routing rule but drops the timer tool, because Instrument has no `/loop` and the residual case it serves does not yet exist here.
