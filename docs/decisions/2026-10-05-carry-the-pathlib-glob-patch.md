# Carry just-bash's `pathlib` glob fix as a local patch

Date: 2026-10-05

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

`Path.rglob()` failed in the sandboxed `python3` with `TypeError: _path_glob() got an unexpected keyword argument 'case_sensitive'`, and so did `Path.glob()` with any keyword argument. The worker replaces both methods to redirect paths onto its host mount, with signatures that take only the pattern, while CPython 3.13's own `rglob` calls `glob` with `case_sensitive` and `recurse_symlinks`. An agent searching a folder for PDFs hit it on its first script and had to rewrite the search with `os.walk`. The same code is on upstream `main` and in 3.6.0.

## Decision

Carry the eleventh part of `patches/just-bash@3.4.1.patch`, pinned to [vercel-labs/just-bash#544](https://github.com/vercel-labs/just-bash/pull/544), which forwards `*args, **kwargs` through both replacements, until it is in a version we install. The `Path.rglob` case in `create-bash-env-python.test.ts` is the guard.
