---
name: run-bash
description: Test bash commands in the same just-bash sandbox the agent uses, without booting Studio. Use when validating bash environment fixes, checking command availability, or verifying tool behavior (uv, pnpm, tsx, ffmpeg, etc.).
---

# run-bash

`packages/workspace/scripts/run-bash.ts` boots the exact same `just-bash` sandbox the agent uses at runtime — same FS isolation, same command shims, same network policy — so you can test commands and validate fixes without booting Studio.

Run it from the workspace package via pnpm:

```bash
cd packages/workspace
pnpm --silent script:run-bash -- "<command>"
```

## Modes

### One-shot (recommended for agent use)

Pass the command as a positional argument. The process exits with the command's exit code; stdout is the command's stdout only.

```bash
pnpm --silent script:run-bash -- "python -c 'import sys; print(sys.version)'"
pnpm --silent script:run-bash -- "uv pip install numpy && python -c 'import numpy'"
pnpm --silent script:run-bash -- "tsx --version"
```

Pass multiple positional commands to run them back to back in the same task dir:

```bash
pnpm --silent script:run-bash -- \
  "echo hello > /note.txt" \
  "cat /note.txt"
```

By default, all commands run and the process exits with the first non-zero exit code. Add `--bail` to stop after the first failure:

```bash
pnpm --silent script:run-bash -- --bail \
  "uv pip install requests" \
  "python -c 'import requests'"
```

### One-shot against an existing task dir

Reuse a task dir to persist installed packages, created files, etc. across calls. The task ID is printed to stderr on every run.

```bash
pnpm --silent script:run-bash -- --task TASK_ID "python -c 'import numpy'"
```

### Attached-folder mounts

Mount host folders read-only under `/mnt/<basename>` (repeatable), the same way user-attached folders appear to the agent:

```bash
pnpm --silent script:run-bash -- --attach ~/Documents/Photos \
  "ls /mnt/Photos" \
  "cp '/mnt/Photos/pic.jpg' attachments/"
```

### Piped sequential commands

Pipe a newline-separated script when you need multiple commands sharing one task dir without passing `--task` explicitly:

```bash
printf 'uv pip install requests\npython -c "import requests; print(requests.__version__)"\n' \
  | pnpm --silent script:run-bash
```

Use `--bail` with piped commands to stop at the first failure.

### Interactive REPL

Just `pnpm --silent script:run-bash` with no arguments when stdin is a TTY.

## Output

- **stdout** — command output only; clean for capture when run with `pnpm --silent`
- **stderr** — metadata (task dir path, task ID, session ID, exit code, duration)

Stderr example:

```plaintext
task dir: /tmp/instrument-bash-repl/tasks/01kv...
task: 01kv...  session: ses_01KV...

[exit 0 · 23ms]
```

## What the sandbox provides

Same environment as the real agent:

- **FS**: the task dir mounts writable at `/task` (the working directory) and `--attach` folders mount read-only under `/mnt/<name>`; everything else is a read-only empty root, so there is no access to the host filesystem
- **Network**: full internet access; private/loopback ranges blocked (SSRF guard)
- **Built-in commands**: standard unix builtins (`ls`, `grep`, `find`, `curl`, etc.)
- **Custom shims**: `tsx`, `pnpm`, `pnx`, `npx`, `uv`, `python`/`python3`, `pip`/`pip3`, `ffmpeg`, `ffprobe`, `node`, `git`
- **Stub**: `npm` -> error (use `pnpm`)
- **Managed command**: `agent-browser` resolves to the wrapped CLI; use this runner for command availability/help checks, not real browser-session testing

## Inspecting the task dir

The task dir path is printed to stderr. You can read files from it on the host after running commands, since it lives in the host's tmp directory:

```bash
# Check what was created
ls "$(pnpm --silent script:run-bash -- "echo hi" 2>&1 | grep 'task dir:' | cut -d' ' -f3)"
```

Or capture it explicitly:

```bash
TASK_DIR=$(pnpm --silent script:run-bash -- "echo hi" 2>&1 \
  | grep 'task dir:' | awk '{print $3}')
```

Alternatively pass `--task <id>` to a known task dir under `/tmp/instrument-bash-repl/tasks/<id>/`.
