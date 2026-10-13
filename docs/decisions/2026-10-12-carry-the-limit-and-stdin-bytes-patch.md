# Carry just-bash's command-limit and stdin-bytes fixes as a local patch

Date: 2026-10-12

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

Running the agent's common commands over desktop-sized inputs (a 100 MB log, a 1M-row CSV, a 65 MB JSON file) found two upstream defects alongside the limits `create-bash-env.ts` raises. `awk`, `sed`, `jq`, and `yq` catch their own execution limit and return exit 126 as an ordinary status, so a later pipeline stage masks it: `awk -F, '{print $3}' data.csv | sort | uniq -c` exited 0 with counts over part of the file. And `sha256sum`, `gzip`, `base64`, `tar`, and `split` turn stdin into bytes with `Uint8Array.from(string, mapFn)`, which past a few hundred MB is a V8 fatal error that ends the process; raising the output bound to 256 MiB makes such a stdin reachable.

## Decision

Carry two more parts of `patches/just-bash@3.6.0.patch` until they are in a version we install: [vercel-labs/just-bash#572](https://github.com/vercel-labs/just-bash/pull/572) pinned at its head, and [vercel-labs/just-bash#573](https://github.com/vercel-labs/just-bash/pull/573) as `stdin-bytes-3.6.0.diff`, which defines the PR's shared helper in each command so the rebuilt bundle keeps 3.6.0's chunks. `create-bash-env-large-input.test.ts` is the guard for the raised limits and the stdin case; #572's own test runs under the rebuild's `--test`.
