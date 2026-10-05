# Plan: one path namespace for a chat and its tasks

Status: active.

## Problem

A chat and the tasks it starts see the same folders at different paths. `assignMountNames` names a task's folders uniquely within that task alone, so `/mnt/Home/Downloads` in the chat is `/mnt/Downloads` in the task, and every message between them goes through `translateMountPaths`, which finds paths in free prose by guessing where each one ends (`PATH_ENDS`, `MAYBE_PATH_ENDS`, every ending tried in `readSubpath`). The brief guard built on the same guessing has been made stricter and looser four times (5686f5dc5, a3818dea2, 48dc17650, f58340814).

Below that, two questions about a host path are answered several ways each. Whether one is masked is re-derived with its own case folding in `mask-private-dir-fs.ts`, `resolve-agent-path.ts`, `du.ts` and `rg.ts` (fixes 42ccd9293, fd2b69a2a, 4d3c3a75c), and host paths are scrubbed from output four ways (`redactHostPaths`/`redactTaskDir`, agent-browser's `scrubHostPaths`, rg's `virtualizeOutput` that git and the bash tool borrow). And `shell-commands/task.ts` is about 2,000 lines with fifteen subcommands whose flag parsing passes an unknown `--flag` through as brief text.

## Steps

Each step is one or more commits that keep both packages' types and the workspace suite green.

1. **Chat-wide mount names.** A task the chat starts mounts each folder at the path the chat reaches it by: `--folder /mnt/Home/Downloads` mounts at `/mnt/Home/Downloads` in the task, and the workspace folder at the chat's `/mnt/Instrument`. The name is decided once, when the folder is granted (`task new --folder`, `task folder --add`), and stored as the grant's `mountName`, which may now hold `/` (`attachedFolderMountPoint` keeps the segments). A task's `/mnt` is then a subset of the chat's. Since `MountableFs` refuses a mount inside another, a grant that would sit inside or around one the task already has is refused, saying which to remove. The `:rw`/`:ro` on a spec reaches the grant again (lost in 3dcf5ccd3, which made every handed folder read and write). `translateMountPaths`, `unreachableMountPaths` and the path-end guessing go; the brief guard becomes a prefix check of each chat mount path in the text against the paths handed. `/task` to `/tasks/<id>` stays as the one fixed swap.
2. **One classification of a host path.** `classifyHostPath(layout, hostPath, via?)` answers the owning mount and virtual path, the masked entry it is or is inside (asked of every mount whose real root holds it, so a task's private dir is masked whichever mount reaches it), and whether it escapes its mount through a symlink. It canonicalizes once: realpath through missing segments, compared without case on a case-insensitive volume. `resolveReadOnlyHostPath`, the file tools, `rg`, `du`, `git`, agent-browser's file URLs, and the CDP bridge's file check (`agentPathOfFileUrl`) use it.
3. **One output virtualizer.** `virtualizeHostPaths(text, layout)` rewrites every mount's host root to its mount point, the task folder to `.`, and the home folder to `~`, in every spelling (`pathVariants`), longest first in one pass. `filterShellOutput` takes the layout and calls it, so the foreground hatches, the background sink, `rg`, `git` and agent-browser all print the same paths.
4. **Subcommands.** `defineSubcommands({ name: { flags, booleans, repeatable, positional, run } })` parses each subcommand's flags, refuses an unknown one with the subcommand's usage, and turns a thrown error into exit 1 on stderr. `task.ts` splits into one module per subcommand on it; `chat`, `memory` and `tab` move onto it where the move is cheap. What a command prints is unchanged apart from the new refusals.
5. **Docs.** `agent-sandbox.md` and `bash-sandbox-mounts-and-native-binaries.md` describe the shared names, the classification and the virtualizer; this plan moves to `completed/`.

## Existing tasks

A task granted folders before step 1 keeps the names on its record, since its transcript and its session context already use them and renaming a mount under a running agent breaks both. Where a stored name is not the chat's path for that folder, the two are swapped by exact prefix (`/mnt/Downloads` for `/mnt/Home/Downloads`), both ways, in what crosses between them. That swap knows both whole prefixes, so it guesses nothing about where a path ends, and it is empty for every task granted after step 1. Tasks the 1.x adoption brings in have no chat and were never translated, so they are untouched. No data is rewritten.

## Checks

- Unit: grant names, nesting refusal, the `:ro` grant, the prefix guard, the legacy swap, `classifyHostPath` (case, symlink escape, masked through another mount), `virtualizeHostPaths` (spellings, nesting, home), unknown-flag refusals.
- `run-bash`: a task layout with a nested name (`/mnt/Home/Downloads` with nothing at `/mnt/Home`) lists, reads and writes.
- Evals, before and after step 1, on Workers AI: `chat-hands-over-a-folder`, `chat-widens-a-running-task`, `chat-one-file`.

## Out of scope

The chat and task prompts beyond what step 1 forces; the Result library; Studio's own local-file policy for guest pages, which confines a page to its folder rather than to the layout.
