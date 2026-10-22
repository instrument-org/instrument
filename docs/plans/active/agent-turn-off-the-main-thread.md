# Move the agent turn off the Electron main thread

Status: **active.** The interpreter runs in a worker thread (below). Steps 2 to 4 are built: the stall sampler runs by default, the workspace utility process starts only with `INSTRUMENT_WORKSPACE_PROCESS=1` and hosts nothing, and a test fails if the workspace package reaches Electron. The actor has not moved (step 5). The plan also covers several workspaces open at once and a command line ([below](#beyond-speed-several-workspaces-at-once-and-a-command-line)). Dropped pastes were traced elsewhere, to a status poll ([below](#what-a-dropped-paste-measured)). The problem is measured and traced in [the agent's filesystem work stalls the window](../../findings/agent-filesystem-work-stalls-the-window.md). The direction below is settled by a survey of what comparable apps do.

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

**The workspace package imports Electron nowhere.** Zero files under `packages/workspace/src` import `electron`. Every Electron dependency is already injected through the actor's input, and the renderer is already barred from the package by an oxlint rule. The discipline that makes a utility process possible is accidentally already in place. The build guard above would make it permanent rather than a happy accident.

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

The commands that act on state only main holds (`MAIN_THREAD_COMMANDS` in `create-bash-env.ts`: `task`, `chat`, `memory`, `tab`, `app`, `agent-browser`, `jobs`, `fg`, `kill`) are stand-ins in the worker that send their argv, cwd, environment and stdin back to main, which runs the real command in the async context the tool call was made in. Three other pieces of main-owned state are reached the same way: a skill written through the shell is credited to the turn that wrote it, each task's venv has one creator, and the process trees the worker starts are reported so main can end them if the worker dies.

Measured in Studio against a 60,000-file task folder, three concurrent `find` scans moved a renderer's RPC round trip to main from 154 ms at the median and 291 ms at worst to 2 ms and 26 ms. It does not move anything else on this page: the store writes, the model stream and the message yields stay on main, and one worker serves every task, so one task's long synchronous walk still delays the others' shells.

## What a dropped paste measured

A dictation tool that pastes and then restores the clipboard 60 ms later loses text in the 2.0 window, because the keystroke and the paste's clipboard read both wait on main. That looked like the argument for this plan, and it is not: the stalls came from a two-second status poll reading every filed task's whole transcript, and a live agent turn with that poll paused, shell commands included, held main at an event-loop p99 of 11 to 14 ms and lost no pastes. [The finding](../../findings/dictated-paste-lost-to-a-status-poll.md) has the measurements and the fix.

Two consequences for this plan. The poll's cost follows the workspace into a utility process and half of it is on the renderer anyway, so the fix belongs in the reads, not the process split. And the stall sampler in step 2 is worth more than it looked: a `KeyboardEvent.timeStamp` probe cannot see this class of stall, since in Electron it is the renderer's receive time, so input latency has to be measured from outside the page or inferred from main's event-loop delay.

## Beyond speed: several workspaces at once, and a command line

The child process is also the line between the app and its back end, and two more goals depend on where it is drawn: more than one workspace open at once, each in its own window, and a command line that drives a workspace. Neither is built yet, but the boundary decisions above are made with both in mind, so the move does not have to be redone for them.

### One child per workspace

Electron's single-instance lock keeps one main process per `userData`. That main owns the windows, `workspaces.json` and the secret store, and runs one utility child per open workspace, named for it ("Instrument Workspace (<name>)"). The name shows in `app.getAppMetrics()` and comes back as `name` in `child-process-gone`; Activity Monitor shows the helper binary's name instead. A workspace crashing takes down its own child and window, never the others; main crashing takes down everything. None of the surveyed tools runs a process per project, so this is stricter than all of them, and it costs little here because workspaces share nothing on disk except the runtime folder.

Switching workspaces is stopping one child and starting another. The window still closes and reopens, since each workspace has its own Chromium session. The live workspace switch is the first step: it gives a workspace an in-process close, opens main's stores once per workspace rather than once per process, and makes every reader look the running workspace up instead of capturing the one from launch. What is still a process singleton after it (the resolved workspace, the browser view manager, the per-workspace stores under `stores/workspace/`, the account refresh timers) becomes a map keyed by workspace before a second child can run.

### One owner per workspace, found by its socket

A chat's records are one append-only log per session per device, so two processes must never own the same workspace. The open mark (`markWorkspaceOpen` / `openElsewhereBy` in `workspaces.ts`) checks and then writes, so two launches can both pass it; `chooseLaunchDeviceId` covers that today by handing the second one a throwaway device.

The child claims its workspace by binding a socket, which is how VS Code, JetBrains and Codex all take ownership. The bind succeeding makes it the owner. On `EADDRINUSE` the newcomer connects and says hello, and on `ECONNREFUSED` the socket is stale, so it is unlinked and the bind retried once. The socket lives in a short user-only temp folder (`<tmpdir>/instrument-<hash>/`, 0700, the socket 0600) or a named pipe on Windows, never under the machine folder, whose path is close to macOS's 104-byte socket limit. Once listening, the child writes `endpoint.json` (schema version, pid, instance id, build, protocol version, a random token, the endpoint) into the workspace's machine folder, through a temp file and a rename, and removes it only while it is still its own. It never goes in the workspace folder, which may sync to another computer, where a pid means nothing. The bind replaces the open mark as the authority. Dev instances share one `userData` and skip the singleton, so a second one on the same workspace meets the bind, and the choice between attaching, refusing and today's throwaway device is made when the socket lands.

### The command line is another client

`instrument` ships inside the app bundle, running the app's own binary with `ELECTRON_RUN_AS_NODE`, as VS Code's `code` does, so it always knows which `userData` it serves. It resolves a workspace from `--workspace`, else from the nearest `.instrument/` above the working directory, else the default, and reads its `endpoint.json`.

- **The wire is oRPC over a WebSocket on the socket.** `@orpc/server/ws` and `ws` are already installed. The token is checked at the upgrade and a wrong one is refused there. It is the same oRPC the renderer uses over its port, through a router of its own (`cli`: hello, status, chats, send, a turn's event stream, stop, tasks, shutdown) rather than `workspaceRouter`, so its surface is versioned and window-only routes stay out of reach.
- **The first call is `hello`,** returning the protocol version, build, workspace and capabilities. Once an update is staged, the command on disk is newer than the running app, so the client accepts the current version and the one before it, and otherwise tells the person to restart Instrument.
- **A dropped client detaches; it does not cancel.** The cancel rule above, that connection death cancels everything in flight, applies to RPC calls. A turn belongs to the workspace, so a command line that exits or loses its connection leaves the turn running, and only an explicit `stop` ends it.
- **Streams are a snapshot, then deltas.** The full-thread yields in "Out of scope" below become bytes on a socket here, so that fix comes before a follow mode ships.
- **Nothing of the client's leaks into the workspace.** The working directory is passed as an argument, never the client's environment, and the token never reaches the environment a tool inherits.
- **The command line never runs a tool itself.** Seatbelt, bubblewrap and the process-tree reaping stay in the child. The workspace HTTP server stays the agent's alone: the command line never uses it, since its gateway half is guarded only by the internal key.

### Without the app

By default, a command line that finds no owner starts the app with no window (`open -g -j` on macOS, a `--headless` flag elsewhere) and attaches once `endpoint.json` appears. Main keeps the secret store, the Mac bridge, trash, dialogs and a hidden renderer for the browser pool, so the workspace has everything it has with a window, and one permission identity. A later window launch arrives as `second-instance` and shows a window for the child already running. Concurrent invocations that each start the app are serialized by the single-instance lock.

`--no-app` runs the same host entry as the utility child in plain Node, for CI, Linux servers and evals; the workspace package importing nothing from Electron is what makes that possible. Credentials come from environment variables or an in-memory store. Each main-only service (the browser, dialogs, trash, Mac apps, app sign-ins) gets an implementation that answers that it needs the app, behind the same interface the child proxies to main, rather than `if (headless)` branches. A shipped path never decrypts the app's `safeStorage` through `security`: once someone picks "Always Allow", every program that can run `security` holds the key. If the command line later needs credentials of its own, they go in a separate keychain item through a keyring binding, or a user-only file where there is no secret service. A plain-Node host started from a terminal runs under the terminal's macOS privacy grants, not Instrument's, so it can reach different folders than the app does, and the command line says so.

When a window wants a workspace a `--no-app` host owns, main asks the host to shut down, waits a bounded time and claims the socket. It never proxies a window to a process it did not start, since the renderer's direct port only reaches main's own children.

### Before building these

These haven't been checked:
- Whether `ws` connects to a `ws+unix:` address.
- Whether a LaunchServices launch avoids the Keychain prompt that shell launches of the signed app raise.
- How Windows pipe ACLs behave between elevated and normal processes. The token check is required there, not optional.

## Migration order

Each step is meant to be shippable and reversible on its own.

0. **The live workspace switch.** A workspace closes in process, main's stores open once per workspace, and readers look the running workspace up. Every later step relies on that lifecycle.
1. **Mitigations, no process work.** Lower the two traversal budgets and the output ceiling in `create-bash-env.ts` first: a few lines, and it bounds both stall shapes at once. Then give the file walk the native treatment ripgrep already has, through the existing read-only host path seam and the obligations it carries; that removes the syscall storm and leaves the buffered pipeline result, so it is the larger job for the smaller share of the stall. Both are independent of everything below.
2. **The stall sampler.** A heartbeat worker that reports main-thread stalls, so the rest of this plan can be measured rather than believed. It is also the regression test for step 1. Built (`electron-main/lib/stall-sampler/`): main bumps a `SharedArrayBuffer` counter every 250 ms, and the worker writes its own warning once main has been silent for a second, again each time the silence doubles, into the dev log or `main.log`. Main's own timer (`main-thread-stalls.ts`) still reports the whole stall, with the RPC calls that ran, once it ends. On by default, since an idle worker costs about 10 MB and no measurable CPU; `INSTRUMENT_STALL_SAMPLER=0` turns it off.
3. **The transport, hosting nothing.** Fork a utility process, establish the port handshake, prove crash detection, bounded restart, and quit teardown against a child that does no real work. Behavior unchanged. Built (`electron-main/workspace-process/`), started only with `INSTRUMENT_WORKSPACE_PROCESS=1`: a `connect` over the parent port carries the child's end of a `MessageChannelMain` and a nonce the child answers `ready` with, then `hello` returns the protocol version, build, workspace, capabilities (none) and pid. A death is seen by the port closing, the exit, or `child-process-gone`; restarts back off from 500 ms, at most three a minute (`WORKSPACE_PROCESS_RESTART_LIMIT`), and `launch-failed`, `integrity-failure` and a protocol mismatch are not retried. Quit sends `shutdown`, waits two seconds, kills, and waits one more, beside the task teardown. The child also exits when its port closes, when main's pid is gone, or when no `connect` comes. It is built by a nested Vite build in the main config into `out/workspace-process/child.js`.
4. **The build guard.** Fail the build if the workspace package or anything it pulls in imports Electron. Cheap now, and it protects every step after this one. Built as a unit test CI runs (`packages/workspace/src/no-electron.test.ts`): every source file of the package and of the monorepo packages it depends on, and every package in its runtime dependency closure, checked for `electron`, `electron-*` and `@electron/*`.
5. **Move the actor, proxying every callback.** The bulk of the work. Renderer still talks to main, which forwards workspace calls to the child. Behind a setting, defaulted off, as the survey's migration pattern suggests.
6. **Direct renderer port.** Give the renderer its own port to the child for the workspace router, removing the main hop from streaming.
7. **Flip the default, then delete the old path.**
8. **The socket claim.** The child binds its socket and writes `endpoint.json`, replacing the open mark as the owner check.
9. **More than one workspace.** Main's remaining singletons become maps keyed by workspace, and a second window starts a second child.
10. **The command line.** The `cli` router and `hello`, the snapshot-and-delta stream, then the bundled command: attaching first, starting the app windowless next, `--no-app` last.

## Out of scope, but do not lose

Every part update yields the complete sorted message array to the renderer, up to ten times a second, and each yield is a full deserialize and reconcile of the whole thread. This plan moves that cost off main and leaves it on the renderer. It needs its own fix, and the survey has the answer if we want it: every harness pairs a baseline snapshot with a delta stream and defines exactly what a reconnect replays, rather than re-sending the world.

## Traps found while scoping

**Do not set the macOS `disclaim` option on the utility process.** It exists to make the child a separate entity for security policies including Transparency, Consent, and Control, which sounds right for a process that shells out. For us it is backwards: attached folders are reachable because of grants the app holds, and disclaiming would put the child outside them. Our existing permission errors on user folders are already this class of problem.

**electron-vite's `?modulePath` import does not work with main's config.** Its sub-build reuses main's resolved config, where `build.lib` falls back to Vite's `es` plus `umd` formats, and with the formats pinned it returns an array of outputs its load hook cannot read. The child is built the way the page editor's guest files are, by a nested Vite build the main build starts.

**`child-process-gone` reports the fork's `serviceName` as `name`.** Its `serviceName` is Chromium's, `node.mojom.NodeService` for every Node utility process, so matching on it finds nothing.

**Killing main may end the child before its own watch does.** With main killed, the child was gone in under half a second, inside the child's one-second poll of main's pid, so Chromium tearing its children down may be what ended it. The watch stays as the backstop for when it does not.

**A utility process cannot configure stdin.** Only stdout and stderr accept `pipe`, `inherit`, or `ignore`, and anything else for stdin is an error.

**Network requests from a utility process use the system network context, which has no HTTP cache**, unless a session is set explicitly. The model proxy runs in the child, so this is worth a deliberate decision rather than a discovery.

## Related

- [The agent's filesystem work stalls the window](../../findings/agent-filesystem-work-stalls-the-window.md) is the measurement and the mechanism.
- [Quit teardown can livelock](../../findings/quit-teardown-can-livelock-the-app.md) is the teardown constraint this plan inherits.
- [A watchman probe froze boot on Windows](../../findings/windows-watchman-probe-freezes-boot.md) is the same class of bug and names the instrument step 2 builds.
- [Background processes](../../architecture/background-processes.md) and [the in-app browser](../../architecture/in-app-browser.md) describe two of the subsystems that cross the boundary.
