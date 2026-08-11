# just-bash: what we consume, what we work around, what we are waiting on

`just-bash` is the sandbox every agent `bash` call runs in, so its gaps do not surface as stack traces. They surface as an agent giving a confident wrong answer, or writing a prompt-shaped workaround into its own reasoning. That makes the accounting below worth keeping in one place: which build we consume, what we have patched or told the agent to avoid because of it, and what is open upstream.

The failure mode this page exists to prevent is a workaround outliving the bug. Anything added to the two registers below needs a removal trigger recorded next to it. See also [agent-sandbox.md](agent-sandbox.md) for what the sandbox contains, and [bash-sandbox-mounts-and-native-binaries.md](bash-sandbox-mounts-and-native-binaries.md) for the mount layout.

## What we consume

We are on the published npm package, not a fork.

- `just-bash@^3.2.0` from npm, declared in `packages/workspace/package.json`.
- Plus one local patch, `patches/just-bash@3.2.0.patch`, registered under `patchedDependencies` in `pnpm-workspace.yaml`.

npm `latest` is 3.2.0. Upstream cuts releases through changesets and has merged a great deal since the release that produced it, so **a fix being on upstream `main` does not mean we have it**. Check the published version, not the branch, before assuming a workaround can go.

## Moving to a fork build

Not currently worth it. Consuming a fork means rebuilding `dist/` ourselves, re-applying or dropping the patch, and carrying divergence that grows every time upstream lands something. Against that, the fixes we are waiting on are real but not blocking: they make the agent wrong in specific ways rather than stopping it working.

Adopt a fork build only when a gap is blocking a shipped feature, or when a merged fix is sitting unreleased for long enough that waiting costs more than diverging. If we do, the branch to consume is `combined/ls-and-touch-fixes` on our fork, which merges the branches behind the open PRs below.

## Local patches

| patch | why | upstream | remove when | guard |
| --- | --- | --- | --- | --- |
| `patches/just-bash@3.2.0.patch` | The ESM bundle inlines undici's CommonJS module, so the dynamic import's namespace carries it under `default` alone and the pinned connection owner constructs an `undefined` `Agent`. With `denyPrivateRanges` on, every `curl` fails as `DNS pinning unavailable for private IP enforcement`. | Fixed upstream, merged, unreleased | a release carries the fix | `create-bash-env-network.test.ts` |

The patch edits minified bundle output, so read the upstream source change rather than the patch diff if you need to understand it.

## Agent-facing workarounds

Text we put in front of the model, or commands we withhold from it, because of an upstream gap. Each of these is a liability once the gap closes: the model keeps being told to avoid something that works.

| where | what it does | upstream gap | remove when |
| --- | --- | --- | --- |
| `sqlite3` description in `create-bash-env.ts` | Tells the agent dot commands are unimplemented and to list tables with a `sqlite_master` query | Dot commands are still a parse error on upstream `main`; the tracking issues were closed rather than fixed | upstream implements them, which may be never; revisit if the issues reopen |
| `sqlite3` description in `create-bash-env.ts` | Tells the agent a SQL error still exits 0 even with `-bail` | Fixed upstream, merged, unreleased | a release carries the fix, at which point this sentence is actively misleading |
| `BROKEN_COMMANDS` in `create-bash-env.ts` | Withholds `html-to-markdown` | Depends on `turndown`, which needs `@mixmark-io/domino` as an undeclared peer dependency | the dependency is declared upstream |
| `BROKEN_COMMANDS` in `create-bash-env.ts` | Withholds `which` | Always errors in this environment | investigated and fixed, or confirmed unfixable |

Two things deliberately not in this table, because they are permanent rather than pending. The `npm` stub pointing at `pnpm` is a product choice about which package manager tasks use. The `<system_info>` line telling the agent its shell is GNU coreutils rather than BSD is a description of what just-bash is, not a workaround for a defect: it will be true for as long as we use it.

## Open upstream pull requests

Ours, all against `vercel-labs/just-bash`. Volatile by nature; the point of listing them is that a merged-and-released one usually retires a row from a register above.

| PR | what | affects us |
| --- | --- | --- |
| #363 | `ls`: operands resolved literally rather than re-globbed, GNU operand grouping, `-t` implemented, type indicators only with `-F` | Yes. A bracketed filename is reported as missing, `find -exec ls -l {} +` pipelines return blank lines, `ls -t` returns name order. |
| #364 | `touch`: `-t` and `-r` honored instead of discarded, `-d` bare dates read as local midnight | Yes, wherever a timestamp is written and then compared. |
| #318 | `interpreter`: interleave duplicated streams in write order | Yes, for output ordering under redirection. |
| #313 | `fs`: `allowNestedMounts` on `MountableFs` | Only if we adopt nested mounts. |

## Checking whether a release has caught up

```bash
npm view just-bash version                       # what latest actually is
pnpm why just-bash                               # what we resolve to
```

When the published version moves, walk both registers above and delete every row whose trigger has fired, including the prompt text. Removing a stale line from the `sqlite3` description matters as much as dropping the patch: a model told a working command is broken will route around it for as long as the sentence survives.
