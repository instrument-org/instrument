# Plan: drive Studio a sequence at a time, not a command at a time

Status: the session runner has landed; the rest is open. Owner: TBD. Evidence base: 2,493 driving commands across 76 recorded sessions against this checkout, plus direct measurement against a booted instance.

Complements [agent-driving-studio-friction.md](agent-driving-studio-friction.md), which measured the friction in each command. This one asks a different question: whether the per-command shape is the right one at all. It is not. Every item in the friction plan makes a command cheaper; none of them make a command unnecessary, and the measurements below say that unnecessary commands are where nearly all the time goes.

## What an action actually costs

Measured against a booted dev instance, with one CDP connection held open:

| Operation | Cost |
| --- | --- |
| WebSocket connect to the page | 3 ms, once |
| Read `__studioDrive.state()` | 0.3 ms |
| oRPC call through the debug bridge | 30 ms |
| Real `Input.dispatchMouseEvent` | 17 ms |
| 20 state reads inside one evaluation | 1.0 ms total |

A whole `studio-drive` invocation, process start through result, is 130 to 170 ms. Node itself is 20 ms of that.

Against that, the corpus median for one driving step is **7.9 s of model time plus 2.6 s of command execution**. The command execution figure is not transport: transport is the 140 ms above, and the rest is `sleep`. 41% of driving commands contain a hardcoded `sleep`, totaling 123 minutes.

So the mechanism is roughly 350x faster than the rate we drive it at, and the gap is not in the wire.

## Why a faster transport cannot pay

Total driving cost in the corpus is 5.7 h of command execution against 12.3 h of model time between commands. Capping the model time at 60 s per gap, to keep human interaction out of it, still gives 5.7 h against 6.7 h.

**Making execution instantaneous is worth under 2x.** Replacing the Chrome DevTools CLI with `studio-drive` is worth less than that again: it halves median execution for the commands it replaces (5.3 s to 2.6 s), which is real and worth finishing, but it is a rounding error against the round trips.

There is no version of "a faster way to send a click" that gets 10x. The only thing that gets 10x is sending fewer, larger things.

## The agent almost never needs to look first

The objection to batching is that UI work is inherently interactive: you read the screen, then decide. Measured across the corpus, it mostly is not.

For every driving command, extract the literals it carries (quoted strings, long identifiers) and ask where each could have been learned. Then:

- **5.7% of steps** used a value that appeared in the immediately preceding result and nowhere earlier. Those are genuine discovery and genuinely need a round trip.
- Of commands carrying an explicit click target, 51% named something that never appeared in any driving output at all. The agent knew it from the source, the skill, or the plan before it started.
- 2.8% of steps were a verbatim re-run of the previous command, which is a wait spelled as a retry.

Runs of 8 or more consecutive driving commands hold 1,271 commands across 94 runs, mean length 13.5, and average **0.9 discovery points per run**. A 13-step sequence that needs to stop and look once is a sequence that should be two commands, not thirteen.

The agents already know this and work around it: 58% of driving commands chain with `&&`, and the ceiling on that is whatever fits in a shell one-liner with no conditionals, no loops, and no way to hold a value.

## The proposal: a session runner

Add a mode where `studio-drive` takes a script, holds one CDP connection for its lifetime, and returns a structured trace. Not a new transport. The same primitives the script already implements, exposed as async functions to a caller instead of one per process.

Prototyped against a running instance: 12 steps including real-input clicks by visible text, route waits, an oRPC read, and modal open/close ran in **466 ms total, 39 ms per step**, returning a per-step trace of label, duration, and outcome. The same 12 steps as separate commands cost 2.4 s of execution today, and about 126 s end to end once model time is counted.

Requirements that come out of the measurements rather than from taste:

- **JavaScript, not a DSL.** `eval` is already the most-used subcommand after the lifecycle ones (220 calls). A DSL is a thing to learn and get wrong on the first try, which costs the round trip the batch was meant to save.
- **Run to the failure, return everything up to it.** A batch that fails at step 7 must report steps 1 through 6 and why 7 stopped. Partial results are the whole value: today a failure at step 7 has already cost 7 round trips.
- **Waiting is a primitive, not a sleep.** In the prototype, waiting for a dialog to leave took 244 ms; the corpus equivalent is `sleep 1` or `sleep 2`. This fixes itself once batching exists, without teaching anyone anything. `wait` is documented today and used 16 times against 1,030 sleeps, because under one-command-per-turn a wrong predicate costs a whole round trip while `sleep 2` costs 2 s. Inside a batch that inverts: a wrong predicate fails fast with a trace, and a sleep is visible waste.
- **Feed the script as a file or on stdin.** Never as a shell argument. See the remote case below.

The primitives are already written. `cmdClick` is one evaluation for the rect plus two input events plus a settle, all on the connection it is handed. What is missing is that the file is a top-level script rather than a module, so nothing can drive it in a loop.

## Recipes are where the second order of magnitude is

Batching collapses a session's driving into one command per discovery point. Saving that command collapses the next session's into nothing.

The recurring protocols are already visible in the corpus: boot, navigate, snapshot, act, assert. The cross-platform validation runs are the clearest case, because they are the same protocol every release against a different build. Create fixture files, create a task with folders attached, wait for idle, verify the writes landed, mutate externally, assert the UI refreshed, delete, assert, restore, assert, restart, assert. That is a premeditated protocol with checkpoints, run by hand as 30 to 40 separate commands, and it should be a checked-in script that returns a report.

The agent's judgment is then spent where it is worth something, on interpreting the report and chasing the one anomaly, rather than on retyping the protocol.

Promoting an ad-hoc batch to a saved recipe should be close to free, because which protocols recur is not knowable up front. It is discovered by noticing you have written one twice.

## The remote case is the same problem with a worse constant

Every command against a remote host is an SSH round trip, median 3.2 s, and every one is also a quoting problem. A recorded Windows validation run lost three consecutive round trips to PowerShell newline quoting, ending in hand-rolled base64 `-EncodedCommand`, and the failures read as app symptoms until they were run down.

`windows-studio-host.mjs` already solves this for its own PowerShell, via `-EncodedCommand` internally. It just does not expose "run this script on the host and give me JSON back" to the caller, so an agent writing an ad-hoc probe hand-rolls the quoting and gets it wrong.

Two fixes, both small:

- Expose an `exec` that takes a script file or stdin, encodes it, and returns structured output. Removes the entire quoting failure class.
- Let the session runner target a remote instance, so a 40-step protocol is one SSH setup rather than 40.

## What this does not fix

- **The 5.7%.** Genuine discovery still costs a round trip, and should.
- **First contact with an unfamiliar surface.** Snapshot, look, decide is the correct shape when you do not know what things are called. It is cheap (202 ms) and it is not the problem.
- **Boot.** 19 s median, untouched by any of this.
- **Reload.** Made worse, in fact: a 40-step batch is a larger thing to lose to an HMR sweep than a single command is. The scoped freeze in [agent-driving-studio-friction.md](agent-driving-studio-friction.md) stops being the fourth priority and becomes a precondition. A batch must also assert at its start that the instance did not reload under it, and say so in the trace rather than reporting the reload's effects as results.

## Expected return

Replaying the corpus with each run collapsed to one command per discovery point, charging a batch a larger authoring cost than a one-liner (a flat premium plus 18% per additional step), and holding execution at the measured 39 ms per step:

| Scope | Today | Batched | |
| --- | --- | --- | --- |
| All 57 driving sessions | 12.9 h | 2.3 h | 5.5x |
| Heaviest 12 sessions | 7.4 h | 1.1 h | 6.8x |
| Best single session | 121 m | 5 m | 24x |
| Runs of 4+ steps, median | | | 5x |
| Runs of 4+ steps, p90 | | | 11x |

Those hold gaps to 60 s to keep human time out; counting real measured gaps gives 8.2x and 11.4x for the first two rows. So the honest range for batching alone is **5x to 11x overall, and 15x to 24x on the long capture and validation runs where the time actually is**. Saved recipes are what push the recurring protocols past that.

Context is a secondary win. Driving commands emitted 1.31 M characters of output across the corpus, roughly 330 k tokens, most of it re-read state that a trace line would carry in 60 characters.

## Suggested order

1. ~~Make `studio-drive.mjs` importable, and add the session runner over its existing primitives.~~ Landed. The primitives moved to `scripts/studio-app.mjs`, which `connect()` composes into an app that traces every call; `studio-drive.mjs` is now one caller of it, and `run` is the other. A twelve-step sequence including real-input clicks, waits, an oRPC read, a branch and a modal measured at 1.2 s end to end, against roughly two minutes as twelve commands.
2. `exec` on the remote host scripts, taking a script rather than a shell string.
3. HMR freeze for the lifetime of a batch. The reload *assertion* landed with the runner: a load change mid-sequence marks the step and stops the run, since a sequence cannot re-establish its own state. Suppressing the reload in the first place is still open, and is what makes long sequences dependable rather than merely honest about having been interrupted.
4. Promote the first recurring protocol. The mechanism is already there (a helper importing `studio-app.mjs` and taking `app`), so this needs a second occurrence to justify it rather than a design. The cross-platform validation run is the obvious candidate.

## Related

- [agent-driving-studio-friction.md](agent-driving-studio-friction.md) — the per-command friction this reframes, and the source of the HMR freeze proposal.
- [../findings/driving-studio-for-ui-capture.md](../findings/driving-studio-for-ui-capture.md) — the trap catalogue behind the primitives a batch would call.
- `.agents/skills/studio-chrome-devtools/SKILL.md` — the operator's guide a session mode would need a section in.
