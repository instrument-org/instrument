# Plan: sandboxed script runtimes as the default

Status: landed 2026-09-10, all phases, in the end state the plan recommends: `python`/`python3` are the sandboxed CPython, `python-native` is the virtualenv interpreter, `js-exec` is added beside an unchanged `node`, the skills carve-out and the three teaching failures shipped in the same change, and every prompt surface that said "copy into the task first" now says which runtime reads a mount. Phase 0 found that both Python faults below were misdiagnosed (see "What is broken, revisited") and fixed them in the fourth part of the just-bash patch rather than waiting on upstream; the upstream issue is drafted in the finding and not yet filed. Decision: [decisions/2026-09-10-python-is-the-sandboxed-interpreter.md](../../decisions/2026-09-10-python-is-the-sandboxed-interpreter.md). Written 2026-09-10 from a transcript review, with probes recorded below.

## What is broken, revisited

Recorded after the fact so the probes below are read against what they turned out to mean.

- **Every invocation exits 1** was real but not platform-specific. The trigger is the length of the worker's own file path, which Emscripten hands CPython as its program name; a pnpm patch-hash install path is 200 characters, inside a window where `Py_FinalizeEx` aborts. Upstream CI and a short `npm install` never see it. Pinning `thisProgram` fixes it; [findings/the-wasm-python-aborts-at-exit-on-some-install-paths.md](../../findings/the-wasm-python-aborts-at-exit-on-some-install-paths.md) has the bisection.
- **`open()` cannot reach a mount** was wrong. `open('/mnt/ro/f')` works; the probe file was 9.5 MB and the worker bridge carries 8 MB per read, and the shim reported that as ENOENT. With the patch it is `OSError: [Errno 22] File too large`, and the command appends what to do. The 8 MB limit itself is a fixed buffer in upstream's protocol and stands; it is the open question below about `SANDBOX_MAX_BYTES`, answered: no, the bridge is the bound, whatever `maxStringLength` says.
- **`import sqlite3` fails** because the build omits the C extension, as do `ssl`, `ctypes`, `lzma`, `readline`, and `curses`; `multiprocessing` imports and fails at call time like `subprocess`. The `python` command tells all of these apart from a missing package by checking `sys.stdlib_module_names`, which is the "fourth error message" the subprocess section asks for.
- **The 30 second timeout** is raised to 30 minutes for both runtimes; a call that outlives its `yieldMs` is promoted like any other, and the cap only bounds a runaway.
- Also found: tracebacks named `/tmp/_jb_script.py` at a line 400 past the script's own, fixed in the same patch part by running the program through `compile()` under its own name; and the worker's errno table had `EFBIG` as Emscripten's `EINTR`, so an oversize read retried until `EMFILE`.
- **The native Python is called `python-native`.** The placeholder held: it names the mechanism, pairs with `python`, and `pip` says it after every install.

## The bet

`python` becomes the **sandboxed** WebAssembly runtime, which reads attached folders directly and cannot escape the virtual filesystem. The native interpreter stays, renamed, as an explicit escape hatch for the minority of scripts that need installed packages or native binaries. The failure in each direction is what teaches the agent about the other one.

JavaScript gets the same runtime under a new name but keeps its default, for a reason the probes turned up and the section below explains.

Today the agent has one Python and one Node, both native, and neither can see a `/mnt` path at all. That is why a task asked to analyze an attached 2.2 GB folder copied the whole thing into `work/` before it could parse it, to run nine lines of pure standard library.

## What is already true

| | Verified | How |
| --- | --- | --- |
| just-bash ships `js-exec`, a QuickJS runtime with Node-compatible `fs`/`path`/`process`/`fetch` | yes | `registry.ts:520`, behind a lazy import gated on the `javascript` flag |
| just-bash ships `python3`, real CPython 3.13.2 compiled to WASM in a worker thread | yes | `commands/python3/python3.ts`, gated on the `python` flag |
| Both resolve every file call through `ctx.fs`, the same `MountableFs` the shell uses | yes | `js-exec` fs module is a thin wrapper over `ctx.fs`; python3 bridges over SharedArrayBuffer |
| A read-only mount stays read-only inside them | yes, for `js-exec` | probe: `writeFileSync('/mnt/ro/evil')` returns `EROFS`, `readFileSync` of the same mount works |
| The CPython payload already ships in every Studio build | yes | 9.9 MB at `just-bash/vendor/cpython-emscripten`; `electron-builder.ts` excludes `quickjs-emscripten` by name and says nothing about the vendor directory |
| We enable neither | yes | `create-bash-env.ts` passes no `python` or `javascript` option |

The build comment claiming `js-exec` is "absent from the command registry just-bash builds" is wrong and should be corrected in the same change that re-includes quickjs.

## What is measured

Every throwaway Python script across all 753 JSONL transcripts under `~/.claude/projects`, classified against `sys.stdlib_module_names` for 3.13. "Throwaway" means inline `-c` code or a `.py` file written under a scratch, tmp, or work path.

| | count | share |
| --- | --- | --- |
| scripts carrying imports | 6,765 | |
| stdlib-only | 6,437 | **95.2%** |
| needs a package | 328 | 4.8% |

Top imports are `pathlib` (3,592), `json` (1,084), `re` (691), `io` (613), `sys` (515). All present in CPython-on-WASM. The genuine third-party tail is `PIL` (83), `PostalMime` (39), `faster_whisper` (8), `yaml` (6): image and media work, which keeps the native runtime.

**The equivalent JavaScript number does not exist**, and a naive count says 71% of `.ts`/`.js` files need a package, but most such files in this corpus are source for this repository (vitest suites, React components) rather than throwaway analysis, so that number is measuring the wrong population.

It also matters much less than it looked, because `js-exec` resolves no `node_modules` at all. Where Python's standard library covers 95% of what the agent writes, Node's builtins cover a far narrower slice of a package-centric ecosystem, and the sandboxed runtime cannot reach a package even after `pnpm add` succeeds. **The two languages should not get the same treatment**, and the recommendation below splits them.

## What is broken

Probed 2026-09-10, macOS arm64, Node 24.15, `just-bash@3.4.1`, against a `MountableFs` assembled the way `workspace-fs-layout.ts` assembles one.

**`js-exec` passed every containment and correctness probe.** Reads a read-only mount (9.5 MB file, 116ms), refuses to write to one with `EROFS`, writes to `/task`, exits 0 on success and non-zero on a throw, starts in 10 to 110ms. Two warts: inline TypeScript stripping failed on `-c` in 3.4.1 (`const n: number = 41` reports "missing initializer for const variable"), and **it does not resolve `node_modules`**:

```plaintext
$ js-exec -c "const lp = require('leftpad'); console.log(lp(7,3))"
Cannot find module 'leftpad'. Run 'js-exec --help' for available modules.
```

Documented builtins and relative files only, with a real package sitting in `/task/node_modules`. This is the finding that reshapes the Node half of the plan; see below.

**`python3` is not shippable.** Two independent faults:

1. **Every invocation exits 1**, including `python3 -c "print('hi')"`. Stdout is correct, then the interpreter aborts during teardown with `Fatal Python error: gilstate_tss_clear: failed to clear current tstate (TSS)` followed by `python3: Security violation: webassembly`. An agent reads exit 1 and concludes its script failed.
2. **`open()` cannot reach a mount.** `os.listdir('/mnt/ro')` works and returns the right entries, but `open('/mnt/ro/f')` raises `FileNotFoundError: [Errno 44] ... '/host/mnt/ro/f'`. The interpreter's `_redir_open` shim prefixes `/host` and does not understand mounts outside the task root, so directory listing crosses the bridge and file opening does not.

Also seen: `import sqlite3` fails, and one probe hit the 30 second timeout. Upstream HEAD is 3.4.2 with no changelog entry touching any of it, so a version bump should not be assumed to fix it. Whether these are platform-specific is untested and is the first thing to establish.

**`subprocess` imports and then fails at call time**, which is the worst shape a limitation can take:

```plaintext
$ python3 -c "import subprocess; print('imported ok')"
imported ok
$ python3 -c "import subprocess; subprocess.run(['echo','hi'])"
Traceback (most recent call last): ...
```

53 of the measured scripts import `subprocess`. A capability check that passes and then throws cannot be worked around by an agent reading the module list, so this needs a fourth error message rather than a documentation line.

## Invert Python, add JavaScript

The plan opened by treating the two languages alike. The `node_modules` probe says they are not alike, and the split is the main recommendation to carry into implementation.

**Python inverts.** The standard library is 95.2% of what the agent writes, the runtime bundles a complete one, and the tail that needs a package is small and recognizable (imaging, media). Making `python` the sandboxed runtime moves the common case onto the shorter name and onto direct mount access.

**JavaScript does not invert; it gains a command.** `js-exec` cannot reach an installed package, and the JS ecosystem is package-centric by culture rather than by exception, so a sandboxed `node` would fail on a large and unmeasured share of what the agent writes, immediately after a `pnpm add` it just watched succeed. Ship `js-exec` under its own name for the specific job it is unbeatable at, which is reading attached folders, and leave `node` native. If the throwaway JavaScript measurement later shows a Python-like distribution, inverting is a one-line change made on evidence.

This also halves the risk of the whole plan: one default changes rather than two, and the language whose default changes is the one with the measurement behind it.

## The command surface

The design question is what the agent types, and how it finds the other runtime at the moment it needs it.

| | `python` (sandboxed, new default) | `python-native` (escape hatch) | `js-exec` (new, additive) | `node` (unchanged) |
| --- | --- | --- | --- | --- |
| Reads `/mnt` attached folders | yes, directly | no, guard fires | yes, directly | no, guard fires |
| Read-only mounts enforced | by our filesystem, not the OS | not applicable | by our filesystem | not applicable |
| Third-party packages | no, standard library only | yes, via `pip` | **no, not even installed ones** | yes, via `pnpm` |
| Native binaries (ffmpeg, uv) | no | yes | no | yes |
| Reachable scope | whole virtual filesystem | task folder only | whole virtual filesystem | task folder only |
| Startup | 150 to 250ms | venv resolution | 10 to 110ms | module resolution |

One renamed command and one new one, against a list that already carries roughly forty. The count is not the oversaturation risk; the ambiguity is. Two commands whose names differ by one suffix and whose **security properties differ** must never appear in help output, `which`, or a prompt without the one-line difference beside them.

### Naming alternatives considered

- **A flag (`python --native`).** Zero new names, but it cannot be discovered with `which`, and it makes a containment-relevant switch look like a formatting option. Rejected.
- **Reusing `uv run python`.** Already meaningful and already native, but there is no symmetric spelling for Node, and it leaves the escape hatch spelled differently in the two languages. Rejected for asymmetry.
- **Keeping `python` native and adding `python-sandboxed`.** The conservative inversion. It is what the additive staging below does as an intermediate step, but as an end state it puts the 95% case behind the longer name.

## The three failures that have to teach

This is the whole ergonomic bet. Each failure is a signpost to the other runtime, and the wording is the deliverable, not an afterthought.

**Sandboxed hits a missing package.** `ModuleNotFoundError: No module named 'numpy'` must become: numpy is not in the standard library, which is all this runtime has; install it with `pip install numpy` and run the script with `python-native`, which can use installed packages but only sees the task folder.

**Native hits a mount.** The existing `attachedMountLiteralError` in `shell-commands/utils.ts` currently says "copy the file into the task first". Once a sandboxed runtime exists it should say: run this with `python`, which reads attached folders directly, and copy into the task only if you need an installed package.

**`pip install` is followed by the wrong interpreter.** This is the sharpest trap in the whole plan: `pip install requests && python -c "import requests"` works today and breaks the moment `python` is sandboxed. `pip` must print, on success, that the package went into the native environment and name the command that can use it. Anything less produces a failure whose cause is three commands upstream.

### No automatic fallback

Do not retry natively when a sandboxed run fails on an import. The two runtimes have different containment properties, so a silent switch lets a failed import decide whether a script gets host file descriptors. It also fails confusingly in the common direction: a script that reads `/mnt` and then imports `yaml` would be re-run in a runtime that cannot see `/mnt` at all, turning a clear ImportError into a mysterious file-not-found. Keep the switch explicit and make the error carry it.

## The blast radius nobody asked about: skills

A skill is its own package with its own `node_modules` and its own declared dependencies, and its scripts run from `work/skills/<name>/`. If `python` and `node` silently become the WASM runtimes, **every skill script that imports a declared dependency breaks**, without anyone editing a skill. That is not an escape-hatch problem the agent can reason its way out of; it is a regression in shipped functionality.

The mitigation is available and cheap: a skill that declares dependencies has already told us it needs them, so scripts running from a skill directory should resolve `python` and `node` to the native interpreters. Detection can key on the `work/skills/` path prefix or on the presence of a `package.json` with dependencies beside the script. This has to land in the same change as the inversion, not after it.

## Sequencing

**Phase 0, verification. Nothing ships.**

- Establish whether the two `python3` faults reproduce on Linux and Windows or are macOS-specific. If they are ours alone, the fix may be local.
- File both upstream with the repro above; the payoff is gated on someone fixing them.
- Run the JavaScript equivalent of the Python measurement, restricted to throwaway scripts. This decides whether `node` ever inverts; it is not needed to ship `js-exec` additively.

**Phase 1, additive. Both runtimes ship under explicit names, defaults unchanged.**

Enable `python: true` and `javascript: true`, re-include the quickjs bytes in the build, and expose the sandboxed runtimes under names that cannot be mistaken for the existing ones. Nothing regresses, because nothing that works today changes. This is the step that produces evidence about what the agent actually reaches for, and it is worth taking even if the inversion never happens.

**Phase 2, inversion.** Swap the default names, rename the native interpreters, land the skills carve-out and all three error messages in the same change. Gated on Phase 0 clearing Python and on Phase 1 showing the agent uses the sandboxed runtime when it is available.

**Phase 3, prompt and guidance.** Every prompt and error that currently teaches "copy into the task first" is wrong for the 95% case once this lands. `build-attached-folders-text.ts`, the task-folder section of the system prompt, and the `unreachablePathArgError` family all carry that advice.

## Open questions

- Does the 30 second Python timeout need to be configurable per call? A multi-gigabyte parse is plausible work and 30 seconds is not obviously enough. `maxJsTimeoutMs` has an equivalent on the JavaScript side.
- Does the sandboxed Python inherit our 256 MB `SANDBOX_MAX_BYTES`, or the 8 MB default seen in an unconfigured probe? A single `read()` of a large mounted file is exactly the case this plan exists to serve, so this needs checking rather than assuming.

Answered while writing this, recorded so nobody re-runs them: `js-exec` resolves no `node_modules` (builtins and relative files only); `subprocess` imports in the WASM Python and throws when called; `threading` and `socket` import; `sqlite3` does not.

Settled: the native interpreter is called **`python-native`**, which is what the tables above use.
