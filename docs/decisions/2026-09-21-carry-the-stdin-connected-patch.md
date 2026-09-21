# Carry a just-bash `stdinConnected` flag as a local patch so `rg` can tell an empty pipe from no pipe

Date: 2026-09-21

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way [2026-09-08-carry-the-find-patch.md](2026-09-08-carry-the-find-patch.md), [2026-09-09-carry-the-stat-patch.md](2026-09-09-carry-the-stat-patch.md), [2026-09-10-carry-the-cross-mount-copy-patch.md](2026-09-10-carry-the-cross-mount-copy-patch.md), and [2026-09-10-carry-the-python-worker-patch.md](2026-09-10-carry-the-python-worker-patch.md) do.

## Context

Our `rg` is the real ripgrep binary behind a just-bash custom command (`shell-commands/rg.ts`). ripgrep decides whether to read stdin or walk the working directory by stat'ing fd 0, so the shim has to hand it either a real pipe or an ignored stdin, and it chose between them by whether any bytes had arrived. just-bash gives a custom command `ctx.stdin` as a byte buffer and nothing else: a bare `rg PATTERN` and a `cmd | rg PATTERN` whose producer printed nothing both arrive as an empty buffer. The shim read the empty case as "no pipe" and let ripgrep walk the task folder.

In a production task this fired twice in one session. `agent-browser get text body` failed with `Element not found: body`, and the `rg -i -C 3 ...` after the pipe searched the task directory instead, returning 118 KB of the task's own skill files as if they were page text. The output was truncated to 20 KB, cost the session several thousand tokens of context it then carried for every later step, and led the model to reason about why "task files" appeared inside a browser read. On a host, the same pipeline exits 1 with no output.

## Options weighed

**Guess from the bytes.** Treat an empty buffer as a pipe. Rejected: that makes every bare `rg PATTERN` read an empty stdin and match nothing, which is the far more common case and the one the shim exists to serve.

**Parse the command line ourselves.** Nothing in the argument list says whether a pipe fed the command; the information is the interpreter's, and it drops it when it hands the stage's stdout to the next stage as a string.

**Patch the published bundle.** Chosen. The interpreter already knows, per pipeline stage, whether it is the first (which inherits the shell's stdin) or a later one (which reads the previous stage's stdout, empty or not), and already saves and restores `groupStdin` around each stage for that reason. The patch saves and restores one more field beside it, `state.stdinFromPipe`, and the command context builder exposes `stdinConnected`: true when bytes arrived, when an enclosing redirect or group set `groupStdin`, or when the stage sits after a `|`. The `rg` shim hands ripgrep an empty pipe when the flag is set. Four one-line edits to `dist/bundle/index.js` and one declaration in `dist/types.d.ts`; `rg.test.ts` fails the moment the patch stops applying.

## Decision

Carry the fifth part of `patches/just-bash@3.4.1.patch` until upstream exposes the same signal in a version we install, then drop it and the `stdinConnected` branch in `rg.ts`. The other shims that pick `stdin: "ignore"` from the same bytes (`ffmpeg`, `ffprobe`, `node`, `python`, `uv`) stay as they are: for a subprocess that only reads, an empty pipe and `/dev/null` are the same EOF, and ripgrep is the one binary here whose mode turns on the distinction.
