# Move the agent turn off the Electron main thread

Status: **active.** The interpreter runs in a worker thread (below); the utility process is not started. Dropped pastes were traced elsewhere, to a status poll ([below](#what-a-dropped-paste-measured)). The problem is measured and traced in [the agent's filesystem work stalls the window](../../findings/agent-filesystem-work-stalls-the-window.md). The direction below is settled by a survey of what comparable apps do.

## Problem

The workspace actor, every agent tool, the just-bash interpreter, the model stream, the synchronous `node:sqlite` writes, the Hono server that serves the renderer its images and previews, and the single oRPC handler the renderer talks through all run on the Electron main process JS thread. A broad filesystem scan takes a 1 KB file read from 0 ms to 99 ms at the median and 839 ms at the worst, so everything that paints from disk queues behind the agent. Raising the libuv thread pool does not help, because the queue is synchronous path validation on the calling thread rather than the pool.

There is no in-process fix. The work has to leave the thread.

## Prior art, and what it settles

Six shipping desktop apps were surveyed. The result is one-sided enough to end the debate about direction.

**Nobody runs the agent loop on the Electron main process.** Two apps push it to a bundled non-JavaScript sidecar binary over stdio, one to a dedicated set of Electron utility processes, one to a remote server with the client only executing tool calls, and one to a Rust backend. The single app in the sample that does run heavy work on main is a database GUI with no agent, which is the topology we are trying to leave.

**All five agent apps shell out to ripgrep rather than walking a tree in JavaScript.** Two bundle the binary, one prefers it from PATH with a `git grep` fallback, one consumes it as a package. This independently confirms the native file walk mitigation, which we can ship before any process work.

Three specific things are worth copying, from three different sources.

Claude Desktop is the closest analogue: same runtime, same constraint, solved with `utilityProcess.fork` plus `MessageChannelMain`, one process per concern, each with a human-readable service name so it is identifiable in Activity Monitor. Its file-index worker ships unminified and states the intent directly, that content search runs inside the utility process so search output never touches the main-process heap. Two details from it we should take: a **build-time guard that fails the build if a worker bundle transitively imports Electron**, and a **stall sampler**, a tiny worker with a shared-memory heartbeat whose only job is detecting main-thread stalls in production. The second is the instrument our own Windows watchman finding said this class of bug is invisible without.

VS Code supplies the RPC design. Its channel IPC layer is transport-agnostic, and `ProxyChannel.fromService` / `ProxyChannel.toService` turn a plain TypeScript interface into a cross-process service with one line on each side, reflecting over method names and treating `onUpperCase` keys as events. That is the direct answer to our coupling problem below. `getDelayedChannel` is the companion worth taking: callers get a usable service object synchronously, before the child process exists, so no `await ensureStarted()` leaks into call sites. Its migration pattern is also worth copying, since every one of its process splits shipped behind an experimental setting, defaulted off, then flipped.

The open harnesses supply the cancellation model, and they converge on it independently. Cancel is a correlated protocol message carrying the original request id, not a channel signal, so a late cancel for a settled request is inert. Connection death is an implicit cancel of everything in flight. Hard process kill is a separate, escalating path with a timeout. One of them states the architectural argument for this whole plan more plainly than we did: in-process cancellation can only ever be cooperative, and hard termination requires a process isolation boundary.

One caution from the same source, which we should not learn the expensive way: do not carry payloads as JSON or Base64 over Electron IPC. It expands every body, builds large strings in both processes, and double-encodes image bytes that are already Base64 inside the RPC envelope.

The boundary is also worth more than the mitigations are. A pipeline stage buffers its whole output as one string, so a native walk still hands main a result the size of the tree; the finding measures 185 MiB for one unglobbed `rg --files` over a home folder. No command fix removes that, and the interpreter change that would is upstream. Moving the actor does remove it, because the string is then allocated somewhere the window does not live.

## What makes this cheaper than it looks

**The workspace package imports Electron nowhere.** Zero files under `packages/workspace/src` import `electron`. Every Electron dependency is already injected through the actor's input, and the renderer is already barred from the package by an ESLint rule. The discipline that makes a utility process possible is accidentally already in place. The build guard above would make it permanent rather than a happy accident.

**The CDP path is already brokered over a socket.** The agent reaches the browser as `agent-browser` binary, then CDP over WebSocket, then the workspace server's CDP bridge, then main's command dispatch, then the guest's debugger. Only the last hop crosses the new boundary. That is one command-dispatch interface, not a port of the browser stack.

**Previews do not move.** The renderer reads files over the file channel in main (`instrument://computer-<token>`), and the agent's browser opens a file at its `file://` address, so no file serving lives in the workspace server to move with it.

## What makes it expensive

**Studio's main process is a direct in-process consumer of the workspace package.** 31 files under `apps/studio/src/electron-main` import from `@instrument-org/workspace/electron`, using 102 distinct symbols. They group roughly as browser-view integration, RPC routes, and a tail of libs, stores, windows, auth, and platform APIs. Every one of those import sites becomes either a cross-process call, a thing that moves, or a thing that stays and gets a proxy. This is the bulk of the work and the reason this is weeks rather than days.

`ProxyChannel`-style reflection is what keeps that from being 102 hand-written stubs.

## The boundary

### Moves into the child

The workspace actor and its whole machine tree, the just-bash sandbox and every tool, the per-task runtimes, the session store and the task databases, the background process registry, the workspace HTTP server with the CDP bridge, the mounted ai-gateway app, and the orchestrator wake. These are pure Node today and need no adaptation beyond being started differently.

### Stays in main, reached by the child through a proxy

The nine callbacks currently injected into the actor. The browser view manager is the substantial one, since it owns native views. The rest are small: trashing a file, a feature-flag read, provider config, telemetry capture, the model cache, web search, and the apps config. Each becomes a service interface declared once.

A utility process has almost no Electron API surface. Only `net` and `systemPreferences` are available; `app`, `dialog`, `shell`, `BrowserWindow`, `ipcMain`, `Menu`, `clipboard`, `safeStorage`, `session`, and `powerMonitor` are not. Anything in the moved code that reaches for one of those has to become a proxy call, which is the concrete meaning of the boundary.

### Crosses in both directions

Renderer RPC is the significant decision. Today `workspaceRouter` is merged into Studio's router and served over one MessageChannel from main. Two shapes are available. Main can proxy workspace calls to the child, keeping one endpoint at the cost of a hop on every streamed part. Or the renderer can hold a second MessagePort straight to the child, created in main with `MessageChannelMain` and transferred to both sides with a nonce-correlated handshake.

**Take the direct port.** The hop is exactly what we are trying to remove: a streaming turn's part updates are the highest-frequency traffic in the app, and routing them through main reintroduces the coupling this plan exists to break. Every app surveyed that does this uses the direct-port handshake.

### Needs designing rather than moving

Cancellation, on the model above: a correlated message, connection death as implicit cancel, and a bounded hard-kill escalation.

Quit teardown, which already has [a livelock finding](../../findings/quit-teardown-can-livelock-the-app.md) and now gains a child process to shut down. The pattern from the survey is a shutdown message, then a bounded wait, then a kill, with the parent-death watchdog on the child side so an orphan cannot survive.

Crash handling. Detection comes from the main-process `child-process-gone` event filtered by service name, plus the message port's own close event. Restart policy must be bounded with a named limit and an explicit list of errors treated as non-recoverable, which is what every subsystem in the survey does.

Subprocess containment. A process boundary alone does not kill the agent's tool work: a killed child does not reap descendants that have re-parented. Whatever owns the OS-level process range needs to live inside the child.

## The interpreter alone, in a worker thread

A smaller move than the utility process takes the part of the stall the finding measures: the just-bash interpreter, its filesystem, and every command that only does host work run in one long-lived `node:worker_threads` worker (`packages/workspace/src/lib/bash-worker/`). Studio runs every shell there; `INSTRUMENT_BASH_WORKER=0` keeps it on main, and tests and `run-bash` stay on their own thread unless it is `1`. `createBashEnv` hands back an `exec` that posts to the worker, so the bash tool does not change.

The commands that act on state only main holds (`MAIN_THREAD_COMMANDS` in `create-bash-env.ts`: `task`, `chat`, `memory`, `open`, `app`, `agent-browser`, `jobs`, `fg`, `kill`) are stand-ins in the worker that send their argv, cwd, environment and stdin back to main, which runs the real command in the async context the tool call was made in. Three other pieces of main-owned state are reached the same way: a skill written through the shell is credited to the turn that wrote it, each task's venv has one creator, and the process trees the worker starts are reported so main can end them if the worker dies.

Measured in Studio against a 60,000-file task folder, three concurrent `find` scans moved a renderer's RPC round trip to main from 154 ms at the median and 291 ms at worst to 2 ms and 26 ms. It does not move anything else on this page: the store writes, the model stream and the message yields stay on main, and one worker serves every task, so one task's long synchronous walk still delays the others' shells.

## What a dropped paste measured

A dictation tool that pastes and then restores the clipboard 60 ms later loses text in the 2.0 window, because the keystroke and the paste's clipboard read both wait on main. That looked like the argument for this plan, and it is not: the stalls came from a two-second status poll reading every filed task's whole transcript, and a live agent turn with that poll paused, shell commands included, held main at an event-loop p99 of 11 to 14 ms and lost no pastes. [The finding](../../findings/dictated-paste-lost-to-a-status-poll.md) has the measurements and the fix.

Two consequences for this plan. The poll's cost follows the workspace into a utility process and half of it is on the renderer anyway, so the fix belongs in the reads, not the process split. And the stall sampler in step 2 is worth more than it looked: a `KeyboardEvent.timeStamp` probe cannot see this class of stall, since in Electron it is the renderer's receive time, so input latency has to be measured from outside the page or inferred from main's event-loop delay.

## Migration order

Each step is meant to be shippable and reversible on its own.

1. **Mitigations, no process work.** Lower the two traversal budgets and the output ceiling in `create-bash-env.ts` first: a few lines, and it bounds both stall shapes at once. Then give the file walk the native treatment ripgrep already has, through the existing read-only host path seam and the obligations it carries; that removes the syscall storm and leaves the buffered pipeline result, so it is the larger job for the smaller share of the stall. Both are independent of everything below.
2. **The stall sampler.** A heartbeat worker that reports main-thread stalls, so the rest of this plan can be measured rather than believed. It is also the regression test for step 1.
3. **The transport, hosting nothing.** Fork a utility process, establish the port handshake, prove crash detection, bounded restart, and quit teardown against a child that does no real work. Behavior unchanged.
4. **The build guard.** Fail the build if the workspace package or anything it pulls in imports Electron. Cheap now, and it protects every step after this one.
5. **Move the actor, proxying every callback.** The bulk of the work. Renderer still talks to main, which forwards workspace calls to the child. Behind a setting, defaulted off, as the survey's migration pattern suggests.
6. **Direct renderer port.** Give the renderer its own port to the child for the workspace router, removing the main hop from streaming.
7. **Flip the default, then delete the old path.**

## Out of scope, but do not lose

Every part update yields the complete sorted message array to the renderer, up to ten times a second, and each yield is a full deserialize and reconcile of the whole thread. This plan moves that cost off main and leaves it on the renderer. It needs its own fix, and the survey has the answer if we want it: every harness pairs a baseline snapshot with a delta stream and defines exactly what a reconnect replays, rather than re-sending the world.

## Traps found while scoping

**Do not set the macOS `disclaim` option on the utility process.** It exists to make the child a separate entity for security policies including Transparency, Consent, and Control, which sounds right for a process that shells out. For us it is backwards: attached folders are reachable because of grants the app holds, and disclaiming would put the child outside them. Our existing permission errors on user folders are already this class of problem.

**A utility process cannot configure stdin.** Only stdout and stderr accept `pipe`, `inherit`, or `ignore`, and anything else for stdin is an error.

**Network requests from a utility process use the system network context, which has no HTTP cache**, unless a session is set explicitly. The model proxy runs in the child, so this is worth a deliberate decision rather than a discovery.

## Related

- [The agent's filesystem work stalls the window](../../findings/agent-filesystem-work-stalls-the-window.md) is the measurement and the mechanism.
- [Quit teardown can livelock](../../findings/quit-teardown-can-livelock-the-app.md) is the teardown constraint this plan inherits.
- [A watchman probe froze boot on Windows](../../findings/windows-watchman-probe-freezes-boot.md) is the same class of bug and names the instrument step 2 builds.
- [Background processes](../../architecture/background-processes.md) and [the in-app browser](../../architecture/in-app-browser.md) describe two of the subsystems that cross the boundary.
