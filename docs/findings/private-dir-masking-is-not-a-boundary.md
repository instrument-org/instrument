# Masking the private dir stops the shell, not native interpreters

**Status:** open — known gap. Recorded 2026-07-20 while reviewing PR #66 (`workspace: hide the private dir from the agent's shell and file tools`). Last updated 2026-07-20.

## Context

`tasks/<id>/.instrument/` holds task internals the agent has no reason to read: `task.db`, `state.json` (which carries attached-folder **host** paths, a machine-layout leak), and settings. Before PR #66 nothing stopped `cat .instrument/state.json`.

PR #66 masks the directory at every layer that routes through the virtual filesystem: the bash sandbox (a decorator on the task mount), the dedicated file tools (`resolveAgentPath` / `resolveToolPath`), and the native-argument bridge (`resolveNativeHostPath` quarantine plus `bridgeInlineCodePaths`).

## What we found

**The mask is defense in depth, not a boundary.** It only exists inside the just-bash virtual filesystem. Native interpreters (`python`, `node`) run as real subprocesses with `cwd` set to the **real** task directory, so any file access they perform at runtime never passes through the mask.

Reproduced in one sandbox session via `pnpm --silent script:run-bash`:

```
python -c "open('.instrument/state.json','w').write('SECRET_MARKER_XYZ')"

cat .instrument/state.json   ->  BLOCKED (no such file or directory)
ls -a                        ->  .instrument absent from the listing
python -c "print(open('.instrument/state.json').read())"
                             ->  SECRET_MARKER_XYZ
```

Native code both **reads and writes** the directory freely. `bridgeInlineCodePaths` only rejects _quoted_ `/task/.instrument` literals in `-c` / `-e` source; a relative `.instrument/state.json` inside the script is not that, and a path assembled at runtime never appears in the source at all. This is inherent to the "real-binary escape hatch" described in `docs/architecture/agent-sandbox.md` — it is not a defect in the mask.

Things that _are_ covered, and were checked rather than assumed:

- Relative, absolute, `..`-traversal, from-a-subdirectory, runtime-assembled, and glob spellings all collapse to the same check, because `MountableFs` normalizes and strips the mount prefix before the decorator sees a path.
- A symlink **planted directly on disk** pointing into the private dir does not leak: symlink resolution happens above the filesystem layer, so `cat` on the link routes the resolved path back through the mask and gets not-found.

## What would actually close it

Move the private dir **out of the task root**, so it is not reachable by a relative path from a native process's `cwd` (e.g. a sibling `tasks/<id>.private/` or a central store). Then there is nothing to mask, and the bash decorator, the file-tool checks, and the inline-code guard can all be deleted.

The cost is the on-disk layout change: `tasks/<id>/.instrument/{task.db,state.json}` is documented in `CLAUDE.md` and assumed by task export/zip and `get-task-files` / `task-dir-utils`.

## Guidance

- Treat the mask as **friction that stops the agent from casually reading task internals**, which is what it is good at. Do not build anything on it that assumes the agent _cannot_ reach `.instrument`.
- If the contents ever become genuinely sensitive (credentials, tokens), the layout change above is required first — masking is not sufficient.

## Related

- `packages/workspace/src/lib/mask-private-dir-fs.ts` — the decorator, with the reason it is a decorator rather than a nested mount.
- Upstream `MountableFs` refuses to mount inside an existing mount, which is why the obvious two-line version does not work. A patch enabling nested mounts would let the decorator collapse back to a single `fs.mount(...)` call.
