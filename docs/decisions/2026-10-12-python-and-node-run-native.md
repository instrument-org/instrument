# `python` and `node` run native, and the WebAssembly runtimes are gone

Date: 2026-10-12

> The `tools` global is superseded by [2026-10-27-scripts-reach-instrument.md](2026-10-27-scripts-reach-instrument.md): scripts in `node` and `python` reach `instrument`, and `tools` is gone.

Supersedes [2026-09-10-python-is-the-sandboxed-interpreter.md](2026-09-10-python-is-the-sandboxed-interpreter.md). Carries out [plans/completed/native-script-runtimes.md](../plans/completed/native-script-runtimes.md).

## Context

The shell had two of each runtime. `python`/`python3` were CPython compiled to WebAssembly and `js-exec` was QuickJS, both run by just-bash over its virtual filesystem; `python-native` and `node` were real processes. The WebAssembly pair existed because a real process could not be handed a host path: native commands saw only the chat's folder, so the only Python that could read an attached folder in place was the one inside the sandbox.

[The agent works at real paths](2026-10-11-the-agent-works-at-real-paths.md) removed that reason. Native commands get paths as the agent typed them and are held to the Permissions rules by Seatbelt on macOS and bubblewrap on Linux, so `python-native` reads a folder in place exactly as the WebAssembly Python did. What was left of the pair was its cost: no packages, no `ssl`, no processes, an 8 MB read limit (about 6 MB for `js-exec`), a layer that guessed from a script's imports which interpreter it needed, failure explainers for every limit, and three just-bash patch parts carried for the Python worker.

## Options weighed

**Keep the WebAssembly Python as the default.** Rejected: its one advantage over the native interpreter, reading a folder in place, is gone, and every limit it has sends real work to the other interpreter by way of an error message.

**Keep `python-native` as an alias.** Rejected: an alias is a second name the agent has to learn means the same thing, and the session baseline bump retells every open chat anyway.

**Keep `js-exec` for its `tools` global.** `js-exec` was where a script called a connected app's tools as values. Rejected in favor of giving `node` the same global, so the agent has one JavaScript and nothing to choose between.

**Reach app tools from `node` through the workspace server.** Rejected: it would add a port, a token, and a loopback rule to the sandbox for something only the agent's own `node` needs. The child's IPC channel needs none of them, and a call can only come from a process the `node` command started.

**Name the global `instrumentTools`, or make scripts import it.** Rejected: `tools` is the name `js-exec` taught and the `app` command's help uses, and an explicit import is one more thing to get right in every script. The preload keeps the plain name narrow instead (below).

## Decision

- `python` and `python3` run the chat's virtualenv interpreter, under the same `execShim` sandbox as every other native command. `pip` installs where `python` runs, so nothing tells the agent which interpreter sees what. `python-native` is deleted, with no alias.
- `js-exec` is deleted. `node` is the one JavaScript.
- just-bash's runtimes are switched off (`python` and `javascript` leave `createBashEnv`), and with them the QuickJS bootstrap, the failure explainers, the standard-library name table, import sniffing, the skill-script carve-out, and the 30-minute script timeout. The `python3` patch parts are inert and go at the next rebuild of the patch ([just-bash-upstream.md](../architecture/just-bash-upstream.md)).
- `node` scripts get a `tools` global: `await tools.<slug>.<tool>({...})` calls a connected app's tool through the checks `app call` makes and returns the result as a value, throwing a refusal with its message. The `node` command spawns the script with an IPC channel and passes `--import` with a preload, which it writes into the app's node-tools folder (readable inside both sandboxes) whenever the file there differs. The preload defines `tools` only when `globalThis.tools` is undefined, as a non-enumerable, writable, configurable property, and references the channel only while a call is waiting, so a script that never calls a tool exits when its own work is done. A process the script starts has no `tools`.

## What it costs

- The first Python run on a machine needs the network to fetch uv's managed interpreter. `python-native` already had this cost; the WebAssembly Python worked offline.
- Every script pays a sandboxed spawn, about 6 ms under `sandbox-exec` on top of the interpreter's start, and every `node` script also loads the preload.
- Windows has no native sandbox yet, so it loses the only rule-bound Python it had.

## What would change it

A Windows sandbox closes the last gap. If a package an agent installs turns out to read an undeclared `tools` global, ours moves behind an explicit import.
