# We carry no just-bash patches, and #365 is the one that would change that

Date: 2026-08-27

## Context

Moving to `just-bash@3.4.1` deleted the one local patch we had. Five of our pull requests remain open upstream, none merged as of that release, so the question is whether any of them is worth re-patching the published bundle for rather than waiting.

Each was checked against the installed 3.4.1 rather than against the PR description, because a fix landing upstream and a bug still reproducing here are different claims. What the checks found:

- **#365 `file` on a gzip** leaks an `AbortError` unhandled rejection into the embedding process. Reproduced: `exec()` resolves with exit 0 and the right answer, and roughly a second later an unhandled rejection arrives. This is the only one of the five that escapes the sandbox at all. In Electron it lands in the main process attributed to nothing in particular, no `try`/`catch` around the call can see it because it arrives after the promise resolves, and the agent turn that ran `find ... -exec file '{}' \;` looks clean.
- **#363 `ls`** resolves operands as globs. `ls 'd/[bracket].txt'` exits 0 having listed `d/a.txt` and `d/b.txt`, files the caller never named, and never mentions the file it was asked about. `ls -t` returns output byte-identical to plain `ls`. Both are silent wrong answers rather than errors.
- **#364 `touch`** accepts `-t` and `-r` and discards them, so a file stamped `202001020304` lands at the current time at exit 0.
- **#318 stream ordering** does not preserve write order under `2>&1`: `{ echo one; echo two >&2; echo three; }` prints `one three two`.
- **#391 `ln`** reports a refused symlink as a hard link on a directory. Message only; the refusal is a deliberate sandbox setting.
- **#313 nested mounts** is a feature we do not use.

## Options weighed

**Patch nothing and wait.** Chosen. See below.

**Patch #365 now.** The strongest case, and the one to revisit. It is the only defect here that can reach a user as anything other than a wrong tool result, and an unattributable main-process rejection is exactly the kind of noise that makes exception reporting less trustworthy the more of it there is. It is not patched today because `file` on a gzip is rare in our task shapes, one stray rejection is survivable, and the cost is real: a patch edits minified bundle output, which is unreadable, breaks on the next bump, and has to be re-derived by hand each time. That trade flips the moment the rejection is observed in the wild or the reporting path ships.

**Patch #363 and #364.** Rejected despite both producing silent wrong answers. `ls` and `touch` are not on the path of the work tasks actually do here: agents reach for `rg` and `find` to locate things and rarely parse `ls` output, and nothing in the product depends on a file's mtime. The wrongness is real and the exposure is close to zero.

**Move to a fork build carrying all five.** Rejected. It means rebuilding `dist/` ourselves and carrying divergence that grows with every upstream release, against fixes that are mostly invisible to us. The bar for that is a gap blocking a shipped feature.

## Decision

No local patches. We consume the published package and wait for these to merge and release.

The trigger to revisit is #365 specifically, and it is not "it is still open." It is either of: an `AbortError` with no attributable source showing up in a real session or a crash report, or opt-in exception reporting shipping, at which point a recurring unattributable rejection stops being invisible and starts being a support burden. Either one justifies patching that single fix ahead of the others.

Two things this decision deliberately does not rest on. It does not rest on the bugs being unimportant; #363 and #364 both return confident wrong answers at exit 0, which is the worst shape a sandbox defect can take. It rests on them sitting off the paths our agents walk. And it does not rest on the patches being hard to write; they are hard to *carry*, which is a different and more durable objection, because the difficulty recurs at every bump rather than once.

`just-bash-upstream.md` holds the per-PR detail and is where the observed behavior of each gap is recorded.
