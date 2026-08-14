# Agent-browser close-all starts orphan replacement daemons on app quit

**Status:** open. Observed on the installed macOS `v1.6.0-beta.4` build while quitting after a production UI review.

## Symptom

Instrument exited cleanly, but two bundled `agent-browser` processes remained alive with parent PID 1. Both were idle at 0% CPU and listening only on loopback, so this is not the separate 100% CPU Instrument quit livelock documented in [Quit teardown can livelock](quit-teardown-can-livelock-the-app.md).

The two survivors corresponded to the managed and external browser sessions for the same task:

```text
/tmp/.instrument-browser/ses_01KZVQF83DGCT5HJBTFN72KG6H.sock
/tmp/.instrument-browser/ses_01KZVQF83DGCT5HJBTFN72KG6H-ext.sock
```

Each process also held a loopback listener. The main Instrument process and every Electron helper had already exited.

## Evidence that quit started the survivors

The app log records a normal, fast teardown at 17:32:54:

```text
[2026-08-12 17:32:54.368] Quit teardown started
[2026-08-12 17:32:54.378] Quit teardown: tearing down browser views
[2026-08-12 17:32:54.379] Quit teardown: skills watcher and telemetry settled
[2026-08-12 17:32:54.379] Quit teardown: stopping the workspace actor
[2026-08-12 17:32:54.380] Quit teardown: exiting
```

About 53 seconds later, the two orphan processes had elapsed times of 53 seconds. They were therefore created at quit rather than carried over from the running app. The `close --all` call resolved before teardown continued and did not hit its three-second timeout.

The processes were terminated by their exact PIDs after inspection. A subsequent process-table check found no Instrument or bundled `agent-browser` process.

## Leading cause

Agent-browser fingerprints a daemon from its launch configuration, including the idle timeout. A command whose fingerprint differs restarts the daemon before carrying out the command. Instrument's own comment documents this requirement for per-session cleanup:

```ts
execa(AGENT_BROWSER_PATH, ["close", "--session", sessionName], {
  env: { AGENT_BROWSER_IDLE_TIMEOUT_MS, AGENT_BROWSER_SOCKET_DIR },
  reject: false,
});
```

The app sets `AGENT_BROWSER_IDLE_TIMEOUT_MS` to five minutes for normal managed-browser commands. The quit-wide cleanup omits it:

```ts
execa(AGENT_BROWSER_PATH, ["close", "--all"], {
  env: { AGENT_BROWSER_SOCKET_DIR },
  reject: false,
});
```

Agent-browser therefore sees the default one-hour idle timeout during `close --all`, which does not match the five-minute fingerprint of either running session. The observed result fits that mismatch exactly: quit starts replacement daemons, closes or loses track of the originals, and reports success while the replacements remain idle under PID 1.

This is the leading explanation, not yet a checked-in reproduction test. The next investigation should first run the same lifecycle against a disposable socket directory and compare `close --all` with and without `AGENT_BROWSER_IDLE_TIMEOUT_MS`.

## Suggested reproduction

Use a disposable socket directory so the test cannot touch a real Instrument session. Start both a normal session and its `-ext` sibling with a nondefault idle timeout, then run `close --all` once without that timeout and once with it. After each run, inspect both processes and socket files.

The product-level reproduction is:

1. Launch the packaged app with a task that uses the managed browser and an external browser session.
2. Quit Instrument normally.
3. Confirm the main process and Electron helpers exited.
4. Inspect bundled browser daemons:

   ```text
   ps -axo pid=,ppid=,%cpu=,etime=,state=,command= | rg '/Applications/Instrument\.app/.*/agent-browser'
   ```

5. Inspect their sockets and listeners with `lsof -nP -p <pid>`.

Expected behavior is no surviving bundled daemon after a clean quit. The observed behavior was one PID-1 daemon for each session variant.

## Likely fix and regression coverage

Pass the same daemon configuration to `closeAllAgentBrowserSessions()` that normal invocations and `closeAgentBrowserSessionsForSessions()` use:

```ts
env: { AGENT_BROWSER_IDLE_TIMEOUT_MS, AGENT_BROWSER_SOCKET_DIR }
```

Add a regression test that starts daemons with Instrument's nondefault timeout, calls quit-wide cleanup, and proves both the ordinary and `-ext` processes exit without a replacement process or socket. A unit test that only mocks `execa` can guard the environment contract, but a subprocess integration test is what confirms the upstream fingerprint and `close --all` behavior.
