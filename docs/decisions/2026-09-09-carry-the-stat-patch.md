# Carry the just-bash `stat -c` fix as a local patch until it is released

Date: 2026-09-09

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md) a second time, alongside [2026-09-08-carry-the-find-patch.md](2026-09-08-carry-the-find-patch.md).

## Context

just-bash's `stat` implements ten `-c` directives and returns every other one as its own source text, at exit 0. The whole timestamp family is in that set, so `stat -c '%Y' file` prints `%Y` and `stat -c 'mtime=%y'` prints `mtime=%y`. Nothing in the exit code, stderr, or the string says a value is missing, and the agent reads it as output.

That spelling is the one we point agents at: the shared `<system_info>` block tells every session its shell is GNU coreutils and to reach for `stat -c`. A task on 2026-09-09 asked for one file's modification time and spent five of its fifteen shell calls on it, trying `stat -c '%Y'`, then `date -d @%Y`, then `ls --full-time`, then BSD `stat -f`, before plain `stat` gave it the `Modify:` line it needed. The user's answer was correct; the path to it was not.

Nothing is blocked outright, which is the honest limit of the case: plain `stat` prints the modification time, and an agent that flails long enough finds it. What it costs is turns, on the path attached-folder work walks most often, since "which of these is newest" is the question a mounted folder invites.

## Options weighed

**Wait for the release.** The fix is offered upstream. `minimumReleaseAge` puts any release carrying it at least a week out, and none of our other upstream PRs have merged yet.

**Amend the prompt line instead.** The `<system_info>` sentence could say plain `stat` is the way to a timestamp and `stat -c` has no time format. Rejected as the whole fix: it is a workaround built to outlive its bug, in the register the architecture doc keeps precisely because those get forgotten, and it spends prompt on steering a model away from the spelling it knows rather than making that spelling work.

**Ship our own `stat` command.** The sandbox already registers custom commands, and `mktemp` is one. Rejected: a registered command shadows the built-in permanently and silently, so it survives the upstream fix rather than expiring with it, and it means owning a reimplementation of a command whose default output, error text, and output-limit semantics we would then maintain against upstream's.

**Patch the published bundle.** Chosen. It is the same change as the upstream one, on the same code path, and it expires on the same trigger as the `find` patch it sits beside in one patch file.

## Decision

Carry the `stat` half of `patches/just-bash@3.4.1.patch` until the upstream `stat -c` fix is in the version we install, then drop it with the `find` half. `create-bash-env-stat.test.ts` fails the moment the patch stops applying, so a version bump cannot lose it quietly.
