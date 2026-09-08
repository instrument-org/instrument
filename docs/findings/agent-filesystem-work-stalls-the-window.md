# The agent's filesystem work stalls the window, and not by blocking it

**Status:** open, measured and traced to source. The mechanism is understood and reproducible; the fix is [moving the agent turn off the main thread](../plans/active/agent-turn-off-the-main-thread.md). Last checked 2026-09-08 against 2.0.0-beta.1.

The window becomes unresponsive while the agent does broad filesystem work, most visibly when a task has a large user folder attached and the agent searches it. The obvious reading is a long synchronous block on the thread that owns the window. That reading is wrong, and acting on it leads to fixes that do not work.

## What is actually on one thread

Almost everything. The workspace actor, every agent tool, the just-bash interpreter, the model stream, the synchronous `node:sqlite` writes, the Hono server that serves the renderer its images and file previews, and the single oRPC handler the renderer talks through all run on the Electron main process JS thread.

There is no worker or utility process anywhere in the app. `utilityProcess.fork` appears zero times, `node:worker_threads` appears once as a negative assertion in a test, and the one `child_process.fork` call probes the pnpm version. Renderer-side document parser workers exist but cannot help main.

So a stall on that thread is a stall of the product.

## The mechanism

just-bash's filesystem layer does two blocking syscalls on the **calling** thread before every single filesystem operation. `resolveAndValidate` runs on every public method, and with `allowSymlinks` false, which is the default and which `workspace-fs-layout.ts` never overrides, it costs a `realpathSync` plus an `lstatSync` per operation. The bulk I/O underneath genuinely uses `fs.promises` and reaches the libuv thread pool, but the validation in front of it does not.

Nothing in the traversal loops yields. There is no `setImmediate`, `queueMicrotask`, or `scheduler.yield` anywhere in the interpreter's walks. `find` batches 500 entries wide, `ls` batches 100, `grep` and `rg` walk serially. An `await` on an already-resolved promise only queues a microtask, and microtasks drain to completion before the loop turns.

The result is not one long block. It is a couple hundred thousand short blocking syscalls interleaved with awaits, so the loop keeps turning and never gets a clean turn.

## Why it feels like a freeze

Because the visible symptom is not CPU, it is filesystem latency for everything else in the process.

Measured against the real sandbox on a tree of about 102,000 files, running three concurrent scans, which is the shape a model actually produces when it issues parallel tool calls:

| | idle | three JS `find` scans |
| --- | --- | --- |
| event loop delay p50 | 11 ms | 35 ms |
| event loop delay max | 20 ms | 317 ms |
| 1 KB file read p50 | 0 ms | 99 ms |
| 1 KB file read p99 | 12 ms | 396 ms |
| 1 KB file read max | 12 ms | 839 ms |

The loop delay row reads as survivable jank. The file read row is the freeze: every part of the app that has to read a file to paint queues behind the scan, including the asset origin serving previews and thumbnails. A real user folder is far larger than this tree and far colder in cache.

## The counterintuitive part

The slow-looking thing is safe and the fast-looking thing is what stalls you.

Real ripgrep searched an entire home directory for 222 seconds with the event loop untouched, because its syscalls happen in its own process. On the same file set as the `find` above, three concurrent native walks finished in 3.0 seconds against 31.1 seconds, with loop delay p50 unchanged from idle.

A native binary that runs for minutes costs the window nothing. A JavaScript builtin that finishes in seconds costs it everything. Anyone optimizing for wall-clock time will pick the wrong one.

## The negative result worth keeping

Raising the libuv thread pool does essentially nothing, so do not spend a day on it.

| `UV_THREADPOOL_SIZE` | 1 KB file read p50 |
| --- | --- |
| 4 | 82 ms |
| 16 | 78 ms |
| 64 | 77 ms |

The pool is not the queue. The synchronous validation in front of every operation is, and it is on the calling thread by construction. This cannot be tuned away in process.

## What compounds it on the same thread

Two costs share the thread and make a scan worse than it measures alone.

Store writes are synchronous. The session store is `node:sqlite` `DatabaseSync` behind a promise-shaped facade, with a full Zod parse and superjson serialization on every read and write. `updatePart` is a read-modify-write, so two full serialize and deserialize round trips per update.

Streaming writes are O(part length) and repeat. `llm-request.ts` coalesces delta saves to one per 100 ms or 4096 characters and says why in its own comment: saving on every delta makes per-turn store work quadratic in part size. Coalescing shrinks the constant, not the shape. Each surviving write still serializes the whole accumulated text, and each one triggers a `part.updated` event, a re-read of the changed message and all its parts, and a yield of the **complete sorted message array** to the renderer. At up to ten times a second.

That last cost is worth separating, because moving the agent off main relocates it rather than removing it. The renderer still deserializes and reconciles the whole thread on every yield. It needs its own fix.

## How to reproduce the measurement

The probe is not in the repo, deliberately, since it exists to be rebuilt against whatever the boundary looks like at the time. It is about 40 lines on top of `packages/workspace/scripts/run-bash.ts`, which already builds the real sandbox.

Take that script's setup verbatim through `createBashEnv`, then replace its command loop with the following. The two instruments are the point: `monitorEventLoopDelay` catches CPU starvation and a periodic `readFile` catches the filesystem starvation that the loop delay misses.

```ts
// Stand in for the app reading a file to render.
const probeFile = path.join(taskDir, "probe.txt");
await fs.writeFile(probeFile, "x".repeat(1024));
const fsLatencies: number[] = [];
let fsProbing = true;
const fsProbe = (async () => {
  while (fsProbing) {
    const t0 = performance.now();
    await fs.readFile(probeFile);
    fsLatencies.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 100));
  }
})();

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
// Concurrency matters: a model issues parallel tool calls, and one scan
// measures far better than the three it actually starts.
await Promise.all(commands.map((c) => bash.exec(c)));
loop.disable();
fsProbing = false;
await fsProbe;
```

Report `loop.percentile(50)`, `loop.max`, and the percentiles of `fsLatencies`. Attach a large real folder read-only, and compare a JavaScript builtin (`find`, `ls -R`, `grep -r`) against the native shim (`rg --files --hidden --no-ignore`) over the same file set. Run each condition in its own process.

Two traps in the harness itself. `find` over a folder containing any unreadable directory returns nothing and exits early, which reads as a fast, clean run and measures nothing; use a tree the process can fully read, or fix that first. And `rg` respects gitignore by default, so a native run without `--no-ignore` is not searching the same file set as `find` and the comparison is meaningless.

## What resolves it

Nothing in process. The work has to leave the thread, which is [the plan](../plans/active/agent-turn-off-the-main-thread.md).

Two cheaper mitigations are real but partial, and both are worth doing regardless because they shrink the exposure before the boundary lands. Giving the file walk the native treatment `rg` already has removes the largest single source, using the `resolveReadOnlyHostPath` seam and the obligations that come with it. Lowering the traversal budget and the output ceiling, currently the upstream maximum of 256 MiB, bounds what a single call can cost.

## Related

- [A watchman probe froze boot on Windows](windows-watchman-probe-freezes-boot.md) is the same class with a different cause, and its lesson applies here: a freeze that shows "Not Responding" is the main process. It also names the instrument this finding needed and did not have, a main-thread stall watchdog, scoped in [privacy-first-diagnostics-and-feedback](../plans/active/privacy-first-diagnostics-and-feedback.md).
- [Quit teardown can livelock](quit-teardown-can-livelock-the-app.md) records the other direction of the same single-thread exposure, where every `setTimeout` guard on the teardown path is decorative against a spin.
- [just-bash upstream](../architecture/just-bash-upstream.md) carries the interpreter-side issues, including the `find` abort noted above.
