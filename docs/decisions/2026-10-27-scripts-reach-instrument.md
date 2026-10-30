# Scripts reach `instrument`, and the `tools` global is gone

Date: 2026-10-27

Supersedes the `tools` part of [2026-10-12-python-and-node-run-native.md](2026-10-12-python-and-node-run-native.md). Carries out phase 1 of [plans/one-capability-layer.md](../plans/one-capability-layer.md).

## Context

A `node` script had a `tools` global that made `instrument app call` and nothing else: MCP app tools only. An API app (every Google app) went through `instrument app request`, which no script could reach, because the hook that answered `tools` took no chat or session and `request` needs the session to know whether the app's guide is in the context window. Python reached nothing, and a Python script that ran `instrument` with `subprocess` found no program by that name: the baseline evals saw that in all six Python trials, each paying three or four extra steps to fall back to the shell.

## Options weighed

**Keep `tools` beside a new name.** Rejected: two names for one thing is one more thing the agent has to learn means the same, and the owner wanted one name everywhere. `tools` is deleted with no alias.

**Answer scripts through the workspace server.** Rejected for the reason the 2026-10-12 record gave: a port, a token and a loopback rule in the sandbox for what only the command's own process needs. The per-process loopback channel `tools` used stays, with a new protocol.

**Asynchronous Python.** Rejected for now: the agent's scripts are short and sequential or a thread-pool fan-out, and `asyncio` would make every one of them wrap its calls. A call opens its own connection, so calls are safe from threads.

**Hand-written script bindings per capability.** Rejected: a capability is defined once (`lib/capabilities/`), and the CLI, the Node global and the Python module are generated from its schema and the registry's describe answer, so a capability added later reaches every surface without code in each.

## Decision

- One name, `instrument`: the shell's command, the Node global and the Python module. A `node` script gets an `instrument` global from its preload; a `python` script imports `instrument`, which a `.pth` in the virtualenv that runs (the chat's, or a skill's environment) puts on `sys.path`, or, for the managed Python run bare, whose `PYTHONPATH` folders run no `.pth`, a `sitecustomize` ahead of it.
- The channel carries `{ id, capability, args }` and one `describe` request, answered by the registry's dispatcher with the bash call's chat, session, model and role, which the script never names. An error comes back with its kind (`refused`, `ask`, `card`, `read-first`, `failed`), and each runtime raises the matching class: `instrument.Error`, `NeedsPermission`, `CardShown`, `ReadGuideFirst`.
- A script's first request to an API app whose guide is not in the window sends nothing and throws `ReadGuideFirst` with the guide, recorded as the hand-off once the bash call's output shows it whole, so the next run passes.
- The environment variable that names the channel is taken out before the script's code runs: by the Node preload, and in Python by the `.pth` line or the `sitecustomize`, so a process the script starts has nothing to call with.
- An `instrument` program on the runtime folder's `bin/`, first on every native command's PATH and never on the shell's, prints how to reach `instrument` from Python or Node and exits 127.
- `instrument app call`, `tools`, `tool`, `request` and `list` are generated from the same capabilities, keeping their exit codes: 0, 1 a failure, 2 a card is up, 3 not sent until the guide is read.

## What it costs

- A script calling an app no longer reads like `tools.beacon.list_issues()`; it is `instrument.apps.beacon.list_issues()` in Node and `instrument.app("beacon").list_issues()` in Python.
- `instrument app call` prints a structured result as JSON, and `instrument app request` prints a JSON body re-serialized, rather than the service's own text, since each is the capability's output read back.
- A program that reads the environment before the preload or `site` runs could still take the channel and call what the script can, which is the boundary the 2026-10-12 record accepted for `node`.

## What would change it

A capability that has to block on the person (a card a script waits on) would need the channel to stay open past the bash call's `yieldMs`, which this design refuses by throwing instead. If a package an agent installs turns out to read an undeclared `instrument` global, ours moves behind an explicit import.
