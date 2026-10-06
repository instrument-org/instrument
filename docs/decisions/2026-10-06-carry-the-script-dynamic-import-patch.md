# Carry a fix for dynamic `import()` in `js-exec` scripts as a local patch

Date: 2026-10-06

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

In `js-exec` script mode a dynamic `import("node:fs")` rejected with `ReferenceError: could not load module 'node:fs'`, because the 3.4.1 worker installs QuickJS's module loader only when the run is in module mode. Upstream turns module mode on for any `await` in the code, so `(async () => { await import("node:fs") })()` worked while `import("node:fs").then(...)` failed, and without a rejection handler that script printed nothing and exited 0. Node runs both. Our `usesModuleSyntax` wrapper deliberately leaves `import(` out, because adding `-m` to sloppy CommonJS would put it in strict mode.

Upstream `main` replaced this runtime with `run` (#394), which loads modules for scripts, so there is no pull request to carry: a change against `main` would fix nothing there.

## Decision

Carry the twelfth part of `patches/just-bash@3.4.1.patch` as a local diff, `patches/just-bash-sources/script-dynamic-import-3.4.1.diff`, which moves `runtime.setModuleLoader` out of the `isModule` guard, until we install a version with the `run` runtime. The case it adds to `js-exec.esm.test.ts` fails without it; the dynamic `import()` case in `create-bash-env-js-exec.test.ts` is our guard.
