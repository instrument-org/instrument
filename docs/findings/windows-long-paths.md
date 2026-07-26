# Windows long paths in the task directory

## Symptom

On Windows, `git clone` inside a task transfers every object and then fails at
checkout:

```
error: unable to create file packages/media/src/test/__screenshots__/player-loop-frame-accuracy.test.tsx/media-player-frame-1711-video-frame-91-loop-trim-after-step-back-chrome.png: Filename too long
… 28 more
Updating files: 100% (12570/12570), done.
fatal: unable to checkout working tree
warning: Clone succeeded, but checkout failed.
```

The agent usually recovers on its own — the observed run retried as
`--filter=blob:none --no-checkout` plus a `sparse-checkout` narrowed to the one
package it wanted, which never touches the long paths. So the task completes and
the failure reads as transcript noise, after burning a 40-second clone. What it
leaves behind is a repository whose working tree is missing files.

## Root cause

Two things multiply, and only one of them is ours.

**Git for Windows caps itself at `MAX_PATH` unless told otherwise.** Git
addresses files through the ANSI Win32 APIs, which stop at 260 characters,
unless `core.longpaths` is true — then its mingw compatibility layer switches to
the Unicode `\\?\`-prefixed APIs and the ceiling becomes ~32,767. This is a
Git for Windows setting, not an upstream one; it is not in `git-config(1)`, and
it is documented at
<https://gitforwindows.org/git-cannot-create-a-file-or-directory-with-a-long-path>.
Git checks that key and nothing else, so neither the machine-wide
`LongPathsEnabled` registry value nor a `longPathAware` application manifest
lifts the limit for git.

**Our prefix spends a large fraction of the 260 before the repo starts.** A task
working directory on Windows is

```
C:\Users\<user>\AppData\Roaming\Instrument\workspace\tasks\<task id>\work\
```

which is 105 characters for a 6-character username and a typical 40-character
task id, and up to 130 at the 63-character id `SubdomainPartSchema` allows. What
is left for everything inside the clone is 130-155 characters. A repository with
any nesting to it — `node_modules/.pnpm/<encoded name>/node_modules/...`,
generated API docs, deeply namespaced source trees — clears that easily.
Microsoft's own `MAX_PATH` page names this exact scenario: "you may hit this
limitation if you are cloning a git repo that has long file names into a folder
that itself has a long name."

Measured against the observed failure — a clone of `remotion-dev/remotion` into
`…\tasks\2026-07-26-image-generated-articles-docs-ai-skills\work\remotion-skills\`:

|                                                   |                                   |
| ------------------------------------------------- | --------------------------------- |
| Prefix before the repository's own paths          | 132 chars                         |
| The 11 distinct paths git refused                 | 265-283 chars, every one over 260 |
| Deepest path the later sparse checkout wrote fine | 229 chars                         |
| Longest single filename among the failures        | 75 chars, against NTFS's 255 cap  |

That last row is why `core.longpaths` is sufficient rather than merely helpful:
the failures are entirely about total path length, not component length, so
`\\?\` addressing clears all of them with room to spare.

## Fix

`core.longpaths=true` is forced two ways, because git reaches the task through
two paths:

- `FORCED_CONFIG` in `packages/workspace/src/lib/shell-commands/git.ts` prepends
  it as `-c` to every `git` shell command.
- `gitSubprocessEnv()` in `packages/workspace/src/lib/git.ts` sets it via
  `GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0`, which reaches a bare `git` a script or
  another escape hatch runs without the argv layer.

It has to arrive as command-line-or-env config rather than a config file. A
clone has no repository config to read yet, and `GIT_CONFIG_GLOBAL` is
deliberately empty (see `docs/architecture/agent-sandbox.md`), so the config
files that would normally carry the key are all out of reach or unread. Both
spellings also outrank a repository that ships `core.longpaths = false`.

## What this does not cover

Git is fixed; the 260-character ceiling is not. Anything else the agent runs
against the same deep paths is still subject to it:

- `pnpm`/`node` inside `work/`, where `node_modules/.pnpm/` is the deepest tree
  the agent routinely creates.
- `uv`/`python` in `work/.venv`.
- just-bash's own file operations, which go through Node's `fs`.

Opting the app in would take _both_ halves of Microsoft's contract: the
`longPathAware` manifest element on the executable _and_ the machine-wide
`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` registry
value. The registry half needs admin rights on the user's machine, so it is not
something the app can arrange for itself, which is why this stops at git.

## Why moving the workspace does not fix it

Relocating the workspace to `~/Documents/Instrument/` buys 16 characters:
`Documents\Instrument\` is that much shorter than
`AppData\Roaming\Instrument\workspace\`. Replaying the measured failure against
that shorter prefix, **4 of the 11 paths still exceed 260** — the move fixes
some of one clone and not the rest of the same clone, which is the worst
possible outcome: it makes the failure rarer and no less confusing.

It can also make things worse. On Windows, `app.getPath("documents")` resolves
`FOLDERID_Documents`, which OneDrive Known Folder Move redirects to
`C:\Users\<user>\OneDrive - <Organization>\Documents\` on managed machines —
longer than the AppData path it replaced, and now a sync root holding SQLite
databases (`.instrument/task.db`), virtualenvs, and `node_modules`. Files
On-Demand dehydrates files out from under running processes. macOS has the same
problem with iCloud Drive's Desktop & Documents sync.

A visible workspace is worth doing for discoverability, but it is a product
decision to be designed with sync detection, not a fix for this bug.
