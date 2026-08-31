# Background shell processes

Status: **active.** The workspace half works end to end and is covered by tests, the agent is told what it left running, and the user sees it in the task header and on the call that started it. No subagent tool yet. What remains is in [What the user and the agent are told](#what-the-user-and-the-agent-are-told), and [one integration](#integrating-with-mains-split-of-stdout-and-stderr) is owed to `main`.

## Problem

Every `bash` call had to finish inside its timeout or die. On expiry the tool killed the command and told the agent to retry with a larger value, so a command that took a minute cost that minute twice, and a command that never exits on purpose -- a dev server, a file watcher, a `--watch` test run -- could not be started at all. That closed off a whole class of work: build something, run it, look at it, fix it.

Killing on timeout is also pure waste. The install already downloaded, the build already compiled; the only thing the timeout accomplishes is discarding it.

## Approach

One parameter replaces the timeout: `yieldMs`, how long the tool waits before handing back. A command that finishes inside its window returns output and an exit code, exactly as before. A command that does not is **not killed** -- it keeps running, gets an id, and the call returns what it has written so far. From there three shell commands manage it: `jobs` lists them, `fg` prints what one has written since the last read and blocks until it exits, and `kill` stops it.

There is no `background: true` flag. Deliberately starting a long-lived process is spelled `yieldMs: 1000` -- "give me the id promptly" -- which makes explicit intent and accidental overrun the same mechanism, so the agent cannot get one of the two wrong.

### What runs where

The agent's shell is `just-bash`, a JS interpreter over a virtual filesystem with a curated command set, not a real shell (see [agent-sandbox.md](../../architecture/agent-sandbox.md)). Backgrounding had to stay inside it: handing the agent a real `sh -c` for long-running commands would give it the host filesystem and every binary on `PATH`, which is precisely what the sandbox exists to prevent. So a background process is a `bash.exec()` call that outlived its yield window, not a detached host process, and `&`/`nohup`/`disown` remain unsupported.

### Streaming without a PTY

`bash.exec()` resolves once, at the end, so the interpreter itself cannot report progress. But every long-running thing the agent can actually start is a real binary reached through a shim -- `pnpm`, `tsx`, `python`, `uv`, `ffmpeg`, `node`, `git` -- and those all funnel through two chokepoints: [`execShim`](../../../packages/workspace/src/lib/shell-commands/exec-shim.ts) and [`runPnpmCommand`](../../../packages/workspace/src/lib/run-pnpm.ts).

Both now read the subprocess's merged output stream themselves and forward whole lines to an output sink, instead of letting execa buffer it. The sink is [async-context-scoped](../../../packages/workspace/src/lib/shell-commands/output-sink.ts), so a background run opts in every shim beneath it without a sink parameter being threaded through fifteen `create*Command` factories and the interpreter that calls them.

The consequence to know: **only real-binary output streams.** A long pipeline of pure builtins (`for i in ...; do echo; sleep; done`) reports nothing until it finishes, and then reports everything at once. The tool description says so.

The streamed copy is redacted in the sink itself, not in the shims. A shim applies [`filterShellOutput`](../../../packages/workspace/src/lib/filter-shell-output.ts) to the value it *returns*, which is the copy a foreground call reports; a promoted call reports the streamed copy instead, so redacting per shim would have left host paths, a home directory naming the user, and a token echoed back in a remote URL going to the model and into `bg_N.log`. One redaction at the sink covers every chokepoint, including any added later.

Lines, not chunks, because that redaction is line-anchored: a chunk boundary mid-line would split a `password=` line in two and let it through. Separators are the one thing the sink does not rewrite -- that rewrite exists to make a Windows path usable as a tool input, the authoritative final output already does it, and applying it to a live view would corrupt backslashes inside matched lines.

### Commands, not tools

Managing a background process is three shell commands (`jobs`, `fg`, `kill`) rather than two tools, because we own the interpreter and can add a program to it. Every other harness shells out to a real shell, so a builtin there would mean putting a binary on the user's `PATH` -- gemini-cli wraps every command in a subshell purely to scrape background pids back out. [`validate-skill`](../../../packages/workspace/src/lib/shell-commands/validate-skill.ts) is the precedent: a pure-JS command reaching into workspace internals.

Starting one stays on the tool, because only a tool call can yield. What moved is the management, and what that buys is composition:

- `fg bg_1 | rg -i error` filters *before* the output enters the transcript. A tool result cannot be piped, so all of it lands.
- `fg bg_1 && pnpm test` gates on the process's own exit code inside one call. Across tool calls that needs a model round-trip.
- `kill bg_1 bg_2; jobs` is one call where three tool calls were needed.

It also dissolves a wart. `toModelOutput` re-renders every time an old message is replayed, which is why no tool result here may state live status. A command's stdout is captured once, so `jobs` output is frozen at the moment it ran, like any other command's.

Two collisions with real shell semantics are worth knowing:

- `jobs` in a real shell lists jobs of *that shell*. Ours persists across calls, which is the point and contradicts "shell state does not carry across calls", so the description says so outright.
- **`wait` cannot be shadowed.** It is a `just-bash` interpreter builtin, so a custom command by that name never runs, and left alone it exits 0 with no output -- which reads as "the process finished and wrote nothing", the one wrong answer here that looks like a right one. A transform plugin rewrites `wait` to `fg` in the AST. Nothing legitimate reaches the builtin anyway, because `&` is unsupported and there are never shell jobs to wait for.

`fg` rather than `wait` for the real command, because it is the closer metaphor: a real `fg` foregrounds a job, shows its output, blocks, and returns its exit status. `kill` accepts `%1` and a signal flag, and refuses a bare number -- there is no route to the machine's own processes from here.

### Registry

[`background-processes.ts`](../../../packages/workspace/src/lib/background-processes.ts) is process-local and keyed by session. It is deliberately not persisted: a record describes a live child process, and nothing survives an app restart for it to describe.

Promotion is two-step, and that is the load-bearing design choice. `startBackgroundRun` starts the run with a sink installed and returns a handle -- no id, no log file, no registry entry. Only `promoteBackgroundProcess`, called when the yield window expires, assigns `bg_1` and opens a log. So an ordinary `echo hello` leaves nothing behind and does not burn an id, while still being promotable at any instant.

Promotion also detaches the caller's abort signal. The tool call's signal aborts as the call unwinds, which would otherwise kill the process the call just handed off.

### Reads drain, and collect for their whole window

A read returns only what arrived since the previous read, so following a chatty dev server costs the new lines rather than the whole log again.

It also collects for the full `waitMs` rather than returning at the first chunk, and returns early only when the process finishes. Returning eagerly was the first thing this spike got wrong: a server logging every 400 ms handed back exactly one line per tool call.

That makes `--timeout` a "wait for this to finish" control, not a poll interval: `fg bg_1` on a build returns the moment the build exits, with the build's own exit code.

### Output that does not fit

Two caps, with different jobs:

Every accumulation point is bounded, because each one holds output for a process that may run for hours inside Studio's main process:

- The pending buffer holds 256 KB. Past that the oldest chunks are dropped and counted, and the read reports how many bytes went.
- A single read retains 512 KB of head plus 512 KB of tail, so a long `waitMs` on a chatty process cannot accumulate without limit.
- The shim's own collector retains 2 MB of head plus 2 MB of tail, forwards a partial line past 1 MB rather than waiting for a newline that may never come, and awaits each sink write so the native stream receives backpressure.
- `work/.tool-output/<id>.log` is written incrementally from promotion onward and retains up to 16 MB. The log ends with an omitted-byte marker after reaching that quota. Ids are never reused, so a log a persisted tool result names is never overwritten, and pruning a finished record leaves its log in place.

What the log does **not** contain: output the pending buffer dropped *before* promotion, since the file does not exist until then. The tool result says so rather than pointing at the log.

At exit, the interpreter's final shell text is compared by content with everything the shims streamed. An exact duplicate is omitted. Builtin-only output becomes the pending output, and a differing result from builtins, redirects, or pipelines is appended to both the pending buffer and log under a `[final shell output]` label. An empty final result gets an explicit note explaining that the earlier live subprocess output was consumed or redirected by the shell.

### Bounds

- Owned by the **session**, not the task. One task can have several sessions live at once -- parallel turns, and every subagent inherits its parent's task -- so a task-keyed registry would let one session read and kill another's processes, and would make turn cleanup a cross-session kill.
- 8 running per task across all of its sessions. The ninth start is refused, naming the ones the refused session can actually kill and counting the rest: a kill only reaches the session that started a process, so naming another session's id would send the agent after one that comes back "no background process".
- 32 finished records per session, so a late read still finds its exit code.
- A timer stops a promoted run at 2 hours even when nothing later polls or promotes another process.
- **Not** turn-scoped. A process outlives the turn that started it, because an agent that starts a dev server and then stops calling tools reasonably expects the user to be able to reach it. `kill`, session deletion, task trash, app quit, and the 2 hour age cap end processes.
- Native shims isolate streamed subprocesses into process groups on POSIX and task trees on Windows. A kill waits for descendants and output closure before reporting success. If the bounded confirmation window expires, the status is `termination-uncertain` and the tool says the process may still be running.

## What the agent sees

Promotion:

```text
Still running after 1 second, so it moved to the background.
Process id: bg_1

Live subprocess output so far:

tick 1
tick 2

<instrument-system-note>
bg_1 is still running. Follow it with `fg bg_1`, which prints what it has written
since your last read and exits with its exit code once it finishes, and stop it with
`kill bg_1`. `jobs` lists everything still running. Its bounded process log is at
work/.tool-output/bg_1.log.
Do not start a second copy of a process that is already running. A process you
leave running stays running after your turn ends, so kill anything the user does
not need -- but leave a server running if they still want to reach it.
</instrument-system-note>
```

A read after it exits:

```text
bg_1 finished with exit code 0 after 4 seconds.

New output:

tick 9
all done
```

Tool-result text is deliberately timeless -- statements about what was true at that call, never a live process list. `toModelOutput` runs again whenever an old message is replayed into context, so a rendered "bg_1 running 5s" would come back as a lie twenty minutes later.

## Verified

### With a real agent

`pnpm eval run background` runs the actual agent loop against real models (see [Reproducing the agent runs](#reproducing-the-agent-runs)). This is the only rung that can answer whether the feature is discoverable: a command reaches the background by outliving its yield, so there is no tool listing to find it in.

Six committed cases in `evals/cases/background-processes.ts` cover discovery, both halves of `fg`, enumeration, cleanup, and a control that an ordinary command still runs inline. Nothing in any prompt names backgrounding, `jobs`, `fg` or `kill`: the only place a model learns they exist is the `bash` description.

Across the four representative models, 24 runs, every assertion passes.

| Case | Asks | claude-sonnet | gemini-pro | gpt-5.6-luna | kimi |
| --- | --- | --- | --- | --- | --- |
| serve-then-clean-up | start a server, verify it, stop it | pass | pass | pass | pass |
| wait-out-a-slow-command | block on a process for its exit code | pass | pass | pass | pass |
| read-a-running-process | observe something that never exits | pass | pass | pass | pass |
| enumerate-and-stop-everything | recover ids across calls, stop them | pass | pass | pass | pass |
| find-an-error-in-noisy-output | answer without reading it all | pass | pass | pass | pass |
| ordinary-command-stays-inline | control: nothing is promoted | pass | pass | pass | pass |

What the transcripts show, beyond the pass marks:

- **A small `yieldMs` is how every model deliberately starts a long-lived process.** That is the affordance the parameter was supposed to carry, and it is reached for without prompting.
- **Composition is used unprompted**: `kill bg_1 && sleep 1 && jobs` to stop and confirm in one call, `jobs --json; wc -l work/worker.log` to combine a listing with a count. `--json` was found without being pointed at.
- **The process tree is understood.** One model annotated its kill as stopping "the active process group and its Node children" -- the part of `kill` that was least likely to be visible.
- **Reading the log file competes with `fg`, and should.** Asked for the latest output of a running process, half the models read `work/.tool-output/bg_N.log` rather than calling `fg`. The log is advertised in the same note, holds everything rather than only what arrived since the last read, and consumes nothing. `fg` is not the only right answer here and the cases do not require it.
- **A model will raise `yieldMs` when it can see the duration.** Told to run a command with a visible `45000` in it, one model set `yieldMs: 60000` and held the call open rather than backgrounding. That is the better answer, and it is why the wait case asks for the process id first.

The one defect these found is fixed: `fg` defaulted to a ten-minute block, so a wait inside an ordinary call outlived its own window and got the call promoted -- the agent asked to look at `bg_1` and was handed `bg_2`, blocked on `bg_1`, answering nothing. The enclosing call's remaining window is the ceiling now. An assertion guards it.

### By hand

`bash-background.test.ts` puts real subprocesses through the real interpreter: promotion at the yield boundary, streaming while running, confirmed descendant cleanup, shutdown output, final pipeline output, a fast command registering nothing, and a builtin-only command reporting only at the end. Everything else in this area drives a controllable double, which cannot catch a break in how the sink obtains execa's output stream -- so that test is the one that fails when streaming regresses.

Also confirmed by hand during development:

- Foreground behavior unchanged for ordinary commands.
- `node`/`tsx` promoted at the yield boundary, streaming live, exit code propagated on the read that observes exit.
- Builtin-only command: no live output, everything at exit.
- Kill stops the process (no orphan in `pgrep`) and a later read reports `killed`.
- The running cap refuses the ninth and names the eight.
- A flooding process reports dropped bytes and points at the log.
- Full loop: start a server, reach it from a real process, watch the server log the request, kill it.

Unit coverage in `background-processes.test.ts` and `background-output-buffer.test.ts` drives a controllable run through the real sink.

### Reproducing the agent runs

```bash
# every case against every representative model
pnpm eval run --yes background

# one case, one model, while iterating
pnpm eval run --yes --model openai/gpt-5.6-luna background-wait-out

# re-check assertions against sessions already recorded, at no cost
pnpm eval report <workspace dir printed by the run>
```

Read the transcripts rather than the pass marks: three of these assertions were wrong the first time and only the tool sequence showed it. See the `validate-changes` skill for what that command is and when to reach for it.

## Gaps found while building

**`curl` cannot reach a server the agent just started.** The sandbox's SSRF guard (`denyPrivateRanges`) refuses loopback, so `curl http://localhost:PORT` fails with exit 7 and *no* message. The workaround -- make the request from a real process, e.g. a `tsx` or `python` script fetching `127.0.0.1` -- works and is now in the tool description, but it is a sharp edge on the most obvious next step after starting a server. Options: allow loopback for ports opened by this task's own background processes (needs port attribution we do not have), allow loopback generally (also reaches the workspace server, other tasks' dev servers, and the user's own local services), or leave it documented.

**No interactive input.** `bash.exec()` takes stdin once, up front; there is no PTY and nothing to write to. A command that stops at a prompt hangs until killed. That is why the read tool only reads: there is nothing for a stdin writer to write to. The description tells the agent to pass non-interactive flags.

## What this unblocked

`pnpm dev` and `pnpm start` were refused by the pnpm shim, on the grounds that
"the app is already started and running in the sandboxed environment". Two things
were wrong with that. The runtime dev server is spawned from a heartbeat, so
nothing serves an app until something is already viewing one; and the refusal was
the only remaining place in the codebase telling the agent that long-running
processes were somebody else's job.

Both are now gone. `cd work && pnpm dev` runs, promotes to a background process,
serves, and its request log is readable through `fg`.

## Known limitation: live output is below the shell

The sink sits under `just-bash`, at the native-subprocess boundary, so it sees
bytes *before* shell semantics are applied. A promoted `node work/x.js > work/out.txt`
streams its output to the model even though the shell redirected it to a file, and
a pipeline's live view can include a producer's raw output. The tools label that
view as live subprocess output. Once the command completes, a differing final
shell result is appended and labeled, including an explicit note when that result
is empty.

It also sits below each shim's own post-processing. Redaction is applied at the
sink, so host paths and credentials never reach the model either way, but a
rewrite a single shim does to its own result is not: a promoted `rg` streams
`~/project/src/x.ts` where its final output says `/mnt/project/src/x.ts`, because
the mount virtualization lives in the shim and runs on the value it returns.

Fixing the live view itself needs a streaming boundary inside the interpreter,
after redirects, pipes, and shim rewriting are resolved. Until then the live view
means "what the native process wrote, with secrets removed", while the labeled
final shell output is authoritative.

## Known limitation: a spill file past 4 MB has a gap

The sink is installed for *every* `bash` call, not only the ones that get
promoted, because any call may outlive its window. So a foreground command's
native-binary output now comes back through the shim collector's 2 MB head plus
2 MB tail rather than through execa's buffer. Past that the middle is dropped and
replaced with an omitted-byte marker, and that is what lands in the
`work/.tool-output/<partId>.log` spill file. The notice points at the file
without calling it complete, and the file marks where it was cut, so nothing
claims more than it has -- but a command whose output exceeds 4 MB cannot be
read back in full.

Lifting that means carrying the collector's omitted-byte count back up through
`bash.exec`, which today returns text and an exit code and nothing else.

## Known limitation: a hard crash leaves the tree running

Graceful quit kills every process group, and that is strictly better than what
execa's own `cleanup` does -- measured, it terminates the direct child and leaves
grandchildren running, so a `pnpm dev` would have left its `vite` behind. A
crash or a Force Quit runs no cleanup at all, and the tree keeps its ports until
the user notices. Detaching does not cause this: descendants survive a `SIGKILL`
to the parent whether or not they are in their own group.

The mitigation with a real payoff is a pid file reaped at next boot, which is the
same shape [agent-browser-orphaned-daemons.md](../../findings/agent-browser-orphaned-daemons.md)
wants, and worth doing once for both rather than twice.

## Streaming alongside the split of stdout and stderr

`execShim` returns `stdout` and `stderr` apart, with a `ShimStreams` type and a
`mapStreams` helper. Keeping them apart is what makes `cmd > file` put
diagnostics on the terminal instead of into the file, and what leaves
`2>/dev/null` something to silence.

Streaming needs the opposite: someone watching a process wants the interleaving a
terminal would have shown, which is what `all` is. The two are not in
competition, because execa will hand out a second reader of the merged stream
while still buffering the split ones itself. `subprocess.readable({ from: "all" })`
feeds `collectAndForward`, and the buffered `stdout` and `stderr` come back
untouched as the command's result.

That tee is why nothing here sets `buffer: false`. Reading a stream execa is
itself consuming would split the chunks between the two consumers, so the earlier
shape -- buffering off, the merged text standing in as the result -- had to choose
one or the other. It no longer does, and a promoted command's redirections behave
the same as a foreground one's.

What stays true is that the live copy and the final one can differ. The streamed
copy is in arrival order; the shell renders stdout and then stderr. A command
writing to both will not match, and `appendFinalOutput` reports the difference
under `[final shell output]` rather than silently preferring one. That is the case
it was written for -- redirects and pipelines make the shell's answer differ from
what the subprocess below it printed -- and the ordering difference is one more
instance of it, not a new failure.

## What the user and the agent are told

**The agent is told at the start of a turn**, by a `data-backgroundProcesses` part
([`create-background-processes-part.ts`](../../../packages/workspace/src/lib/create-background-processes-part.ts)).
A tool result names the id it created, but that result is a message in history:
nothing told a *later* turn that `bg_1` was still serving on port 3000, so an
agent could start a duplicate or point the user at a URL for a process that had
since been killed.

`browserStatus` is the precedent it follows -- a **State** part in the taxonomy at
the top of [`message-data-part.ts`](../../../packages/workspace/src/schemas/session/message-data-part.ts),
attached only when the answer changed. The one piece it could not inherit: the
registry is in memory, so after a restart there is nothing to read. What the
session was last told is persisted under its own storage key, which is what makes
`ended` -- "the server you started is gone" -- sayable at all.

**The user is told in the task header**, by a pill that is absent whenever nothing
is running. Four placements were drawn before picking it: above the prompt input,
inline in the transcript, the header, and the sidebar. What lost inline was the
*list* of everything running, on a point that is not about taste -- a transcript
is a log and a list of live state is the one thing a log cannot keep correct. The
same reasoning keeps the data part developer-only in the chat stream.

**And in the transcript, by the call that started it.** A promoted `bash` call is
a different question from that list: not what is running in this task, but
whether this one command is still going. Left alone the row read as a command
that had finished and printed those lines, because a promoted call carries no
exit code and the label was past tense.

It now takes the same pulsing indicator and shiny label the agent's own working
row takes, because to a reader it is the same promise -- something is happening,
and this row is where. It is deliberately not held to the rule that only one row
pulses: that rule exists so two things never look simultaneous, and once the turn
is over several commands genuinely do run at once.

Three things follow from reading the registry rather than the stored part, which
says `processId` forever and would still be claiming a dev server was up the next
morning. The indicator stops when the process does. The label returns to the past
tense. And an empty card stops saying `No output`, which reports a result it has
not reached: only real binaries stream, so a watcher loop or a server quiet in its
first second yields nothing inside the window.

The header pill's query moved to
[`use-task-background-processes.ts`](../../../apps/studio/src/client/hooks/use-task-background-processes.ts)
so both surfaces read one key -- a transcript full of promoted calls costs a
single request, and each row is a lookup. The opened card carries the duration in
words and points at the pill, which owns the only control that can stop one.

**The two-hour cap says so.** It is the only one of the three ways a process ends
that nobody performs, so it is the only one that can read as a bug. The agent is
told the cap exists in the `bash` description, a capped process settles as
`expired` rather than `killed` -- which is what a `kill` and the user's Stop
produce -- and `fg` on one spells out that nobody asked for it to stop and that
starting it again is fine. The popover names the cap alongside the other two.

**Still open.** The cap fires with no warning first, and nothing is said in the
transcript when it does, so a user who was not watching the header sees only that
the pill is gone. And the sidebar shows nothing, so a task you are not looking at
can hold a running process invisibly -- the one question the header pill cannot
answer.

## Subagents: same lifecycle, different read model

Worth landing separately, but the shapes line up closely enough to be worth writing down.

A subagent is the same lifecycle as a background process: start it, give it an id, read its progress, wait for it, kill it. So the registry here reads like a second implementer waiting to happen.

We are closer to subagents than to background shell was. The machine plumbing already exists and is unused: [`spawnAgent`](../../../packages/workspace/src/lib/spawn-agent.ts) is already passed to every tool's `execute`, [`session.ts`](../../../packages/workspace/src/machines/session.ts) already builds it, `session.spawnSubAgent` is already handled in [`machines/workspace/index.ts`](../../../packages/workspace/src/machines/workspace/index.ts), and sessions already carry `parentSessionId`. What is missing is a tool, a second entry in `agents/all.ts` (or permission to spawn `main` again), and a way to show a nested session in the transcript.

Where they differ, and why they should probably not share one registry as-is:

- A background process's unit of output is bytes on a stream; a subagent's is messages and parts, already persisted in `task.db`. Draining a byte buffer is the wrong read model for a subagent -- the parent wants the child's final text, or its live part stream, not "stdout since last poll".
- A subagent's state is already durable. This registry is deliberately not, because a child process cannot be re-attached after a restart; a subagent session can be resumed.
- A subagent that finishes after the parent's turn ended needs some way to wake the parent -- a synthetic message injected into the parent session, or an equivalent -- to be worth much. Background processes do not, because the agent is still in its tool loop while one runs.

So: same lifecycle vocabulary, different output and durability models. The likely shape is a shared `start/read/kill/list` interface with two implementations, rather than one registry holding both.

## Where the shape came from

Two established designs were read closely before building; the parts worth keeping:

- **One wait parameter, no background flag.** A tool that yields after N ms and hands back a handle covers both "this took longer than I thought" and "I meant to start a server" with the same mechanism, so the agent cannot pick the wrong one. Defaults land near 10-30 s with a clamp at both ends.
- **Never kill on expiry.** The work already happened; discarding it is the only thing a timeout achieves.
- **Collect for the whole window, break early on exit.** The alternative -- return at the first byte -- makes a read worth almost nothing.
- **A hard cap on live processes with LRU-style pruning of finished records**, rather than trusting the caller to clean up.
- **Head-and-tail truncation with an explicit omitted-byte count**, so a flood is reported as a flood rather than silently trimmed.
- **A non-durable registry is the honest choice** for live child processes: one design carries an explicit note that persisted observation and restart recovery need a separate durable slice, because a process that has exited cannot be re-attached. Subagent sessions are the opposite -- already durable -- which is the crux of the split described above.
