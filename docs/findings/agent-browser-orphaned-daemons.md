# Orphaned agent-browser daemons

**Status:** partly fixed. Per-session close presents the right daemon fingerprint and skips sessions with no live daemon, so a reap no longer starts the daemons it meant to close. Recorded 2026-08-05, quit-path recurrence observed 2026-08-12 on the installed macOS `v1.6.0-beta.4` build. Still open, checked 2026-10-02: no pid backstop exists, and upstream `main.rs` still drops the runtime untimed after `run_daemon` at v0.38.2 (the pin is `^0.38.1`).

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
`closeAllAgentBrowserSessions`) omitted it. (The constant has since moved to
five minutes; what matters is that the two sides agree, not the value.) So each
per-task reap's `close`
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
so every **per-session** invocation presents an identical daemon-config
fingerprint and `close --session` reaps the daemon it targeted instead of
replacing it.

This removes the daemon-restart-on-close bug for per-session cleanup. It does
**not** rescue a daemon that has already deadlocked (its `.pid` is gone); those
must be killed by pid. See "Not yet done" for the backstop.

### Closing a session with no daemon started one

Quitting left a fresh pair of daemons behind. Observed 2026-08-12 quitting the
installed `v1.6.0-beta.4` build after a UI review. Teardown logged clean and
fast:

```text
[2026-08-12 17:32:54.368] Quit teardown started
[2026-08-12 17:32:54.378] Quit teardown: tearing down browser views
[2026-08-12 17:32:54.379] Quit teardown: skills watcher and telemetry settled
[2026-08-12 17:32:54.379] Quit teardown: stopping the workspace actor
[2026-08-12 17:32:54.380] Quit teardown: exiting
```

Two bundled `agent-browser` processes then survived under ppid 1, one for the
managed session and one for its `-ext` sibling:

```text
/tmp/.instrument-browser/ses_01KZVQF83DGCT5HJBTFN72KG6H.sock
/tmp/.instrument-browser/ses_01KZVQF83DGCT5HJBTFN72KG6H-ext.sock
```

Their elapsed times matched the seconds since quit, so quit **started** them
rather than leaving them behind. Both were idle at 0% CPU on loopback only, so
this is not the [quit livelock](quit-teardown-can-livelock-the-app.md).

`close --all` is not what started them: upstream `run_close_all` sends `close`
only to the daemons `walk_daemons` finds and never reaches `ensure_daemon`, so
its environment cannot spawn or restart anything. Tearing down the browser views
stops each `chatBrowser` machine, whose reap calls `closeAgentBrowserSessionsForSessions`
for every session it knew, and a page the user opened makes its session known
whether or not the agent ever ran `agent-browser` in it. That helper ran `close
--session` for the session and its `-ext` sibling, and `close --session` goes
through `ensure_daemon`, which starts a daemon when none is running and then
closes the browser inside it, leaving the daemon to idle out. So every reaped
page tab with no live daemon cost a pair, at quit or at any other reap.

The helper runs `close --session` only for a name whose `<name>.pid` in the
socket dir names a live process, the same test `walk_daemons` applies.
Reproduced 2026-10-04 in a fixture workspace: one page tab opened from the
Browser place, no agent command, stop left two daemons (the session and `-ext`);
with the check, none, and a daemon the agent started is still gone after stop.

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
