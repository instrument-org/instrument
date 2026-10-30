# Plan: one Python and one JavaScript, both native

Status: done. Completed. Python and Node run native, the mount-era names are swept, and Windows has its drives place and notice. Windows confinement waits on MXC (see docs/architecture/windows-sandbox.md).

## Summary

The shell has two of each runtime. `python`/`python3` are CPython compiled to WebAssembly and `js-exec` is QuickJS, both run by just-bash over its virtual filesystem; `python-native` and `node` are real processes. The WebAssembly pair existed because a real process could not be trusted with a host path ([decision](../decisions/2026-09-10-python-is-the-sandboxed-interpreter.md)). With the agent at real paths and native commands held to the Permissions rules by Seatbelt and bubblewrap, that reason is gone, and the pair now costs more than it saves: no packages, no `ssl`, an 8 MB read limit, a 6 MB one for `js-exec`, a routing layer that guesses from imports which interpreter a script needs, and a just-bash patch carried for the Python worker.

After this change, `python`, `python3` and `node` are the only runtimes, all native, run through `wrapNativeCommand` with the environment allowlist and tool isolation. On Windows they run unconfined until the bake-off picks a sandbox, which slots in behind the same `wrapNativeCommand`. The file commands (`cat`, `rg`, `cp`, and the rest) stay just-bash builtins, because they raise permission cards with exact paths.

## What changes

- **`python` and `python3` run the chat's virtualenv interpreter**, the path `python-native` takes today: `ensureTaskVenv`, uv's managed Python, `pip` installs land where `python` runs them. `python-native` is deleted.
- **`js-exec` is deleted.** `node` is already native.
- **just-bash's runtimes are switched off** (`python: true` and `javascript: {...}` leave `createBashEnv`), and with them the QuickJS bootstrap, the sandboxed-failure explainers, the stdlib-name table, import sniffing, the skill-script carve-out, and `SANDBOX_SCRIPT_TIMEOUT_MS`. The just-bash patch parts that exist only for the Python worker are dropped (checked against [just-bash-upstream.md](../architecture/just-bash-upstream.md) before deleting).
- **`pip` and `uv`** stop telling the agent which interpreter can see what it installed, since there is one.
- **Prompt and descriptions**: the bash tool description, the folders text, and the system prompt's scripts section name one Python and one Node. The session baseline version is bumped so open chats are retold.
- **Docs**: a decision superseding the 2026-09-10 one; [agent-sandbox.md](../architecture/agent-sandbox.md), [bash-sandbox-mounts-and-native-binaries.md](../architecture/bash-sandbox-mounts-and-native-binaries.md) and [just-bash-upstream.md](../architecture/just-bash-upstream.md) edited in place.

## App tools from a script

`js-exec` is also where a script calls a connected app's tools as values: `await tools.<slug>.<tool>({...})`, answered on the main thread through `invokeTool` (`invokeAppTool`, the checks `app call` makes). `node` gets the same global, on by default with no flag, so the agent has nothing to remember.

It goes over the child's IPC channel rather than the workspace server. The `node` command spawns the script with an IPC pipe (execa's `ipc`), and a preload passed as `--import` defines `globalThis.tools` as a proxy that sends `{ id, path, args }` to the parent and awaits the reply. The `node` command answers each message with the shell's `invokeTool`, which the bash worker already forwards to the main thread. So no port, token or loopback rule is added to the sandbox, and a call can only come from a process the agent's own `node` started. The preload is a file in the app's resources, readable inside Seatbelt and bubblewrap like the interpreter.

A package that reads a global named `tools` could get ours. The preload keeps that narrow:

- It defines `tools` only when `globalThis.tools` is undefined, so it never replaces one a runtime or an earlier preload set.
- The property is non-enumerable, so code that walks the globals (`Object.keys(globalThis)`, a leak checker, a test runner's global snapshot) never sees it.
- It is writable and configurable, so a package that assigns `globalThis.tools = …` replaces it cleanly rather than throwing.
- Any `tools` declared in a module (`const tools`, an import, a parameter) shadows it, which is how nearly all code names it. What remains is code that reads an undeclared `tools`, or tests `typeof tools`, for feature detection. That is rare, and limited to the one process the agent's own `node` started.

`tools` keeps the name `js-exec` already taught, and the name the agent reads in the `app` command's help. A longer name (`instrumentTools`) or an explicit import (`import { tools } from "instrument:tools"`) would remove the remaining case, at the cost of one more thing to get right in every script.

Limits, said in the description: `tools` exists in the process `node` started, so a child that script spawns (a `node` under `pnpm run`, a Vite plugin) has none. A script that never calls `tools` pays only the preload's load time, and the open IPC channel is unref'd so it never holds the process alive.

Feasibility: high. About 150 lines, the preload and the `node` command's message loop, with tests for a result, a refusal thrown in the script, an abort, and a script that never calls it. The `app` command's help and the `app-scripting` eval move from `js-exec` to `node`.

## What it costs

- **First Python run needs the network** where uv's managed Python is not installed yet (tens of MB, once per machine). The WebAssembly Python worked offline. `python-native` has this cost today, so the change widens it rather than creates it.
- **Startup**: `sandbox-exec` adds about 6 ms per spawn (measured), on top of the interpreter's own start. To be measured per run against the WebAssembly runtimes before and after.
- **Windows** loses the only rule-bound Python it had until a sandbox lands there.

## What is left of the mount era

The same change sweeps the vocabulary the virtual layout left behind. About 25 files still say `mountPoint`, `virtualPath`, `/task/`, `/mnt/` or `MOUNT`, most heavily `workspace-fs-layout.ts`, `path-containment.ts`, `rg.ts`, `resolve-agent-path.ts`, `du.ts`, `agent-browser-file-url.ts`, `walk-budget.ts` and `local-page-address.ts`, plus a handful of Studio components. Each hit is judged on its own:

- Code that only translated an agent's path to the person's (or back) is deleted, since the two are now the same path.
- A "mount" that now means a real folder the chat reaches is renamed to say so (`folder`, `root`, `hostRoot`).
- A hit that means something else stays, such as Studio's `/tasks/<session>` routes.

Old `/task/...` and `/mnt/...` paths in a 1.x or earlier chat's history get no special handling: nothing rejects or rewrites them, and the agent works from the prompt and its working folder. The branch already has no code that recognizes them.

## Windows drives

The shell spells a Windows path the POSIX way, `D:\Photos` as `/d/Photos`, through `shellPath` and `hostPathOf`, for native commands' working folder and arguments as well as the builtins. A test pins the round trip for a second drive letter, a drive root (`/d` and `D:\`), and a UNC path.

Windows gets a drives place for parity with `/Volumes` and `/media`: every drive letter but the system drive, Ask first by default, listed in Settings › Permissions like on the other platforms. The letters are read when the rules are built, so a drive plugged in later is covered from the next command.

## Verification

- Unit suites for the touched commands, and `create-bash-env-python.test.ts` rewritten for the native path.
- Evals on Haiku (`env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY`): the `perm-` suite and the unprompted-tools suite.
- In a chat folder: `pnpm add sharp` and a resize, and a Vite build, to show native modules run under the sandbox.
- Linux and Windows preview builds of the pushed head.

## Out of scope

- A Windows sandbox (bake-off).
- Bundling a Python with the app.
