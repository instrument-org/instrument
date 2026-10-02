# Carry the just-bash `find` fix as a local patch until it is released

Date: 2026-09-08

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else.

## Context

just-bash's `find` throws out of the whole traversal at the first directory it cannot read. Every macOS home directory holds at least one (`.Trash`, several under `Library`), so a recursive `find` over an attached home folder returns nothing: exit 1 with `find: EACCES: permission denied, scandir '<path>'` on its own, and exit 0 with no output at all once piped through `head` with stderr silenced, which is the shape an agent writes almost every time. A real transcript from the day this was found had an agent spend nine of fourteen shell calls on `find` over the mount, every one empty, while the file that named the answer sat one working `find` away; it got there in the end through `rg`, which walks past the same directory, after two runaway scans.

The 2026-08-27 decision set the bar for a local patch at a gap blocking a shipped feature, and rested the refusal on the open gaps sitting off the paths agents actually walk. This one sits on the path: attaching a home folder is a shipped feature, `find` is one of the three commands the attached-folder prompt names for searching it, and the failure is silent.

## Options weighed

**Wait for the release.** The fix is [vercel-labs/just-bash#414](https://github.com/vercel-labs/just-bash/pull/414). Even merged today, `minimumReleaseAge` puts it at least a week out from whatever release carries it, and upstream merges a great deal between releases. Rejected: the gap is on the main path and the wait has no bound.

**Tell the agent to use `rg` instead.** Done as well, for its own reason: the native search walks a home folder in seconds where the JavaScript `find` takes minutes, and does so off the thread that paints the window. But a prompt line steers a model; it does not stop `find` from lying when the model reaches for it anyway, and the transcript shows it reaching for it nine times.

**Patch the published bundle.** Chosen. The cost the earlier decision named is real: the patch edits a minified chunk, is unreadable on its own, and drops at the next version bump. Two things bound it. The PR's source diff is the recipe for re-deriving it, recorded in `just-bash-upstream.md`, and `create-bash-env-find.test.ts` fails the moment the patch stops applying, so a bump cannot silently lose it.

## Decision

Carry `patches/just-bash@3.4.1.patch` until #414 is in the version we install, then drop it and the guard test's reason for being. Nothing else is patched; the 2026-08-27 reasoning holds for the rest of the open PRs, whose gaps stay off the main path.
