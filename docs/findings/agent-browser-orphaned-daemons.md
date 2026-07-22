# Orphaned agent-browser daemons

## Symptom

Long-lived `agent-browser-<platform>` daemon processes accumulate on the
machine, reparented to launchd/init (ppid 1), each holding an unlinked unix
socket fd and a LISTENING TCP port (the per-session stream server). Observed 14
live daemons spanning four installs (repo `node_modules`, two worktrees, the
packaged app) over eight days, some with 5-12 min accumulated CPU.

`agent-browser close --all` reports `{"closed":0}` while the daemons are running:
they are invisible to it (see Discovery below).

## Root cause (two independent bugs, one ours)

### 1. Upstream: the daemon deadlocks during a _successful_ shutdown

`agent-browser` runs its daemon as `rt.block_on(run_daemon(&session))` followed
by a bare `return` (upstream `cli/src/main.rs`, verified against tag `v0.31.1`,
the version we ship). `run_daemon` unlinks all sidecar files
(`.sock`/`.pid`/`.version`/`.stream`/`.engine`/`.provider`/`.extensions`) _before_
returning; `process::exit` is called only on the error path. On the normal path
it falls off `main`, dropping the tokio runtime, which performs an **untimed**
blocking join of the worker and blocking-pool threads. Several exit-path awaits
are unbounded (`ChromeProcess::kill()` -> bare `child.wait()`; the CDP websocket
send half; and critically `StreamServer::shutdown()` is never called on any exit
path, so the stream `TcpListener` is only released when the process actually
dies). If any of those never completes, `Runtime::drop` blocks the main thread
forever.

Result: sidecars already removed, process alive indefinitely, every thread
parked in `pthread_cond_wait` (no thread in the I/O driver syscall -> the driver
is already torn down -> the process is inside runtime shutdown). This shutdown
code is byte-identical in 0.31.1 and 0.32.1, so upgrading does not fix it. No
`shutdown_timeout` exists anywhere in the crate.

### 2. Ours: cleanup omitted the idle-timeout env var, restarting the daemon it meant to close

The CLI hashes a handful of daemon options -- including
`AGENT_BROWSER_IDLE_TIMEOUT_MS` -- into a per-session "config fingerprint"
(`<session>.config`). `ensure_daemon` restarts the running daemon whenever an
invocation's fingerprint differs from the one that started it, and `close
--session <id>` goes through `ensure_daemon`. We started every session daemon
with `AGENT_BROWSER_IDLE_TIMEOUT_MS=30000` (set in the bash-command path) but the
cleanup helpers (`closeAgentBrowserSessionsForSessions`,
`closeAllAgentBrowserSessions`) omitted it. So each per-task reap's `close`
presented a _different_ fingerprint, causing the CLI to spawn a fresh daemon and
close the replacement while the original 30s-idle daemon kept running and later
self-terminated into the deadlock above.

## Discovery is keyed on `.pid`, so a deadlocked daemon is unrecoverable

`walk_daemons` (upstream `connection.rs`) enumerates sessions by globbing
`*.pid`, not `*.sock`. `close --all`, `session list`, `doctor`, and `doctor
--fix` all consume it. There is no `/proc` scan, `ps`, or port-probe fallback.
Once the daemon has unlinked its own `.pid` (which it does at the _start_ of the
shutdown that then deadlocks) nothing in the CLI can find or kill it. A boot-time
`close --all` cannot catch this class; only a pid recorded while the session was
live can.

Additional upstream orphan sources (not currently triggered by us): `doctor
--fix` deletes sidecars even when its `close` send fails, with no SIGKILL
fallback; `ensure_daemon` unconditionally `cleanup_stale_files` before respawning
when `daemon_ready()` was false. `doctor` is in `BLOCKED_SUBCOMMANDS`.

## Fix applied

Route `AGENT_BROWSER_IDLE_TIMEOUT_MS` through a single exported constant
(`AGENT_BROWSER_IDLE_TIMEOUT_MS` in
[agent-browser.ts](../../packages/workspace/src/lib/agent-browser.ts)) consumed
by both the bash-command spawn path
([shell-commands/agent-browser.ts](../../packages/workspace/src/lib/shell-commands/agent-browser.ts))
and the cleanup helpers
([agent-browser-cleanup.ts](../../packages/workspace/src/lib/agent-browser-cleanup.ts)),
so every invocation for a session presents an identical daemon-config
fingerprint and `close` reaps the daemon it targeted instead of replacing it.

This removes the daemon-restart-on-close bug. It does **not** rescue a daemon
that has already deadlocked (its `.pid` is gone); those must be killed by pid.
See "Not yet done" for the backstop.

## Storage locations (for reference)

All agent-browser state except the socket dir is scoped and leak-free:

| data                                  | path                                          | scope                                                |
| ------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| daemon socket + sidecars              | `/tmp/.instrument-browser/<sessionId>.*`      | machine-global dir, ULID-session-scoped filename     |
| Chromium profile                      | `<workspaceRoot>/.instrument/browser-session` | per workspace (intentional; see 2026-07-13 decision) |
| agent-browser `$HOME` + `config.json` | `<task>/.instrument/agent-browser-home`       | per task                                             |
| screenshots                           | `<task>/work/screenshots`                     | per task                                             |
| downloads                             | `<task>/downloads`                            | per task                                             |

The socket dir is machine-global because pushing it under a workspace/task dir
reintroduces the 103-byte unix socket path limit (why `d4616d648` moved it to a
short `/tmp` path; there's a 60-byte assertion in `agent-browser.test.ts`).
Session isolation is by ULID filename, not directory. userData (and thus
workspace root) is already separated dev-vs-packaged, so profiles/tasks never
collide across installs. The only cross-install hazard is the undiscriminating
`close --all` verb over the shared socket dir; per-session close avoids it.

## Not yet done

- **Pid backstop.** Record `<sessionId>.pid` while the session is live and, on
  quit and on boot, SIGKILL any recorded pid still alive (guarding against pid
  reuse). This is the only thing that reaps an already-deadlocked daemon. Cross
  -platform kill is the friction (`libc::kill` / `taskkill` / `TerminateProcess`
  or `tree-kill`).
- **Restore the boot sweep** removed as collateral in `57b3707ee` (it deleted
  the workspace machine's `Running` entry/exit cleanup while moving the exit half
  to `before-quit`). It catches crash/SIGKILL orphans that still have a `.pid`,
  but not the deadlock class.
- **Upstream:** the real fix is `rt.shutdown_timeout(...)` or `process::exit(0)`
  after `run_daemon` returns (all sidecars are already unlinked by then), plus
  calling `StreamServer::shutdown()` on daemon exit. Not filed.
