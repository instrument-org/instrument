# just-bash: what we consume, what we work around, what we are waiting on

`just-bash` is the sandbox every agent `bash` call runs in, so its gaps do not surface as stack traces. They surface as an agent giving a confident wrong answer, or writing a prompt-shaped workaround into its own reasoning. That makes the accounting below worth keeping in one place: which build we consume, what we have patched or told the agent to avoid because of it, and what is open upstream.

The failure mode this page exists to prevent is a workaround outliving the bug. Anything added to the two registers below needs a removal trigger recorded next to it. See also [agent-sandbox.md](agent-sandbox.md) for what the sandbox contains, and [bash-sandbox-mounts-and-native-binaries.md](bash-sandbox-mounts-and-native-binaries.md) for the mount layout.

## What we consume

We are on the published npm package, not a fork.

- `just-bash@^3.4.1` from npm, declared in `packages/workspace/package.json`.
- One local patch, to `find`; see below.

`minimumReleaseAge` in `pnpm-workspace.yaml` holds installs to releases at least seven days old, so the newest published version is routinely not the newest installable one. `minimumReleaseAgeExclude` carries the document-viewer libraries deliberately pinned to exact versions, plus `agent-browser`, which we do float onto fresh releases. It is not a general escape hatch: for anything else the way past the gate is to wait.

Upstream cuts releases through changesets and merges a great deal between them, so **a fix being on upstream `main` does not mean we have it**. Check the published version, not the branch, before assuming a workaround can go.

## Moving to a fork build

Not currently worth it. Consuming a fork means rebuilding `dist/` ourselves and carrying divergence that grows every time upstream lands something. Against that, the fixes we are waiting on are real but not blocking: they make the agent wrong in specific ways rather than stopping it working.

Adopt a fork build only when a gap is blocking a shipped feature, or when a merged fix is sitting unreleased for long enough that waiting costs more than diverging. If we do, the branch to consume is `combined/ls-and-touch-fixes` on our fork, which merges the branches behind the open PRs below.

## Local patches

One, carried under [decisions/2026-09-08-carry-the-find-patch.md](../decisions/2026-09-08-carry-the-find-patch.md).

| patch | what it does | upstream | remove when |
| --- | --- | --- | --- |
| `patches/just-bash@3.4.1.patch` | `find` reports a directory it cannot read on stderr and keeps going, exiting 1 at the end, instead of throwing out of the whole search | #414, the same change against `main` | #414 is merged and in the version we install; the guard is `create-bash-env-find.test.ts`, which fails the moment the patch stops applying or the behavior regresses |

The patch edits one minified chunk of `dist/bundle/`, so a version bump drops it and it has to be re-derived from the PR's source diff by hand: find the `readdirWithFileTypes` call in the chunk that holds `find`, and wrap the two `readdir` calls the way `find.ts` does on the branch. `pnpm patch just-bash@<version>` opens the copy to edit and `pnpm patch-commit` writes it back. The carried copy is the PR's first form, not its last: it recovers the same fixed table of errnos and rethrows everything else, but writes each message to stderr as the failure happens, so two unreadable directories report in the order the parallel batch settled rather than in traversal order. Cosmetic for an agent, and not worth re-deriving the larger diff for; the release replaces it.

An earlier one is gone: `patches/just-bash@3.2.0.patch` normalized the namespace of the dynamic `import("undici")` so the pinned connection owner could read `Agent` off it; without that every `curl` failed as `DNS pinning unavailable for private IP enforcement`. Upstream #339 is the same fix and shipped in 3.3.0. `create-bash-env-network.test.ts` is the guard that would catch a regression.

## Agent-facing workarounds

Text we put in front of the model, or commands we withhold from it, because of an upstream gap. Each of these is a liability once the gap closes: the model keeps being told to avoid something that works.

| where | what it does | upstream gap | remove when |
| --- | --- | --- | --- |
| `sqlite3` description in `create-bash-env.ts` | Tells the agent dot commands are unimplemented and to list tables with a `sqlite_master` query | Dot commands are still a parse error on 3.4.1; the tracking issues were closed rather than fixed | upstream implements them, which may be never; revisit if the issues reopen |
| `BROKEN_COMMANDS` in `create-bash-env.ts` | Withholds `which` | None. The built-in resolves against a real filesystem, which this sandbox does not have | never; see below |

`which` is in that table because it is withheld, not because it is pending. The `createWhichCommand` stub answers from the actual registered command set, so it knows the custom shims (`python`, `agent-browser`, `ffmpeg`) that a filesystem-based `which` cannot see, and it is registered as a custom command, which shadows the built-in whether or not the name is withheld. It belongs with the permanent adaptations rather than the workarounds: the `npm` stub pointing at `pnpm` is a product choice about which package manager tasks use, and the `<system_info>` line telling the agent its shell is GNU coreutils rather than BSD is a description of what just-bash is.

## Open upstream pull requests

Ours, all against `vercel-labs/just-bash`. Volatile by nature; the point of listing them is that a merged-and-released one usually retires a row from a register above. None had merged as of 3.4.1, nor in 3.4.2, a packaging-only release (#381).

| PR | what | affects us |
| --- | --- | --- |
| #414 | `find`: report a directory it cannot read and keep going | Yes, and it is the one patched locally. Every recursive `find` over an attached home directory returned nothing; see the gap below and the patch above. |
| #392 | `mktemp`: implement it, defaulting to `$TMPDIR` then `/tmp` | Yes. Merged and released, this retires our own `shell-commands/mktemp.ts` entirely: set `TMPDIR` to the task's `.tmp` in the bash env and the upstream command lands files in the same place ours does. |
| #365 | `file`: read gzip from the header instead of inflating it | Yes, and it is the only one that reaches the host. `file` on a gzip leaks an `AbortError` unhandled rejection into the embedding process after `exec()` has already resolved, so it lands in Electron's main process attributed to nothing and no `try`/`catch` around the call can see it. Reproduced on 3.4.1. |
| #363 | `ls`: operands resolved literally rather than re-globbed, GNU operand grouping, `-t` implemented, type indicators only with `-F`, `-R` sections ordered by the sort key | Yes. `ls 'd/[bracket].txt'` exits 0 having listed `d/a.txt` and `d/b.txt` instead, and `ls -t` returns byte-identical output to plain `ls`. Both silent. |
| #364 | `touch`: `-t` and `-r` honored instead of discarded, `-t` and `-d` read in `$TZ` rather than the host zone | Yes, wherever a timestamp is written and then compared. Both flags are accepted and discarded, so every file lands at the current time and the command exits 0. |
| #391 | `ln`: report a refused symlink as a symlink failure rather than as a hard link on a directory | Message only. See the first bullet below. |
| #318 | `interpreter`: interleave duplicated streams in write order | Yes, for output ordering under redirection. `{ echo one; echo two >&2; echo three; } 2>&1` prints `one three two`. |
| #313 | `fs`: `allowNestedMounts` on `MountableFs` | Only if we adopt nested mounts. |

Only #414 is patched locally. See [decisions/2026-08-27-no-local-just-bash-patches.md](../decisions/2026-08-27-no-local-just-bash-patches.md) for why the rest are not, and [decisions/2026-09-08-carry-the-find-patch.md](../decisions/2026-09-08-carry-the-find-patch.md) for why that one is.

## Known gaps with no fix in flight

Not workarounds, so they carry no removal trigger. They are here because each one is a way the sandbox can hand the agent a confident wrong answer, and knowing about them is cheaper than rediscovering them. Each was checked against 3.4.1 and against upstream `main`.

- **`ln -s` does not work, and says the wrong thing about why.** `ln -s a.txt b.link` on an ordinary file exits 1 with `ln: 'a.txt': hard link not allowed for directory`. It is neither a hard link nor a directory, so an agent reading it reasonably concludes the target is at fault and tries something else. Symlink creation is off for the virtual filesystem (`allowSymlinks`), which is the real answer. The message half is #391 above; the refusal itself is deliberate and stays.
- **Symlink support depends on who is asking.** The virtual filesystem refuses to create one, so `cp -R` of a `node_modules` tree fails with `EPERM: operation not permitted, symlink ...`. A real subprocess writes to the host directory directly and is not subject to that, so a Python script can create thousands of symlinks in the same folder where `cp -R` just failed. Nothing in the sandbox surfaces the difference.
- **`find -type l` and `cp -L` do not exist.** `find`'s type is `"f" | "d"` upstream, and `cp` has no dereference flag. Together they make a symlinked tree awkward to inspect or flatten, which is how the `cp -R` failure above usually gets discovered.
- **`find` stops at the first directory it cannot read, and says nothing useful about it.** A `readdir` failure inside the traversal throws out of the whole search, so `find /mnt/Home -name '*.md'` over an attached home directory returns exit 1 with `find: EACCES: permission denied, scandir '<path>'` and no results, because every macOS home holds a `.Trash` and a protected `Library` folder. Piped through `head` with stderr silenced, which is the shape agents write, it is exit 0 with nothing, indistinguishable from a real no-match. GNU find names the directory, continues, and exits 1 at the end. `rg` walks past the same directory, which is what makes the gap trappy: the two commands disagree about whether a tree has anything in it. Reproduced on 3.4.1 with the transcript's own command; the fix is a `try`/`catch` around the two `readdir` calls in `find.ts`, offered upstream as #414 and carried locally meanwhile (see Local patches above). This bullet goes with the patch.
- **Pipelines are not streaming.** Each stage runs to completion and its whole stdout is buffered as a string, so `tar -cf - big | tar -xf -` trips `total output size exceeded` against `maxOutputSize` even though nothing was headed for the agent. The message names `executionLimits.maxOutputSize`, which reads as "your output is too large" rather than "an intermediate did not fit". The same design means a downstream stage can never end its producer: `rg -l pattern /mnt/Home | head -200` runs the search to the end of the tree, since `head` does not exist until `rg` has exited, and a promoted call streams every line of it into the live view and the process log regardless of the `head`. A bounded search is unbounded here, and the fix is an interpreter change (streaming stages with backpressure), not a command fix.
- **A parse error fails the whole script.** An unsupported construct anywhere means no statement runs, and the message locates the offending column without naming the construct. Every command before it is silently skipped.
- **`date` and `ls -l` can disagree about a file's time.** Upstream, `date` defaults to UTC when `$TZ` is unset while `ls`'s formatter uses host-local components, so a correctly stored UTC instant can display as the previous day. Our env seeds `TZ` from the host zone (`create-bash-env.ts`), so the two agree here; the gap belongs to any embedder that leaves `TZ` unset. Found while fixing `touch`; reported on #364 rather than fixed, because the fix belongs in `ls` and would move every `ls -l` timestamp in the suite.
- **`sqlite3` dot commands are a parse error.** Already covered as a prompt workaround above; noted here too because it is the one gap upstream has declined rather than deferred.
- **`mktemp` does not exist, so we ship one** (`shell-commands/mktemp.ts`). Its absence is not neutral: the idiom the model knows for "somewhere safe to put a scratch file" is the one place the sandbox refuses, so it reaches for `/tmp` and the write fails. Ours names files under `.tmp`, the directory the subprocess hatches already get as `TMPDIR`. Unlike the other custom commands it needs nothing from the host — it is `-d`/`-p`/`-t`/`-u`/`-q` and a template against `ctx.fs` — so it is the one we offered upstream rather than carried, as #392 above.
- **A handful of other coreutils are missing** with no equivalent: `zip`/`unzip`, `dd`, `yes`, `xxd`, `realpath`, `shuf`, `openssl`, `rsync`. Each appeared once in the production record, in a task probing the sandbox rather than doing work, and `od`, `strings`, `head -c`, `seq`, and the `zip` skill cover the ground between them. Listed so the next reader can weigh a request against the whole set rather than adding them one at a time.

## Checking whether a release has caught up

```bash
npm view just-bash version                       # what latest actually is
npm view just-bash time --json                   # when each version published, against minimumReleaseAge
pnpm why just-bash                               # what we resolve to
```

When the published version moves, walk both registers above and delete every row whose trigger has fired, including the prompt text. Removing a stale line from the `sqlite3` description matters as much as dropping a patch: a model told a working command is broken will route around it for as long as the sentence survives.

Verify against the installed build rather than the changelog. `packages/workspace/scripts/run-bash.ts` boots the same sandbox the agent gets, so a claim about behavior is one command away:

```bash
pnpm --silent script:run-bash -- "<command>"
```
