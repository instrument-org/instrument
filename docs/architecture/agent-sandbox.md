# Agent sandbox

`instrument` is an Electron desktop app where users chat with an AI agent that operates inside a per-task folder. The agent is **not** in a VM, container, or OS sandbox. It runs as ordinary code in the Studio main process on the user's machine. "Sandboxing" here means a layered set of _userland_ constraints, picked so the user never has to approve individual tool calls.

For why this userland approach was chosen over OS-level isolation, see the [decision record](../decisions/2026-07-15-userland-agent-sandbox.md).

## Tools and where they live

The main agent (`packages/workspace/src/agents/main.ts`) gets a fixed set of tools from `packages/workspace/src/tools/`: `EditFile`, `ReadFile`, `WriteFile`, `Glob`, `Grep`, `BashTool`, `WebSearch`, `GenerateImage`, `LoadSkill`. Each tool's `execute` runs as host Node.js code; sandboxing is implemented _inside_ each tool, not by the runtime.

## The virtual filesystem layout

`packages/workspace/src/lib/workspace-fs-layout.ts` defines what the agent can see, shared by the file tools, the bash sandbox, and the native-binary path bridge: the task dir mounts **writable at `/task`** (the working directory), user-attached folders mount **read-only under `/mnt/<name>`**, and everything else is an empty read-only base (writes outside the mounts fail EROFS). See `docs/architecture/bash-sandbox-mounts-and-native-binaries.md` for the design constraints and known quirks.

## Containment layers (strongest -> weakest)

1. **Path-constrained file tools** (`ReadFile`/`WriteFile`/`EditFile`/`Glob`/`Grep`): paths resolve through the workspace layout (`src/lib/resolve-agent-path.ts`) — task-relative or `/task/...` into the task, `/mnt/...` into attached folders (reads only, with symlink containment); anything else is rejected. Write tools refuse read-only mounts.
2. **just-bash builtins** (`BashTool` via `src/lib/create-bash-env.ts`): a TypeScript bash interpreter running against the mounted virtual FS built from the same layout. Standard unix commands (`cat`, `sed`, `awk`, `jq`, etc.) are reimplemented in TS and only see the virtual FS. Also blocks JS escape vectors and prototype pollution. See `reference/just-bash/THREAT_MODEL.md`.
3. **`agent-browser` flag/subcommand allowlist** (`src/lib/shell-commands/agent-browser.ts`): blocks meta subcommands (`auth`, `state`, `--profile`, `--cdp`, etc.) and rewrites screenshot/download paths into the task's `tmp/`. Navigation targets that name a sandbox path (`output/x.html`, `/task/...`, `/mnt/...`, `file:///task/...`) are rewritten onto the task's asset origin (`agent-browser-asset-url.ts`), since Chromium's `file://` root is the host filesystem and the target runs with `webSecurity` on and no file access. A bare relative path is only rewritten when the sandbox holds that file, so bare hostnames still resolve as hostnames. Page-level behavior inside Chromium is currently unrestricted.
4. **Real-binary escape hatches** — `pnpm`, `tsx`, `ffmpeg`, `uv`/`python`/`python3`/`pip`, custom commands in `src/lib/shell-commands/`, and `curl`. These shell out to the real `node`/binary via `execa`. Once running, they have the host user's full FS, network, `process.env`, and `child_process` access. just-bash's containment does not extend here. Their **argv paths** are bridged through `resolveNativeHostPath`: `/task/...` maps to the real task dir; every other virtual path (notably `/mnt` mounts, whose host paths must never reach a writable subprocess) quarantines to a nonexistent path inside the task dir. **Inline program text** gets the same treatment (`bridgeInlineCodePaths`): quoted `/task/...` string literals in `-e`/`-c` code and heredoc programs are rewritten to cwd-relative paths, and quoted `/mnt/...` literals fail fast with copy-first guidance. Subprocess **stdin** crosses as raw bytes (`subprocessStdin`) — handing just-bash's latin1-packed stream string to `execa` would UTF-8 re-encode every non-ASCII byte. `curl` is enabled with `dangerouslyAllowFullInternetAccess: true`.

   **Python (`uv`).** Same trust level as the `node`/`pnpm` hatches, not a new boundary. The bundled `uv` binary (`src/lib/uv.ts`; vendored into `apps/studio/resources/uv/` by `apps/studio/scripts/download-uv.ts`) runs `python`/`python3`/`pip` against a per-task virtualenv at `work/.venv`. `uvSubprocessEnv()` pins uv to isolated dirs under `app.getPath("userData")` (`UV_CACHE_DIR`/`UV_PYTHON_INSTALL_DIR`/`UV_TOOL_DIR`) so just-bash's `HOME=/` never sends it writing to the host home, ignores host config (`UV_NO_CONFIG=1`), and only uses a managed CPython (`UV_PYTHON_PREFERENCE=only-managed`, downloaded on first use). `uv self update` is blocked; everything else passes through. The overlay is also merged into the other hatches' env so a tsx/node script can shell out to `python`/`uv`.

## Soft layer

The agent system prompt in `src/agents/main.ts` asks the LLM to behave (refuse malicious code, stay within the task folder, etc.). It is not a security boundary.
