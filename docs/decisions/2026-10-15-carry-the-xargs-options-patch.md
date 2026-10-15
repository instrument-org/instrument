# Carry an xargs option parser as a local just-bash patch

Date: 2026-10-15

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

Every `xargs` call with `-P` or `--max-procs` in its options runs on just-bash's builtin rather than uutils xargs, which accepts `-P` but runs one command at a time ([native-and-builtin-commands.md](../architecture/native-and-builtin-commands.md)). The builtin took a value only as the next argument and combined only the flags `-0`, `-t` and `-r`, so the forms models write most (`-n1`, `-I{}`, `-P4`, `-0P4`, `--max-procs=4`) failed with `invalid option`, and the only calls routed to it were the ones it could not read. It also had no `-L`, `-s` or `-E` at all.

## Decision

Carry one more part of `patches/just-bash@3.6.0.patch`: a local diff, `xargs-options-3.6.0.diff`. It reads options the way GNU getopt does: short flags combine, an option that takes a value (`-E`, `-I`, `-L`, `-P`, `-d`, `-n`, `-s`) takes the rest of its argument or else the next one, `-e`, `-i` and `-l` take an optional attached value, long options take `=VALUE` or the next argument, and `--` or the first non-option starts the command. It adds `-L` (whole input lines per command, a trailing blank continuing a line), `-s` (bytes per command line, counted as GNU counts them), and `-E` (a logical end of input), and reads `-I` input a line at a time with leading blanks dropped, as GNU does, where it split on every blank. `create-bash-env-native-text.test.ts` is the guard, and the diff carries its own `xargs.option-forms.test.ts`.

## Alternatives

- Pinning [vercel-labs/just-bash#536](https://github.com/vercel-labs/just-bash/pull/536) (not ours, open): rejected, since it attaches values for `-I`, `-d`, `-n` and `-P` alone and leaves combined forms (`-0P4`, `-trn1`), long options with `=`, and `-L`, `-s` and `-E` failing. The two conflict in the option loop, so if #536 lands first this part is ported onto it.
- Rewriting the arguments before they reach the builtin: rejected, since it is a second xargs parser to maintain downstream, and the fix belongs to every embedder of the builtin.
- Sending `-P` calls to uutils anyway: rejected, since the reason for the route is that uutils runs them one at a time.
