# The WASM Python aborts at exit on some install paths

**Status:** contained 2026-09-10, not yet reported upstream. Found on `just-bash@3.4.1` (vendored CPython 3.13.2, Emscripten) while wiring the sandboxed `python`. Carried as the fourth part of `patches/just-bash@3.4.1.patch` (see `docs/decisions/2026-09-10-carry-the-python-worker-patch.md`), guarded by `create-bash-env-python.test.ts`. The repro below is what to file; the first sentence of the upstream issue should be that their CI cannot see it because the trigger is the length of the worker's own file path.

Every `python3` run in this repository exited 1, including `python3 -c "print('hi')"`, with the right stdout followed by:

```plaintext
Fatal Python error: gilstate_tss_clear: failed to clear current tstate (TSS)
Python runtime state: finalizing (tstate=0x00289198)

Aborted()
python3: Security violation: webassembly
```

Upstream's own tests assert exit 0 for the same command and pass in their CI, and a fresh `npm install just-bash@3.4.1` on a Windows machine ran it clean, which is what made it look platform-specific.

## What it was

The abort is in `Py_FinalizeEx`, after the script has finished. `gilstate_tss_clear` calls `pthread_setspecific(autoTSSkey, NULL)`, and under Emscripten's single-threaded pthread stub that returns `EINVAL` only when the key is no longer marked in use. Which means something in finalization freed the key early, or corrupted the slot, and the difference between a run that does and one that does not is the initial heap layout.

What decides the layout is the environment block and `argv[0]` that Emscripten hands `main()`. Both come from `thisProgram`, which the Node glue sets to `process.argv[1]`, and in a worker thread that is the worker script's own absolute path: `dist/bundle/chunks/worker.js` under wherever the package is installed. A pnpm install path with a patch hash, `node_modules/.pnpm/just-bash@3.4.1_patch_hash=<64 hex>/node_modules/just-bash/dist/bundle/chunks/worker.js`, is 200 characters. Placing the same file at paths of different lengths and running the same script:

| worker path length | outcome |
| --- | --- |
| 60 to 190 | exit 0 |
| 194 to 220 | abort at finalization, exit 1 |
| 240 to 289 | exit 0 |

The same window shows up when the path is held fixed and `thisProgram` is set directly: 7, 16, 50, 100, and 150 characters pass, 200 aborts. Nothing about the script matters; `pass` aborts too. Nothing the script allocates matters either: a run that builds a 20,000-element set or a 5,000-key dict at a passing length still passes. Upstream CI installs under a short path, and so does a plain `npm install`; a pnpm workspace with a patched dependency is what lands on 200.

The `Security violation: webassembly` line is a consequence, not a cause: Emscripten's `abort()` constructs `new WebAssembly.RuntimeError(...)`, and just-bash's worker defense-in-depth blocks the `WebAssembly` global after CPython loads, so the abort's own error is what the worker reports.

## What was tried

- Running the vendored `python.cjs` directly, outside just-bash, in the main thread and in a worker: passes. This was the false lead; it passes because the driver script's path is short.
- Disabling the worker's defense-in-depth, the HOSTFS and HTTPFS mounts, the stdin hook, the setup shims, and the bridge one at a time: still aborts. None of them is involved.
- Node 22.21, 24.14, 24.15, 24.18, and V8's `--liftoff-only`, `--no-liftoff`, and `--no-wasm-tier-up`: no change. It is not a tiering or codegen difference.
- Logging every wasm import call in a passing and a failing run: the sequence of calls is identical up to the flush that precedes finalization, and the first divergence is the pointer `malloc` returns for the `_Py_emscripten_runtime` string, which is heap layout.
- Replacing `sys.exit()` at the end of the wrapper with `os._exit()`: avoids the abort by skipping finalization, at the cost of never flushing files the script left open. Rejected in favor of the pin.

## What resolves it

Passing `thisProgram: "python3"` in the `createPythonModule` config takes the install path out of CPython's input. The other three faults found alongside it went into the same patch part: the errno table's `EFBIG` is 27, which is `EINTR` under Emscripten's numbering, so a file over the bridge's 8 MB (or upstream's 8 MB default `maxFileSize`) made CPython retry the `open()` forever while each attempt leaked the descriptor the failed open allocated, ending in `EMFILE` after a few thousand; tracebacks named `/tmp/_jb_script.py` at a line offset by the 400-line wrapper for `-c` code and script files alike; and a read the bridge could not carry surfaced as `ENOENT`, a write into a read-only mount as `EIO`.

The underlying bug is in the vendored CPython build or Emscripten, since a program name of one length should not decide whether finalization succeeds, and the pin only stops the one input we control from landing in the window. If it recurs at a different trigger, `create-bash-env-python.test.ts` fails on the exit code, and `os._exit()` plus an explicit `Module.FS.quit()` is the fallback that was measured to work.
