# Masking the private dir stops the shell, not native interpreters

**Status:** resolved by moving the records out. Recorded 2026-07-20 while reviewing PR #66 (`workspace: hide the private dir from the agent's shell and file tools`). A chat's records (`chat.db`, `settings.json`) now live in its record folder in the workspace, `chats/<id>/`, and the folder its agent works in is a separate work folder in the workspace's machine folder, so no record sits under a native process's working directory and the mask, with every check built on it, is deleted (`split-chat-records.ts` moves existing chats). The account below is kept for why.

## Context

`tasks/<id>/.instrument/` holds task internals the agent has no reason to read: `task.db` and `settings.json`, which carries attached-folder **host** paths under its `state` key -- a machine-layout leak. (When this was recorded the state lived in a separate `state.json`; it has since been folded into the settings file.) Before PR #66 nothing stopped `cat .instrument/settings.json`.

PR #66 masks the directory at every layer that routes through the virtual filesystem: the bash sandbox (a decorator on the task mount), the dedicated file tools (`resolveAgentPath` / `resolveToolPath`), and the native-argument bridge (`resolveNativeHostPath` quarantine plus `bridgeInlineCodePaths`).

## What we found

**The mask is defense in depth, not a boundary.** It only exists inside the just-bash virtual filesystem. Native interpreters (`python`, `node`) run as real subprocesses with `cwd` set to the **real** task directory, so any file access they perform at runtime never passes through the mask.

Reproduced in one sandbox session via `pnpm --silent script:run-bash`:

```
python -c "open('.instrument/marker.txt','w').write('SECRET_MARKER_XYZ')"

cat .instrument/marker.txt   ->  BLOCKED (no such file or directory)
ls -a                        ->  .instrument absent from the listing
python -c "print(open('.instrument/marker.txt').read())"
                             ->  SECRET_MARKER_XYZ
```

A throwaway filename, so the repro demonstrates the write without clobbering a real task file; the mask does not distinguish between them. Native code both **reads and writes** the directory freely. `bridgeInlineCodePaths` only rejects _quoted_ `/task/.instrument` literals in `-c` / `-e` source; a relative `.instrument/marker.txt` inside the script is not that, and a path assembled at runtime never appears in the source at all. This is inherent to the "real-binary escape hatch" described in `docs/architecture/agent-sandbox.md` — it is not a defect in the mask.

Things that _are_ covered, and were checked rather than assumed:

- Relative, absolute, `..`-traversal, from-a-subdirectory, runtime-assembled, and glob spellings all collapse to the same check, because `MountableFs` normalizes and strips the mount prefix before the decorator sees a path.
- A symlink **planted directly on disk** pointing into the private dir does not leak: symlink resolution happens above the filesystem layer, so `cat` on the link routes the resolved path back through the mask and gets not-found.

## What closed it

Moving the private dir **out of the folder the agent works in**, so it is not reachable by a relative path from a native process's `cwd`. The records went to the chat's record folder and the work to a folder of its own; with nothing left to mask, the masked entries, the file-tool checks, `rg`'s deny globs and `du`'s skipped names were deleted.

## Guidance

- A record a native program must not read belongs outside every folder the chat's native reach opens, not inside one behind a mask: hiding a path in the shell's own filesystem holds only for the shell's own commands.
