# Carry just-bash's `find` time predicates as a local patch

Date: 2026-10-08

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

just-bash's `find` has `-mtime` and `-newer FILE` but answers `unknown predicate` to `-newermt DATE` and `-mmin N`. A chat asked to go through notes from the last couple of weeks opened with `find ... -newermt 2026-09-20 | head -40`; behind the pipe the exit code was `head`'s, so the step read as a successful search that found nothing.

## Decision

Carry the twelfth part of `patches/just-bash@3.6.0.patch`, pinned to [vercel-labs/just-bash#555](https://github.com/vercel-labs/just-bash/pull/555), which adds both predicates, until it is in a version we install. The time-predicates case in `create-bash-env-find.test.ts` is the guard.
