# Carry just-bash's `bash`/`sh` option parsing as a local patch

Date: 2026-10-27

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

just-bash's own `bash` and `sh` commands took `-c` only as the first argument. Anything else in that place was read as a script file, so `bash -lc 'echo hi'` failed with `bash: -lc: No such file or directory` at exit 127, and so did `bash -l -c`, `bash -ec`, `bash -euo pipefail -c`, `bash -x -c`, `bash --login -c`, `bash -s`, and `bash -e run.sh`. Models trained on harnesses that run every command as `bash -lc '…'` reach for that shape first, so each one spent a turn learning the shell's dialect.

Two smaller gaps sat beside it. `bash --version` failed, so a model checking which bash it had before using bash 4 syntax learned nothing. And a syntax error named the wrong place: a file whose second line is `if then` was reported as ``bash: syntax error: Parse error at 3:1: syntax error near unexpected token `fi'``, a token the script does not contain on a line past its end, where bash says ``t.sh: line 2: syntax error near unexpected token `then'``. That was the parser's, not `-n`'s: `if`, `elif`, `while` and `until` never checked their condition for being empty, so `if then` ended an empty condition at `then` and failed later on an empty body at the end of the file, and `while do` was accepted.

## Decision

Carry one more part of `patches/just-bash@3.6.0.patch` until an equivalent is in a version we install: a local diff, `shell-options-3.6.0.diff`, with no upstream pull request yet (one is owed; the text to open it with is in [just-bash-upstream.md](../architecture/just-bash-upstream.md)). The three changes are one diff so one pull request covers them.

`bash` and `sh` read their options as bash does: combined letters, `-c` as a flag anywhere among the options, `-s`, `--` and `-`. `-l`, `-i`, `--login`, `--noprofile`, `--norc` and `--noediting` are accepted and ignored, since the shell has no profile files and no terminal. `set`'s letters, `-o NAME` and `-O NAME` run as `set` and `shopt` on the script's first line, so `$LINENO` still counts the script's own lines, and an option either refuses ends the shell with status 2 before the script runs. `--help` counts only in option position, where before `bash -c 'ls --help'` printed `bash`'s help.

`--version` prints `GNU bash, version 5.1.0(1)-release (just-bash)`, bash's first line with just-bash where bash names the machine type, then a line saying it is not GNU bash. The version is `$BASH_VERSION`'s; the 3.6.0 diff spells it out rather than importing it, because importing `shell-metadata.ts` into the `bash` command moves that module into a new shared chunk the patch rebuild cannot map, and a test holds the two equal.

A syntax error reads as bash's does, `NAME: line N: syntax error …`, NAME being `bash: -c`, the script's path, `bash` for stdin or a top-level `exec`, the file for `source`, and `bash: eval` for `eval`; the column is dropped, as bash prints none. The `bash` command passes the name to the nested `exec` through a new `scriptName` exec option. An empty `if`/`elif`/`while`/`until` condition or body fails at the token that came instead, and the parser's generic `expect` failure reads `syntax error near unexpected token` or `syntax error: unexpected end of file` rather than `Expected FI, got EOF`. A stripped shebang line keeps its newline, so line numbers and `$LINENO` count it.

`create-bash-env-shell-options.test.ts` is the guard, beside the diff's own `bash.options.test.ts` and `parse-errors.test.ts` cases; the diff also drops eight `## SKIP` markers from the Oils spec cases that now pass.

`background-ampersand.ts` reads the `-c` script through the same option rules, so `bash -lc 'a & b'` is refused as `bash -c 'a & b'` is.

## Alternatives

- Threading the options through the nested `exec` as interpreter state instead of a `set` line: rejected for now, since it touches `Bash.ts`, `types.ts` and the command context, where upstream `main` has moved since 3.6.0 (`newShell`), and running `set`/`shopt` reuses their validation and their `SHELLOPTS`/`$-` bookkeeping. The cost is that `$-` lacks `c`.
- Parsing the script a second time inside the `bash` command to word its syntax error: rejected, since the nested `exec` normalizes the script before parsing it and the two parses could disagree; the `scriptName` option lets the one parse report under the right name.
- Rewriting the nested `exec`'s stderr in the `bash` command by matching `Parse error at`: rejected as matching on text the interpreter is free to change.
- Bash's second line quoting the offending source, and `BASH_VERSINFO` (unset, so `${BASH_VERSINFO[0]}` is empty): left out to keep the change to what was asked; both are offered in the pull request text.
- A wrapper command registered over `bash` and `sh` in `create-bash-env.ts`: rejected, per the house rule that a just-bash gap is fixed in just-bash and carried, not wrapped downstream.
- A prompt line telling the agent to write `bash -c` alone: rejected, since it would outlive the fix and a model reaches for the trained shape anyway.
