# Carry the just-bash python worker fixes as a local patch until they are released

Date: 2026-09-10

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md) a fourth time, alongside [2026-09-08-carry-the-find-patch.md](2026-09-08-carry-the-find-patch.md), [2026-09-09-carry-the-stat-patch.md](2026-09-09-carry-the-stat-patch.md), and [2026-09-10-carry-the-cross-mount-copy-patch.md](2026-09-10-carry-the-cross-mount-copy-patch.md).

## Context

[2026-09-10-python-is-the-sandboxed-interpreter.md](2026-09-10-python-is-the-sandboxed-interpreter.md) makes just-bash's WebAssembly CPython the default `python`. As shipped in 3.4.1 it could not be: every run exited 1 in this repository's install layout, because the worker's own file path is what Emscripten hands CPython as its program name and at a pnpm patch-hash path's length `Py_FinalizeEx` aborts after the script has finished ([finding](../findings/the-wasm-python-aborts-at-exit-on-some-install-paths.md)). An agent reads exit 1 as its script failing. That alone blocks the default; three more faults found beside it each cost the agent a wrong lesson: a traceback that names `/tmp/_jb_script.py` at a line 400 past the script's own, a file over the bridge's 8 MB that retries into "No file descriptors available" because the errno table has `EFBIG` as Emscripten's `EINTR`, and a read-only mount reported as an I/O error.

The other three patch parts each mirror an upstream PR. This one mirrors three, opened the day after (vercel-labs/just-bash#423, #424, #425), and differs from them in a second way: it is not restoring a command's documented behavior but making the runtime usable at all, from a bug whose trigger upstream's CI cannot reach.

## Options weighed

**Wait for upstream.** No fix existed to wait for when the default shipped; the three PRs went up the next day, and `minimumReleaseAge` puts any release carrying them at least a week out.

**Skip finalization.** Ending the wrapper with `os._exit()` instead of `sys.exit()` avoids the abort and was measured to work. Rejected: it skips every finalizer, so a file the script left open is never flushed, which turns a class of correct scripts into silent data loss to avoid a crash in a class that already produced its output.

**Wrap it from our side.** The `python` command already post-processes the runtime's stderr. It could rewrite the line numbers (the wrapper's offset is `399 + <env var count>` in 3.4.1) and treat the exit-1 as exit 0 when the abort text is present. Rejected: guessing the real exit code from stderr is exactly the kind of workaround that outlives its bug, and the offset arithmetic breaks on any wrapper change upstream makes.

**Patch the worker bundle.** Chosen. `dist/bundle/chunks/worker.js` is an unminified esbuild bundle, so the four hunks are readable and re-apply by hand on a version bump, and the change is the one to offer upstream in the same shape.

## Decision

Carry the `python3` worker part of `patches/just-bash@3.4.1.patch`: pin `thisProgram` (#423), correct `EFBIG` and map the bridge's oversize and read-only failures to their errnos (#424), and run the program through `compile()` under its own name (#425). Drop each hunk when the version we install carries its PR; `create-bash-env-python.test.ts` fails on the exit code, the traceback shape, and the errno the moment the patch stops applying.
