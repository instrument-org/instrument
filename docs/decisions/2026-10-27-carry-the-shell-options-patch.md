# Carry just-bash's `bash`/`sh` option parsing as a local patch

Date: 2026-10-27

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

just-bash's own `bash` and `sh` commands took `-c` only as the first argument. Anything else in that place was read as a script file, so `bash -lc 'echo hi'` failed with `bash: -lc: No such file or directory` at exit 127, and so did `bash -l -c`, `bash -ec`, `bash -euo pipefail -c`, `bash -x -c`, `bash --login -c`, `bash -s`, and `bash -e run.sh`. Models trained on harnesses that run every command as `bash -lc '…'` reach for that shape first, so each one spent a turn learning the shell's dialect.

## Decision

Carry one more part of `patches/just-bash@3.6.0.patch` until an equivalent is in a version we install: a local diff, `shell-options-3.6.0.diff`, with no upstream pull request yet (one is owed; the text to open it with is in [just-bash-upstream.md](../architecture/just-bash-upstream.md)). `bash` and `sh` read their options as bash does: combined letters, `-c` as a flag anywhere among the options, `-s`, `--` and `-`. `-l`, `-i`, `--login`, `--noprofile`, `--norc` and `--noediting` are accepted and ignored, since the shell has no profile files and no terminal. `set`'s letters, `-o NAME` and `-O NAME` run as `set` and `shopt` on the script's first line, so `$LINENO` still counts the script's own lines, and an option either refuses ends the shell with status 2 before the script runs. `--help` counts only in option position, where before `bash -c 'ls --help'` printed `bash`'s help. `create-bash-env-shell-options.test.ts` is the guard, beside the diff's own `bash.options.test.ts`; the diff also drops eight `## SKIP` markers from the Oils spec cases that now pass.

`background-ampersand.ts` reads the `-c` script through the same option rules, so `bash -lc 'a & b'` is refused as `bash -c 'a & b'` is.

## Alternatives

- Threading the options through the nested `exec` as interpreter state instead of a `set` line: rejected for now, since it touches `Bash.ts`, `types.ts` and the command context, where upstream `main` has moved since 3.6.0 (`newShell`), and running `set`/`shopt` reuses their validation and their `SHELLOPTS`/`$-` bookkeeping. The cost is that `$-` lacks `c` and a parse error on the first line reports a column shifted by the setup text.
- A wrapper command registered over `bash` and `sh` in `create-bash-env.ts`: rejected, per the house rule that a just-bash gap is fixed in just-bash and carried, not wrapped downstream.
- A prompt line telling the agent to write `bash -c` alone: rejected, since it would outlive the fix and a model reaches for the trained shape anyway.
