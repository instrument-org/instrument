# `python` is the sandboxed interpreter, `node` stays native, and each names the other

Date: 2026-09-10

Carries out [plans/completed/sandboxed-script-runtimes.md](../plans/completed/sandboxed-script-runtimes.md).

## Context

The agent had one Python and one Node, both real processes, and neither could see an attached folder: every mount path is quarantined before a subprocess spawns, because a mount's host path must never reach a process that could act on it. So a task asked to analyze an attached 2.2 GB folder copied the whole thing into `work/` first, to run nine lines of standard-library Python over it.

just-bash ships two runtimes that need no such copy, because every file call they make goes through the same virtual filesystem the shell uses: CPython 3.13 compiled to WebAssembly (`python3`) and QuickJS with Node-compatible built-ins (`js-exec`). We had enabled neither. Across 753 transcripts, 6,765 throwaway Python scripts carried imports and 95.2% of them were standard-library only; the tail that needed a package was imaging and media. The equivalent JavaScript number was not measurable from the corpus, but the probe that mattered was: `js-exec` resolves no `node_modules` at all, not even a package that `pnpm add` just installed.

## Options weighed

**Invert both.** Make `python` and `node` the sandboxed runtimes, with native twins under longer names. Rejected for JavaScript: the ecosystem is package-centric by culture, `js-exec` cannot reach a package under any name, and the failure would arrive immediately after a `pnpm add` the agent watched succeed.

**Invert neither, add both under new names.** Ship `python-sandboxed` and `js-exec` beside the natives. The conservative shape, and the one the plan staged first. Rejected as the end state because it leaves the 95% case behind the longer name, and the measured problem was the default.

**A flag instead of a name** (`python --native`). Rejected: a containment-relevant switch that looks like a formatting option, and one `which` cannot discover.

**`uv run python` as the escape hatch.** Already meaningful and already native, but with no symmetric spelling for Node. Rejected for the asymmetry.

**Invert Python, add JavaScript.** Chosen. One default changes, and it is the one with the measurement behind it.

## Decision

- `python` and `python3` are the sandboxed CPython. They read `/mnt/...` and `/task/...` as written, honor read-only mounts, and have the standard library minus the C extensions the build omits. `python-native` is the interpreter in the task's virtualenv, the one that runs what `pip` installed and any native binary, and sees only the task folder.
- `node` is unchanged. `js-exec` is added beside it for reading attached folders with built-ins only.
- A loaded skill's script under `work/skills/` runs natively under `python` too: a skill declares the dependencies its scripts import, and `LoadSkill` installed them into the virtualenv, so inverting the default without this would have broken every shipped skill that imports one. The carve-out keys on the path, decided at the command, and the mount guard reads the same test so a skill script is told to copy in rather than sent back to `python`.
- The failures teach. A missing package names `pip` and `python-native`; a standard-library module the build lacks is told apart from a package by `sys.stdlib_module_names`; `subprocess`, `https`, an oversize read, and the run-time cap each say what to do instead; `pip` says after every install which interpreter can use it; and the native hatches' mount guards offer the sandboxed twin before copy-first.
- No automatic fallback from a failed import to the native interpreter. The two have different containment, so a silent switch would let an `ImportError` decide whether a script gets host file descriptors, and it fails confusingly in the common direction: a script that reads `/mnt` and then imports `yaml` would be re-run somewhere `/mnt` does not exist.

## What would change it

The JavaScript default inverts if a measurement of throwaway JavaScript scripts shows a Python-like distribution and `js-exec` grows package resolution; it is a one-line change made on evidence. The 8 MB per-read bridge limit is the constraint most likely to send real work back to `python-native`, and chunked reads across the bridge upstream would remove it.
