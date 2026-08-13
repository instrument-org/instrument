# Skills mount instead of copy, and a task installs once

Status: in progress. Steps 1 and 2 landed; step 3 pending.

Supersedes one stated consequence of [skills as a mount, not a tool](../../decisions/2026-07-20-skills-as-a-mount-not-a-tool.md): "Running a skill's script still means loading the skill and running the copy under `work/skills/`."

## Problem

A task's Node dependencies live in as many places as it has loaded skills. `work/` is a pnpm workspace and each copied skill is a member package, so `work/node_modules` holds only pnpm bookkeeping and a skill's `sharp` is importable from exactly one subtree. Code the agent writes anywhere else cannot import it. That is the rule the prompt spends three sentences teaching and the one agents break.

Two beliefs motivated the current shape, and neither survived checking:

- **Per-skill lockfiles pin versions.** They do not. In a task, `work/` is the workspace root, so pnpm reads only `work/pnpm-lock.yaml`; the skill's own lockfile is a standalone-root file and is never consulted. The template ships a 114-byte lock, so a task resolves the caret range fresh at load time.
- **Agents edit skill scripts to change behavior cheaply.** Across 169 eval sessions and two full task transcripts there are zero `edit_file` calls under `work/skills/`. The one `write_file` is a new file, placed there only because that is where `sharp` resolves.

Meanwhile the copy costs a `pnpm install` on `load_skill`'s critical path, plus 253 files, 70 directories, and 17 symlinks per task. Disk is not the cost: pnpm clones on APFS, and cloning that tree moves free space by 780 KB against the 19 MB `du` reports.

## Step 2: one install per task

- Drop `packages: [skills/*, skills/*/*]` from the work template's `pnpm-workspace.yaml`.
- Move `package.json`, `pnpm-lock.yaml`, and `node_modules` to the task root, so the agent's working directory is the package root and anything under it resolves. `node_modules` and `pnpm-lock.yaml` are already excluded from the file index at every depth; only `package.json` becomes newly visible.
- Turn the boot migration's work-layout fold around. It moved these files into `work/` on every launch, which would have undone this on the next one; it now moves an existing task's package, lockfile, `node_modules`, venv, and temp dir up to the task root instead, and repoints the skill globs in the `pnpm-workspace.yaml` it brings with them. Without that a task made before the change keeps its manifest where nothing looks, so it reads as not-runnable and `pnpm add` has nothing to add to. The venv travels rather than being rebuilt: uv resolves `sys.prefix` from the interpreter's own location, and leaving it behind would cost the task every package installed into it.
- The rest of that migration stays. It is not all legacy: the folds added for the task record are what every existing workspace still needs at boot. The browser-profile cleanup beside it now spells its path out, because a clone only exists where the build that wrote one put it and the temp dir has moved since.
- Point `isRunnable` at the task root's `package.json`. It is what the heartbeat route answers `not-runnable` from, so a stale path silently reports every task as unrunnable. The check disappears with on-demand runtime creation; until then it has to follow the package.
- Lift the machinery out of `work/` too. The venv, the subprocess temp dir, and the tool-output spill logs move to the task root as `.venv`, `.tmp`, and `.tool-output`. The venv gains something by moving: `VIRTUAL_ENV` already points at it explicitly, and at the task root it is additionally where uv and python look for one by convention. The temp dir is renamed with a dot because the plain name was chosen to keep leftover temp data browsable, and it is now excluded from the file index.
- `work/` survives as plain scratch, holding what the agent writes plus `screenshots/`. Its one remaining job is keeping intermediates out of `attachments/`, `downloads/`, and `output/`: nothing distinguishes a scratch file from a deliverable by name, so the folder is what keeps the per-turn change list meaning "the agent made you something". Being a subdirectory of the package root, anything written there resolves the task's dependencies by walking up.

The resulting layout, with everything machine-generated either dot-prefixed or excluded from the file index:

```
/task/                      working directory and package root
  package.json              indexed
  pnpm-workspace.yaml       indexed (settings only, no packages key)
  pnpm-lock.yaml            excluded
  node_modules/  .venv/  .tmp/  .tool-output/
  attachments/              the user's inputs
  downloads/                what the agent fetched
  output/                   deliverables
  work/                     scratch, plus screenshots/
```

## Step 3: mount instead of copy

Skills stop being copied into the task. What the agent sees:

```
/skills/instrument/<name>/     read-only    materialized from the app bundle
/skills/<agent>/<name>/        read-only    mounted in place from a co-installed agent's home
/skills/workspace/<name>/      read-write   mounted from the workspace's own skills dir
```

Both bundled sources share the `instrument` segment. They materialize into one flat prepared directory, which is what makes a name collision between them worth a CI check and what stops them being told apart here.

A fourth source is dropped rather than given a segment. `<workspace root>/.agents/skills` was picked up alongside the vendor conventions, but `.agents/skills` means "skills belonging to this code repository" and the workspace root is not one. The naming inherited the mistake at every layer: the source is `project`, the origin is `in-repo`, and `load_skill` tells the agent a skill "lives in this project" when it lives beside the workspace's own skills folder and differs from it only by being read-only. Removing it takes the segment, the origin, and a branch of `load_skill`'s origin note with it. Repo-local skills, if they are ever wanted, belong under a project's own folder where the convention means what it says.

The source segment carries provenance and writability, so the agent never has to infer either. `load_skill` returns the instructions, the base directory, and a sampled file list rather than copying anything.

The workspace's own skills move with everything else. Today they are the whole of `/skills`, mounted flat, so a skill sits at `/skills/<name>`; under the new layout it sits at `/skills/workspace/<name>` and the read-only sets become its siblings rather than an absent third thing. A uniform layout is worth the relocation: with the workspace set flat and other sources nested beneath it, `/skills/claude` would read as either a source or a skill depending on what the user had named their folders.

That path is written down in more places than `load_skill`, and all of them have to move together or the agent is told one thing and the filesystem enforces another:

- The agent prompt, which names `/skills/` as the workspace's own skills folder and as the mount the read-only ones are *not* in.
- The bash tool description's list of what exists.
- `validate-skill`, which enforces the prefix, enumerates the directory, and reports a checked skill's path.
- `load_skill`'s origin note and its "copy it here to change it" hint.
- Studio's skill modal, which shows the user where a skill they create will live.

### Addressing a file the agent names

A reply names its files itself, in a fence and in links, and nothing walks the task to find them. That is what makes a skill path reach the renderer at all, and it lands on two surfaces built when everything outside the task was either an attached folder or the project:

- `isAddressableTaskFilePath` accepts a relative path or one under the attached-folders mount, and nothing else. A skill path fails it, so the reply draws it as prose rather than something to click, and `show` rejects it with "outside the task and its mounts".
- The assets route prefixes the task mount to any path not already under the attached-folders or project mount, so a linked skill file resolves inside the task folder and 404s. Its own comment names this failure: a path under an unserved mount reads as a missing file rather than an unserved one.

Both need the skills mount added. Neither is load-bearing today, because `work/skills/` is task-relative and reaches both surfaces as an ordinary task path. The move is what surfaces them, and a skill file the agent cannot link to is a worse answer than the copy it replaces.

Bundled skills cannot run from the app bundle: `registry/skills` ships via `extraResources` into a signed, hardened-runtime, notarized bundle that the updater replaces wholesale, so nothing may write a `node_modules` there. They are materialized once per machine instead, into `userData/skills/<name>/`, beside the existing app-managed `bin` and `uv`. That is outside the workspace deliberately, so several workspaces or a workspace the user relocates all source from one prepared set.

Third-party skills are mounted with whatever dependency state they already have. We do not install for skills we do not ship, and the ecosystem rarely needs it: `anthropic-skills` contains no `package.json` at all, and one large real-world skill audited for this plan has zero dependencies across 147 files and already documents running its scripts from a base directory the harness reports.

Python needs no change. `installPythonSkill` targets the task venv, and `VIRTUAL_ENV` resolution is location-independent, so a Python skill's script already runs correctly from a read-only mount.

### Materialization

A marker written last, `{ appVersion, ok: true }`, is the whole invalidation mechanism. Bundled skills are byte-identical for the lifetime of an installed version, so the app version is not an approximation of the signal but the signal itself.

- Marker present and version matches: mount.
- Version differs: re-materialize.
- Marker missing: a previous attempt died, so wipe including `node_modules` and start clean.

Re-materializing keeps `node_modules` and lets `pnpm install` reconcile it, which avoids the slow recursive delete on Windows. `appVersion` is constant for the lifetime of the process, so this runs at most once per skill per app run, always inside `load_skill` under a per-skill lock, and never while another task holds a live mount of a different version. In dev the bundle source changes while the version sits still, so the gate folds in the source tree's newest mtime there.

A fingerprint committed alongside each skill and checked in CI is worth having for dedupe and release reporting, but not as the invalidation gate: a committed hash can go stale and would then silently pin every user to an old skill forever, where a build-derived version stamp cannot.

### Dependencies

Two locations, each with one job:

- `userData/skills/<name>/node_modules` for a bundled skill's own shipped scripts. One install per skill, shared by every task and workspace.
- `<task>/node_modules` for everything the agent writes. It runs `pnpm add` itself, and `load_skill` reports the range the skill was tested against.

Skills keep caret ranges rather than exact pins: portable to any package manager, still picking up patch fixes, guarded by the existing 7-day `minimumReleaseAge`, with reproducibility coming from CI installing and testing the bundled set together.

Because the bundled mount is read-only, the agent cannot place a custom script beside a skill's dependencies. The layout enforces what the prompt used to ask for.

### Sandbox change

`resolveNativeHostPath` bridges only the task mount, which is why copies exist. It needs to resolve the skills mount for executing subprocesses. `resolveReadOnlyHostPath` already resolves the full layout for read-only binaries, including the symlink-escape recheck a real binary needs, so the machinery exists.

It does widen what a subprocess can reach, and the widening is worth stating plainly rather than waving through on the grounds that the agent already runs this code. Today a script runs from a per-task copy, so a script that writes beside itself writes into one task. Mounted, the same write lands in the prepared set every task and every workspace shares, or in a third-party skills folder belonging to whichever tool installed it. `resolveReadOnlyHostPath`'s own contract says its wider reach is safe only because callers reject the flags that let a binary write or execute, which is not something an interpreter can be made to do.

**Decided: accept the drift, and assert against it in CI.** The prepared directory is not made unwritable through filesystem permissions. A real subprocess already has the host user's full filesystem, by design and by [decision record](../../decisions/2026-07-15-userland-agent-sandbox.md), so a skill script writing beside itself is a hygiene problem rather than a boundary being crossed. Permissions here would be the strictest mechanism in a system that chose userland containment everywhere else, guarding against something any task script can already do by other means.

It is not a new capability either. A skill already runs from a copy inside the task mount, which is bridged, so the same write already happens today and lands in a copy that dies with the task. What the mount changes is where it lands, not whether it can.

What carries the weight instead is that the bundled set is ours. CI already installs and tests it together, so it runs those tests against a read-only prepared directory and fails on anything that writes beside itself: build-time, no platform-specific permission code, and covering the only skills we can make promises about. Third-party skills are mounted with whatever their installer left them as, and are out of scope by construction.

## Registry

Landed in the skills registry, not here, and the harness change does not wait on it: an out-of-date `tsx` in a skill's instructions makes that one command fail with `command not found`, not the task.

- The SKILL.md generator picks the runner name for every skill it renders, so changing the one constant there and regenerating covers most of it. Four skills also spell `tsx` out in prose in their templates, and three Python scripts name it in the error they print when their TypeScript bridge is missing.
- Add `erasableSyntaxOnly` to the skill tsconfigs. Nothing in the registry violates it today, and its CI is the only place a real `tsc` still runs, so it is the only place the constraint can be caught before a skill ships.

## Verification

Re-run a task prompt that loads a skill and writes its own code against that skill's library, across the model set, and compare against the two recorded baselines: tool-call count, files written into skill folders, and whether anything still tries to path into `node_modules` by hand.
