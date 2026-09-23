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

## Going native moves the cost rather than removing it

The walk is only the first half. What the walk returns crosses back into the main process, and just-bash pipelines do not stream: each stage runs to completion and its entire stdout is buffered as one JavaScript string before the next stage starts.

So `rg --files /mnt/Home | awk '...'` stalls the window for about as long as the JavaScript `find` above, for a different reason. The walk is free, in ripgrep's own process. Then main allocates one string holding every path, and a JavaScript `awk` visits every line of it. Measured against a real home directory:

```
rg --files ~   →  1,478,220 lines   194,036,698 bytes   (185 MiB)
```

That is nearly three times the 64 MiB `maxOutputSize` in `create-bash-env.ts`, so that call fails outright. A listing under the ceiling succeeds, and the window stops painting while it is carried. `rg --files` over three large folders under `~/Library` prints about 49 MB; piped into `rg -i` or even `head -1`, it froze the thread for 7.9 s and grew the heap by 2.1 GB, where the same search filtered inside ripgrep with `--iglob` took 26 ms. Profiled, none of that is the walk. It is the passes over the string, each linear in its size: the URL-credential regex in `filterShellOutput`, execa escaping the whole output into the error message it builds for rg's exit 2, `virtualizeOutput`, just-bash's handoff to the next stage, and the garbage collection behind all of them.

So `rg` stops itself after 8 MB of stdout (`RG_MAX_STDOUT` in `shell-commands/rg.ts`) and answers with an error that names `--iglob` and `-g`, which puts the fix in front of the agent at the moment it needs it. The prefix it wrote is dropped rather than returned, since a downstream filter over it would read as a complete answer. The same pipeline then stalls 322 ms and grows 115 MB. The bash description also tells the agent to filter names inside `rg` rather than in a pipe.

Two consequences worth keeping separate:

- **Making the file walk native is a partial fix, not the fix.** It removes the syscall storm and leaves the string. The pipeline is an interpreter change, not a command change.
- **The prompt steers the agent into this path.** The attached-folders text tells the model to reach for `rg` on a large folder, which is correct advice about the walk and silent about the output. Anything that tells the model to prefer `rg` has to tell it to bound the result in the same breath.
- **The real fix is streaming pipes.** vercel-labs/just-bash#415 is the issue (a stage cannot end its producer), and #453 streams simple pipelines with a 64 KiB buffer and backpressure, with custom commands opting in through `streaming: true`. `rg` would stream only after a follow-up to it; until one is installed, the cap stands.

## The budgets, and which one you are looking at

There are two, both defaulting to 1,000,000, with different messages that are easy to confuse:

| limit | what it counts | message |
| --- | --- | --- |
| `maxTraversalWork` | operations, charged 1 each by `checkpoint()` and `count` at once by `discover()` | `filesystem traversal work limit exceeded` |
| `maxTraversalEntries` | entries visited | a distinct entry-limit message |

`create-bash-env.ts` sets both to 300,000 for a task's shell and 20,000 for the orchestrator's; `maxTraversalDepth` is unset. Hitting either returns nothing, because the stage buffers rather than streams, so there is no partial output to show for it.

Both count entries, not time, and what an entry costs depends on the command, the tree and the platform, so one number buys very different stalls. Measured 2026-09-22 against one attached macOS home directory of about 8M files, every row ending at the same 300,000 with the same empty result:

| command | time to the budget |
| --- | --- |
| `find -name '*.md'` | 3.5s |
| `ls -R`, with the local `ls` patch | 22s |
| `du -sh`, the builtin | 28s |
| `grep -r` | 48s (`maxGlobOperations`) |
| `ls -R`, stock 3.4.1 | 367s, 223s of CPU, 3.6 GB |

The same `find` medians 80ms on macOS and 561ms on Windows across the production record, and in one Windows session four `find` calls over `/mnt/Home` and `/mnt/D:` outlived their `yieldMs` and were promoted to background jobs, still walking after the agent had moved on. That is why the orchestrator's budget is fifteen times smaller: its shell only reads what tasks produced, it holds the user's whole home folder, and a walk worth more than 20,000 entries is a task's to do.

Stock `ls -R` was the outlier for two reasons, both in upstream `ls` and both carried as a local patch (see [just-bash upstream](../architecture/just-bash-upstream.md)). Its output accumulator re-measured everything written so far on every append, which made `ls -l` on one 20,000-entry directory take two minutes on its own. And 3.4.1's `ls` charges the budget once per directory entered rather than once per name read, so a recursive listing stops after about 300,000 *directories*, more than half of a home folder, where `find` stops after 300,000 names. awk's `printf` had the same accumulator shape: 42 seconds for 40,000 records where `print` takes 0.15.

`du` no longer takes that row's path. `shell-commands/du.ts` walks the real directories behind the mounts in a worker thread, so the main thread only receives the finished text: over a 337,000-file folder it answered in 37 seconds, matching the system `du` to the KiB, with event-loop delay and the 1 KB read probe at their idle values the whole time, where a builtin `find` over the same folder pushed the read p99 to 112 ms in 4.5 seconds. It is the shape the rest of the traversal builtins would take off the main thread one at a time, short of moving the agent turn.

When `find` hit a limit over a real mount, every directory read still in flight in its batch settled after the command had returned, and each became an unhandled rejection: 25 per refused `find` over a large folder. The cause is upstream, in `find` and just-bash's defense-in-depth box together, and is patched locally as vercel-labs/just-bash#451 (see [just-bash upstream](../architecture/just-bash-upstream.md)). Studio's crash-diagnostics handler only logged them, but a Node host with no handler exits on the first.

The output ceiling is ours and was raised deliberately: it went from just-bash's 10 MB default to 256 MiB to fix agent work that needed the headroom. Lowering it is therefore a partial revert, and wants to know what needed 256 MiB before picking a smaller number.

One more lever on the mechanism above: `allowSymlinks: true` would drop the per-operation cost from a `realpathSync` plus an `lstatSync` to one call. It also gives up the no-symlink-escape guarantee the sandbox rests on, so it is a threat-model decision rather than a free win.

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

Two cheaper mitigations are real but partial, and both are worth doing regardless because they shrink the exposure before the boundary lands. Lowering the two traversal budgets and the output ceiling bounds what a single call can cost, and is a few lines in `create-bash-env.ts`. Giving the file walk the native treatment `rg` already has removes the syscall storm, using the `resolveReadOnlyHostPath` seam and the obligations that come with it, but leaves the buffered result above, so it is the larger piece of work for the smaller share of the stall.

## Related

- [A watchman probe froze boot on Windows](windows-watchman-probe-freezes-boot.md) is the same class with a different cause, and its lesson applies here: a freeze that shows "Not Responding" is the main process. It also names the instrument this finding needed and did not have, a main-thread stall watchdog, scoped in [privacy-first-diagnostics-and-feedback](../plans/active/privacy-first-diagnostics-and-feedback.md).
- [Quit teardown can livelock](quit-teardown-can-livelock-the-app.md) records the other direction of the same single-thread exposure, where every `setTimeout` guard on the teardown path is decorative against a spin.
- [just-bash upstream](../architecture/just-bash-upstream.md) carries the interpreter-side issues, including the `find` abort noted above.
