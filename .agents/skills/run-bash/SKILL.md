---
name: run-bash
description: Test bash commands in the same just-bash sandbox the agent uses, without booting Studio. Use when validating bash environment fixes, checking command availability, or verifying tool behavior (uv, pnpm, node, ffmpeg, etc.).
---

# run-bash

`packages/workspace/scripts/run-bash.ts` boots the exact same `just-bash` sandbox the agent uses at runtime — same FS isolation, same command shims, same network policy — so you can test commands and validate fixes without booting Studio.

Run it from the repo root via pnpm:

```bash
pnpm --filter @instrument-org/workspace run --silent script:run-bash -- "<command>"
```

Every example below shortens that to `pnpm --silent script:run-bash`. Spell the `--filter` in full each time rather than `cd`-ing into the package once: an agent shell keeps its working directory between commands, so a later relative `cd` in the same session resolves against the package it is already in and dies.

## Modes

### One-shot (recommended for agent use)

Pass the command as a positional argument. The process exits with the command's exit code; stdout is the command's stdout only.

```bash
pnpm --silent script:run-bash -- "python -c 'import sys; print(sys.version)'"
pnpm --silent script:run-bash -- "uv pip install numpy && python -c 'import numpy'"
pnpm --silent script:run-bash -- "node --version"
```

Pass multiple positional commands to run them back to back in the same chat's work folder:

```bash
pnpm --silent script:run-bash -- \
  "echo hello > note.txt" \
  "cat note.txt"
```

By default, all commands run and the process exits with the first non-zero exit code. Add `--bail` to stop after the first failure:

```bash
pnpm --silent script:run-bash -- --bail \
  "uv pip install requests" \
  "python -c 'import requests'"
```

### One-shot against an existing chat

Reuse a chat's work folder to persist installed packages, created files, etc. across calls. The chat ID is printed to stderr on every run.

```bash
pnpm --silent script:run-bash -- --task CHAT_ID "python -c 'import numpy'"
```

### Reaching a folder

The runner reaches only its chat's folders unless told otherwise. `--attach <dir>` (repeatable) reaches a host folder at its own path, the way a folder a chat has been granted appears to the agent; `--attach-writable <dir>` is the same spelling for a folder meant to be changed. Both give the folder an Allowed rule in the runner's chat, so either can be changed; the runner has no home folder and no Settings › Permissions rules beyond the folders you attach.

```bash
pnpm --silent script:run-bash -- --attach ~/Documents/Photos \
  "ls $HOME/Documents/Photos" \
  "python -c 'import os; print(len(os.listdir(\"$HOME/Documents/Photos\")))'" \
  "ffprobe $HOME/Documents/Photos/clip.mov"
```

The path to type is the folder's real one. The sandbox shell's `~` and `$HOME` are your real home folder as well, but the runner reaches only what you attach.

### Loading a skill

`--skill <name>` does what `load_skill` does before the commands run: it prepares the skills this checkout ships in the runner's runtime folder, builds the skill's environments, and sets `$INSTRUMENT_SKILL_DIR` to the folder the agent is told, printing it with what was set up and how long it took.

```bash
pnpm --silent script:run-bash -- --skill pdf \
  'python "$INSTRUMENT_SKILL_DIR/scripts/check-pdf.py" --help'
```

### Piped sequential commands

Pipe a newline-separated script when you need multiple commands sharing one work folder without passing `--task` explicitly:

```bash
printf 'uv pip install requests\npython -c "import requests; print(requests.__version__)"\n' \
  | pnpm --silent script:run-bash
```

Use `--bail` with piped commands to stop at the first failure.

### Interactive REPL

Just `pnpm --silent script:run-bash` with no arguments when stdin is a TTY.

## Output

- **stdout** — command output only; clean for capture when run with `pnpm --silent`
- **stderr** — metadata (work folder, record folder, chat ID, session ID, exit code, duration)

Stderr example:

```plaintext
work folder: /tmp/instrument-bash-repl-machine/work/01kv...
record folder: /tmp/instrument-bash-repl/.instrument/chats/01kv...
chat: 01kv...  session: ses_01KV...

[exit 0 · 23ms]
```

## What the sandbox provides

Same environment as the real agent:

- **FS**: the chat's work folder is the working directory, at its real path under the system temp dir, with what the person sent in the record folder's `attachments/` (`$INSTRUMENT_ATTACHMENTS`); skills are reached at their real directories; `--attach` folders are reached at their own paths; everything else in the shell is a read-only empty root, so a builtin cannot reach the rest of the host filesystem. Native commands (`python`, `node`, `ffmpeg`, any program on the PATH, ...) are spawned under the same rules through Seatbelt on macOS and bubblewrap on Linux (the runner turns `nativeSandbox` on), and unwrapped elsewhere
- **Network**: full internet access, the local network and loopback included
- **Built-in commands**: standard unix builtins (`ls`, `grep`, `find`, `curl`, etc.)
- **Custom shims**: `python`/`python3` (the nearest `.venv`'s interpreter, or the managed Python's with none near), `node` (also runs TypeScript), `pnpm`, `pnx`/`pnpx`/`npx`, `uv`, `pip`/`pip3`, `ffmpeg`, `ffprobe`, `git`, `rg`, `mail`/`notes`/`messages`, `instrument` (with only `app` in a task's shell), `jobs`/`fg`/`kill`
- **Not here**: the `instrument` subcommands only a chat's shell has (`task`, `chat`, `tab`, `memory`) and its `.instrument/apps/` folder; this runner builds a task's shell
- **Stub**: `npm` -> error (use `pnpm`)
- **Managed command**: `agent-browser` resolves to the wrapped CLI; use this runner for command availability/help checks, not real browser-session testing

## Inspecting the work folder

The work folder's path is printed to stderr. You can read files from it on the host after running commands, since it lives in the host's tmp directory:

```bash
# Check what was created
ls "$(pnpm --silent script:run-bash -- "echo hi > note.txt" 2>&1 | grep 'work folder:' | cut -d' ' -f3)"
```

Or capture it explicitly:

```bash
WORK_DIR=$(pnpm --silent script:run-bash -- "echo hi" 2>&1 \
  | grep 'work folder:' | awk '{print $3}')
```

Alternatively pass `--task <id>` to reuse a known chat: its work folder is `$TMPDIR/instrument-bash-repl-machine/work/<id>/`, and its record folder `$TMPDIR/instrument-bash-repl/.instrument/chats/<id>/` (`--chats-dir <dir>` puts the records under another root).
