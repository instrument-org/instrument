# Quit teardown can livelock, and every guard on that path is blind to it

**Status:** open. Seen twice, on 1.6.0-beta.2 and on 2.0.0-beta.1, both macOS, both on an install triggered from the update prompt. The second sighting pinned the stage and cleared `actor.stop()`, which this finding previously named as the strongest candidate. Which loop spins is still unidentified.

A spin in quit teardown leaves the worst possible corpse: a process with no window that still holds the single-instance lock. The Dock icon, deep links, and every relaunch route back to it and go nowhere, and a staged update never installs because Squirrel's `ShipIt` is waiting for an exit that will never come. The user's only way out is `kill -9`.

Both sightings sat at 100% CPU until they were killed, the first for an hour.

## Recognizing it

The distinguishing measurement, because it separates a spin from an ordinary stuck `await`:

```
ps -o pid,utime,stime -p <pid>   # twice, 5s apart
```

A livelock accrues ~5s of **user** time and ~0s of **system** time over 5s of wall clock. It is burning CPU with no syscalls. A merely stuck teardown accrues neither. The second sighting measured +5.02s user and +0.01s system, which is the first sighting's number to two decimal places.

`sample <pid>` then shows 100% of main-thread samples on one path:

```
uv_run -> uv__io_poll -> uv__work_done
  -> MakeLibuvRequestCallback<uv_fs_s> -> node::fs::AfterNoArgs
    -> InternalCallbackScope::~InternalCallbackScope
      -> MicrotasksScope::~MicrotasksScope -> <JIT>
```

Two samples three minutes apart put every sample on that identical path, so it is not slow progress.

Corroborating signs: the app's ports stop answering, no renderer helper survives while gpu/network/audio do, and the physical footprint holds steady because GC keeps up with the garbage.

A packaged build cannot be debugged past this point. Hardened runtime without `com.apple.security.get-task-allow` rules out `lldb`, `SIGUSR1` does not start the Node inspector under Electron, and stdio is `/dev/null`, so the exported `node::PrintCurrentStackTrace` is unreachable. Native sampling is all you get, and only its small-offset frames mean anything: Electron Framework exports so little that everything below the JIT boundary resolves to a nearby symbol thousands of bytes away and is noise.

## What the second sighting established

Three legs, and the second is what makes the first conclusive.

**The stage.** The log stops after `Quit teardown started` and never reaches `Quit teardown: tearing down browser views`.

**An unreaped child.** `closeAllAgentBrowserSessions` spawns `agent-browser close --all`. That child was spawned in the same second the teardown logged its first line, and eleven minutes later it was a zombie: exited, never reaped, because reaping needs a loop turn. So its `.finally(doExit)` never ran, and the missing log line is a stage that never executed rather than a line lost in transport. That distinction has to be earned, because the file transport is in async mode with no flush on exit, and a *successful* quit in the same log demonstrably lost its own last three lines that way.

**The session lock was already gone.** `quitTeardown` unlinks it as its first statement, so that chain is past its first await.

Everything from `doExit` onward is therefore cleared: `browserViewManager.teardown()`, `stopWorkspaceSkillWatcher()`, `killAllBackgroundProcesses()`, and `actor.stop()`. The spin is in the window between the quit handler's synchronous body and the first line of `doExit`.

## The fs frame names the drain, not the caller

Worth stating plainly, because the stack invites the opposite reading and both sightings were nearly read that way.

`~InternalCallbackScope` performs a microtask checkpoint, which drains the **entire** microtask queue. So `AfterNoArgs` says only that an fs completion is what got the drain going. The microtask that then spins can belong to any pending promise chain in the process, including one started long before the quit. `AfterNoArgs` also serves `unlink`, `close`, `access`, `rename`, `mkdir` and `chmod` alike, so it does not even name which fs op finished.

The stack shape is the other constraint. It is roughly 130 frames deep and tree-shaped, so a broad recursive traversal, not a flat loop.

## Why nothing recovered

Teardown had three deadlines and not one of them fired, because all three are `setTimeout`:

- the agent-browser close timeout in `create-workspace-actor.ts`
- the `forceFinalize` that guards a stuck skills-watcher unsubscribe, same file
- posthog's own 30s shutdown timeout

Timers are macrotasks. A synchronous or microtask-only spin starves the entire event loop, so every guard written as "bounded so a stuck X can't wedge the quit" is only true for **async** stalls. Against a spin they are decorative.

## A real livelock on that path, which was neither of these

`@posthog/core` 1.29.5 `_shutdown` (reached from `telemetry.shutdown()` in `register-telemetry.ts`):

```js
while (true) {
  const queue = this.getPersistedProperty(Queue) || []
  if (0 === queue.length) break
  await this.flush()
  if (hasTimedOut) break
}
```

`_shutdown` breaks on `0 === queue.length`; `_flush` returns early on `!queue.length`. A truthy queue whose `.length` is not a number satisfies both, so this spins forever with no I/O, and `hasTimedOut` is set by a timer it has already starved. Reproduced directly against that version: ~100% user CPU, ~0% system, no timer ever fires.

It was not the trigger for either sighting. Both profiles had usage metrics off, and `enqueue` no-ops when `optedOut`, so the queue stays empty and the loop breaks on its first check. The stack shape rules it out independently: this loop is flat and the observed stack is deeply recursive.

Still worth reporting upstream, and worth remembering that opting in puts this loop on the exit path.

## What was done

After the first sighting, teardown gained a log line per stage. That is the whole reason the second one was legible: the first incident jumped from "Quitting to install the staged update" straight to silence and could not be placed at all, while the second placed the spin inside a two-statement window.

A watchdog was built and rejected: a `worker_threads` timer can survive a starved event loop and signal the process down, and it does work, but it answers a still-unreproduced failure with an unconditional `SIGKILL` on every quit. The deadline would be guesswork, teardown's own budgets are themselves timers so the margin is soft, task databases run in `delete` journal mode rather than WAL, and a forced exit looks like a clean one, which quietly removes the reason to find the real loop.

If the user-facing dead end is worth closing later, the better lever is the single-instance lock loser, which today just calls `app.exit(0)`. It could probe the holder, and offer to force quit when the holder does not answer. Same recovery, but the destructive step belongs to the user, at the moment they have already tried to relaunch, and it needs no timer at all.

## Recovering from one

`kill -9` on the main process is the only exit. `SIGTERM` will not do it: Electron routes it into the same JS quit path, and that thread is exactly what is starved. Squirrel picks up from there on its own and installs the staged build normally, so the update is not lost. Task databases are the risk, being in `delete` journal mode rather than WAL.

## Every livelock reports as a clean exit

Nothing records that this happened. The boot after the second sighting logged no non-graceful exit and reported `app.ready` with `graceful_exit: true`, for a session that had spun for half an hour and died to `SIGKILL`.

The ordering is why, and it is deliberate. `quitTeardown` unlinks the session lock as its first statement so the marker does not depend on the network flush that follows, and the spin happens after that unlink. The marker is therefore always already gone by the time a livelocked process is killed.

So "seen twice" counts the times a person noticed a pinwheel, not the times this occurred. A fleet metric built on this marker would read zero forever, and would keep reading zero as the problem got worse. Whatever replaces it in [privacy-first diagnostics and feedback](../plans/active/privacy-first-diagnostics-and-feedback.md) should clear the marker after teardown completes rather than before, and solve the flush dependency some other way.

## Still open

Which microtask spins. The stage is now known and the shape is known, and neither names a caller. Any promise chain still pending when the quit begins is a candidate, since the checkpoint drains all of them.

The second sighting's session had spent the preceding hour running broad home-folder searches through the agent, which is the mechanism in [the agent's filesystem work stalls the window](agent-filesystem-work-stalls-the-window.md), and which had left unhandled `EPERM` rejections in the log from directories macOS protects. That is a suggestive neighbor rather than a link, and it is recorded here so a third sighting can confirm or drop it.

Both sightings were installs triggered from the update prompt on a session that had been up for hours, which may be the exposure or may only be when anyone looks.

## Related

- [The agent's filesystem work stalls the window](agent-filesystem-work-stalls-the-window.md) is the other direction of the same single-thread exposure, and [moving the agent turn off the main thread](../plans/active/agent-turn-off-the-main-thread.md) is the plan that would shrink both.
