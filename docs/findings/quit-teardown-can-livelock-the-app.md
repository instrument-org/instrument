# Quit teardown can livelock, and every guard on that path is blind to it

A spin in quit teardown leaves the worst possible corpse: a process with no window that still holds the single-instance lock. The Dock icon, deep links, and every relaunch route back to it and go nowhere, and a staged update never installs because Squirrel's `ShipIt` is waiting for an exit that will never come. The user's only way out is `kill -9`, and there is nothing in the log to say what happened.

Observed once on 1.6.0-beta.2 (macOS), on an install triggered from the update prompt. The process sat at 100% CPU for an hour before it was killed.

## Recognizing it

The distinguishing measurement, because it separates a spin from an ordinary stuck `await`:

```
ps -o pid,utime,stime -p <pid>   # twice, 5s apart
```

A livelock accrues ~5s of **user** time and ~0s of **system** time over 5s of wall clock. It is burning CPU with no syscalls. A merely stuck teardown accrues neither.

`sample <pid>` then shows 100% of main-thread samples on one path, with a shallow JS stack over V8's allocator:

```
uv_run -> uv__io_poll -> uv__work_done
  -> MakeLibuvRequestCallback<uv_fs_s> -> node::fs::AfterNoArgs
    -> InternalCallbackScope::~InternalCallbackScope
      -> MicrotasksScope::~MicrotasksScope -> <JIT>
```

That is a **microtask continuation drained after an fs completion**. `AfterNoArgs` serves `unlink`, `close`, `access`, `rename`, `mkdir`, `chmod` and friends, so it names the shape, not the caller. Corroborating signs: the app's ports stop answering, no renderer helper survives while gpu/network/audio do, and the physical footprint holds steady because GC keeps up with the garbage.

A packaged build cannot be debugged past this point. Hardened runtime without `com.apple.security.get-task-allow` rules out `lldb`, `SIGUSR1` does not start the Node inspector under Electron, and stdio is `/dev/null`, so the exported `node::PrintCurrentStackTrace` is unreachable. Native sampling is all you get.

## Why nothing recovered

Teardown had three deadlines and not one of them fired, because all three are `setTimeout`:

- the agent-browser close timeout in `create-workspace-actor.ts`
- the `forceFinalize` that guards a stuck skills-watcher unsubscribe, same file
- posthog's own 30s shutdown timeout

Timers are macrotasks. A synchronous or microtask-only spin starves the entire event loop, so every guard written as "bounded so a stuck X can't wedge the quit" is only true for **async** stalls. Against a spin they are decorative. `actor.stop()` had no guard of any kind, and sits one line above `app.exit(0)`.

## A real livelock on that path, which was not this one

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

It was **not** the trigger for the observed incident, because that profile had usage metrics off. Opted out, `enqueue` no-ops, the queue stays empty, and `_shutdown` breaks on its first check. Worth reporting upstream regardless, and worth remembering that opting in puts this loop on the exit path.

## What was done

Teardown logs a line per stage. The incident log jumped straight from "Quitting to install the staged update" to silence, so the stall could not be placed from the log at all. Now a quit that never finishes says where it stopped.

Nothing else. A watchdog was built and rejected: a `worker_threads` timer can survive a starved event loop and signal the process down, and it does work, but it answers an unreproduced failure with an unconditional `SIGKILL` on every quit. The deadline would be guesswork, teardown's own budgets are themselves timers so the margin is soft, task databases run in `delete` journal mode rather than WAL, and a forced exit looks like a clean one, which quietly removes the reason to find the real loop.

If the user-facing dead end is worth closing later, the better lever is the single-instance lock loser, which today just calls `app.exit(0)`. It could probe the holder, and offer to force quit when the holder does not answer. Same recovery, but the destructive step belongs to the user, at the moment they have already tried to relaunch, and it needs no timer at all.

## Still open

Which loop actually spun. The evidence puts it in the teardown that runs after the skills watcher and telemetry settle, with `actor.stop()` the strongest candidate: XState v5's root stop is synchronous pure compute, it matches the zero-syscall profile, and the surviving state fits a teardown that never completed (workspace servers still listening, task databases still open). It could not be confirmed, because reproducing it needs the accumulated state of a day-long session and the wedged process could not be introspected.

Exposure may be narrow. The install was very likely triggered by an agent driving the app rather than by hand, on a session that had been up for a day, alongside a second isolated launch and a `ShipIt` left waiting since the previous evening.

One forward-looking note, since posthog is on its way out in favor of an opt-in reporter: the trap posthog set was sitting on the critical path to `app.exit(0)`, awaited, guarded only by a same-thread timer. Whatever replaces it should be fired off rather than awaited, especially if it reports exceptions, so the exit never depends on it finishing.
