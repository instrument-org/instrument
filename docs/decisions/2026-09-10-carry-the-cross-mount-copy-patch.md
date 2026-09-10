# Carry the just-bash cross-mount copy fix as a local patch until it is released

Date: 2026-09-10

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way [2026-09-08-carry-the-find-patch.md](2026-09-08-carry-the-find-patch.md) and [2026-09-09-carry-the-stat-patch.md](2026-09-09-carry-the-stat-patch.md) do.

## Context

just-bash's `MountableFs` copies a tree from one mount into another entry by entry, and one entry the destination refuses ends the whole walk. Every mount we build refuses to create a symlink (`allowSymlinks` is off, deliberately, and stays off), so `cp -R` of any attached folder holding a link stopped at the link with `EPERM: operation not permitted, symlink '<dest>'`, everything after it uncopied. A home-directory folder or a checked-out repository nearly always holds one. Worse, the errno was the one the attached-folders prompt told the agent to read as "macOS refused the folder; stop and send the user to System Settings", so an agent that obeyed abandoned a task that was not blocked. `docs/findings/eperm-on-a-symlink-reads-as-a-macos-denial.md` records the run that found it.

## Options weighed

**Wait for the release.** The fix is offered upstream as the branch named in `just-bash-upstream.md`. Even merged today, `minimumReleaseAge` puts it a week past whatever release carries it. Rejected for the reason the `find` decision gives: the gap is on the main path (the attached-folders prompt itself tells the agent to `cp -R` a repository into the task before running `git` on it) and the wait has no bound.

**Adapt at our layer.** A subclass of `MountableFs` overriding `cp` was built and worked: readable TypeScript in our tree, no bundle editing, survives a version bump untouched. Rejected. It shadows a core method, so any upstream change to the cross-mount copy would be silently overridden and never reach us; it mirrors upstream's private routing to decide which copies to take over; and it has no removal trigger, which is the failure mode `just-bash-upstream.md` exists to prevent. The bug is upstream's, in how the copy was implemented, and the fix belongs there.

**Patch the published bundle.** Chosen. The `crossMountCopy` method in `dist/bundle/index.js` is one compact function, and the patch replaces it with a readable pair of methods that match the source change on the branch, so re-deriving it after a bump is a copy of the PR's diff with one two-letter name substituted. `create-bash-env-cp.test.ts` fails the moment the patch stops applying, so a bump cannot silently lose it.

## Decision

Carry the third part of `patches/just-bash@3.4.1.patch` until the upstream PR is in the version we install, then drop it and the guard test's reason for being. The prompt's EPERM rule is narrowed to reads and listings at the same time, and that part stays: the destination's refusal still carries the errno, and the prompt is what decides how the agent reads it.
