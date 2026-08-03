# Search moves into the shell, on the real ripgrep binary

Date: 2026-07-28

## Decision

The bash sandbox's `rg` is a custom command backed by the real ripgrep binary (`@vscode/ripgrep`) instead of just-bash's TypeScript implementation. It is the first read-only native binary allowed to resolve paths through the **whole** workspace layout, including the read-only `/mnt` mounts and the writable `/skills` mount.

The `grep` tool is removed. Searching is now one thing the agent does one way.

## Why

just-bash reimplements `rg` in TypeScript over its virtual filesystem, on an RE2 engine. Correctness against the real binary is excellent — searching this repo returned identical results (77 files for `rg -l useState`, 474 matches for `rg 'export const'`) — but speed is not:

| workload                        | just-bash `rg` | real ripgrep |
| ------------------------------- | -------------- | ------------ |
| `rg -l useState` (this repo)    | 2.2 s          | 0.02 s       |
| `rg 'export const'` (this repo) | 5.1 s          | 0.03 s       |
| `rg NEEDLE` (20k files, 156 MB) | 9.1–19.3 s     | 0.45 s       |

The walk is a serial DFS, each file is read whole into a JS string, and the literal pre-filter that `grep` uses is not applied to `rg`, so RE2 runs on every line of every file.

Two correctness wins come along with the speed. The TypeScript implementation **silently strips inline `(?i)`**, so `rg '(?i)FOO'` finds nothing where real ripgrep matches, and its `-g '**/*.ts'` does not match root-level files. Both are silent-wrong-answer bugs.

Removing the `glob` tool made this materially more valuable: file discovery now runs through `rg --files` in the shell, which was the slow path. With the `grep` tool gone too, every search the agent does runs through this command.

## Why the `grep` tool goes

Once `rg` in the shell is the same binary the tool was already spawning, the tool's remaining advantages were that Studio renders its output as a result card and that it is one call rather than a composed command. Against that, keeping it meant two ways to search where the tool was the weaker one: no `-l`, `-c`, `-o`, `--files`, `--heading`, no multiple globs, and no piping. Every search also cost a tool call whose result could not feed anything else.

Usage was already thin — 106 calls across 718 local task databases, 40 of which used it at all, 28 calls in the last 30 days.

Removing it was checked against real models rather than assumed. With the tool gone, both Haiku 4.5 and Sonnet 5 went straight to `rg` on the first attempt and answered a multi-file content-search question correctly in two tool calls:

```
Haiku 4.5:  rg -n 'TIMEOUT_MS' work/ -B 1 -A 1
Sonnet 5:   rg -n -C 1 'TIMEOUT_MS' work/ --heading
```

Both reached for context flags unprompted, and Sonnet used `--heading`, which the tool never exposed. Sonnet had previously chosen the `grep` tool over the shell, so it was the case most likely to regress; it did not.

Historical `tool-grep` parts still parse, since the persisted part schema only checks the `tool-` prefix. They render as unknown tools in old sessions, the same as the previously removed `glob`, `agent`, and `task` tools.

## What makes the wider path bridge acceptable

`resolveNativeHostPath` deliberately bridges only `/task` and quarantines every other virtual path, and carries a comment telling future readers not to "fix" that by resolving the full layout. That still holds: this uses a separate `resolveReadOnlyHostPath`, so the general bridge is unchanged.

The wider reach is sound only because ripgrep cannot write and cannot execute, which rests on four things:

- **The exec flags are refused.** `--pre`, `--pre-glob`, and `--hostname-bin` run a program of the agent's choosing; `-z`/`--search-zip` decompresses through external tools. All are rejected, including `-z` bundled inside a short cluster (`-uz`). This is the load-bearing control: in the shell the agent controls argv, which was not true of the tool this replaces.
- **The private dir is unreachable.** An explicit path into `.instrument` is refused by the resolver, and the directory is excluded from the walk with a glob anchored to the search root — ripgrep walks the real tree, so the virtual-filesystem mask does not apply to it.
- **Symlink containment is re-checked.** The bash sandbox refuses to traverse a symlink out of a mount; a real binary would follow it, so the check is repeated rather than inherited.
- **Host paths do not leak outward.** Match paths are mapped back to their mount path before the output is returned.

This does not widen what the agent can reach overall. The `grep` tool it replaces already handed real ripgrep the host path of an attached folder, and `docs/architecture/agent-sandbox.md` documents that the `python`/`node`/`tsx` hatches already run with the host user's full filesystem access. An absolute path that names no mount is therefore passed through untouched rather than rejected: it is far more likely to be a regex (`rg '/task/'`) than a path, and treating it as an escape would break ordinary patterns while closing nothing.

## Consequences

- Pipelines work in both directions: `rg -l TODO | head`, `rg --files -g '*.ts' | wc -l`, `rg foo > out.txt`, and `cmd | rg PATTERN`. This is the main ergonomic gain — search composes with the rest of the shell instead of being a separate tool surface.
- The pipe into `rg` is the one place a shim has to hand a real binary the shell's stdin rather than ignore it. ripgrep decides between reading stdin and walking the working directory by stat'ing fd 0, so an ignored stdin does not produce an empty search — it produces a full search of the task folder, reported as if it came from the pipe. Both directions are covered by tests.
- The full ripgrep flag set is available, including the ones the `grep` tool never exposed (`-l`, `-c`, `-o`, `--files`, `-t`, `--heading`, multiple globs).
- Search results are terminal output rather than a rendered result card. That is the one thing removing the tool costs.
- Behaviour now depends on the bundled ripgrep version rather than the just-bash version. `@vscode/ripgrep` ships ripgrep 15.
- Anything the sandbox's virtual filesystem models but does not put on disk would be invisible to `rg`. Today every mount is a real directory, so this is latent rather than live.
