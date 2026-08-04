# Plan: seeded workspaces on the Windows test host

Status: not started. Depends on the seeder ([seeded-test-workspaces.md](./seeded-test-workspaces.md)) and the Windows host helper, both of which have landed.

Owner: whoever owns `.agents/skills/test-studio-on-windows/`. The seeder side is done and needs nothing from this work.

## What this is for

`studio-drive.mjs boot --workspace <fixture>` builds a disposable workspace from a committed description and boots Studio against it, so a scripted run stops depending on what the machine happened to do last. That works on macOS and Linux. On Windows it is unreachable, and the reason is structural rather than a bug.

The goal: `windows-studio-host.mjs start --host <ssh-host> --target dev --workspace documents` brings up the Windows dev build against a seeded workspace, and everything downstream (`goto`, `click`, `shot` through the tunnel) works unchanged.

## Why it does not work today

The two scripts divide the job, and the seeding sits on the wrong side of that line.

- `studio-drive.mjs` owns **driving**, over CDP. Against Windows it is used only with `--port` pointed at an SSH tunnel. That path never touches seeding: `prepareWorkspace` has one caller, `cmdBoot`, and `resolvePort` returns on `--port` before reading any instance record. So the Windows flow is unaffected by the seeding work, and will stay that way.
- `windows-studio-host.mjs` owns **lifecycle** on the host. It starts Studio with `Start-ScheduledTask`, and per the enrollment contract the task's environment (`REMOTE_DEBUGGING_PORT`, `PATH`, `DISABLE_AUTO_UPDATE_POLLING`) is baked into the task definition rather than passed per start. There is nowhere for a per-run `ELECTRON_USER_DATA_DIR` to go.

`studio-drive`'s own `boot` is not the answer on Windows and should not be made to be. It has been POSIX-only since before the seeding work: it spawns `pnpm` (which is `pnpm.cmd` on Windows, and Node has refused to spawn `.cmd` without `shell: true` since 18.20.2 / 20.12.2), it relies on `detached` process groups, and `stop` sends `SIGTERM` to a negative pid. That is precisely why the enrollment contract has the scheduled task run `pnpm.cmd run dev` itself.

## What the seeder already gives you

The seeder side needs no changes. It was audited for this and is platform-clean:

- No platform branches, no hardcoded separators. The only `os.homedir()` is the recorder's redaction check, which is correct everywhere.
- The cache root already prefers `LOCALAPPDATA`, then falls back to `XDG_CACHE_HOME` / `~/.cache`.
- Manifest `files[].to` paths stay POSIX in the manifest and resolve correctly under `path.win32`, with `..` traversal still rejected.

So `pnpm workspace:seed --out <dir> --fixture documents` is expected to work on Windows as-is. It has not been run there — verifying that is the first step below, and if it fails the fix belongs in the seeder, not in the host helper.

## Steps

### 1. Confirm the seeder runs on the host

Over SSH, with `nodeHome` prepended to `PATH` (noninteractive SSH does not initialize `fnm`):

```powershell
Set-Location $profile.repo
& (Join-Path $profile.nodeHome "pnpm.cmd") workspace:seed --out "$env:LOCALAPPDATA\instrument-seeded\documents" --fixture documents
```

Expect a JSON summary on stdout with `tasks[].id` equal to the fixture's task keys. Check the seeded tree looks right: `workspace\tasks\generated-pdf\.instrument\task.db` and `workspace\tasks\generated-pdf\output\red-and-blue-squares.pdf`.

Two things to watch, both cheap to fix in the seeder if they bite:

- The workspace digest hashes `path.relative` output, which is backslash-separated on Windows. Harmless, because the digest is only ever compared against a marker written on the same machine, but it means the marker is not portable between hosts.
- The repo has no `.gitattributes`. `session.json` is single-line superjson so CRLF conversion is close to a non-event, and git detects the PDF as binary, but if a checkout ever mangles a transcript this is where to look.

### 2. Decide where the seeded workspace lives

Under `LOCALAPPDATA`, keyed so two fixtures do not collide, and never inside the checkout. The host profile (`%USERPROFILE%\.instrument\studio-host.json`) is the right place to record the root, alongside the existing machine-specific values, so no path is embedded in a repo file.

### 3. Teach the scheduled task to take a workspace

This is the real work, and the shape depends on a choice the owner should make:

- **Rewrite the task action per start.** `start --workspace <name>` seeds, then updates the dev task's environment to carry `ELECTRON_USER_DATA_DIR` and `SKIP_ONBOARDING=true` before `Start-ScheduledTask`. Most flexible, but it mutates enrolled state on every run, so `status` should report which workspace the task currently points at, and a plain `start` with no `--workspace` must put it back.
- **A second scheduled task.** Enroll a `dev-seeded` target whose action already sets both variables and reads the workspace root from the profile. Nothing is rewritten at run time and `status` stays honest, at the cost of another enrolled task and a third `--target` value.

The second is more in keeping with how the host contract works now: enrollment is where machine state is established, and the helper only starts, stops and reports. Prefer it unless per-run flexibility turns out to matter.

Either way `SKIP_ONBOARDING=true` is required. A seeded workspace has no provider credentials and must not have any, so without it the app opens the onboarding window and never reveals the main one, which reads as a hang.

### 4. Reap on the host

`studio-drive` drops workspaces untouched for two weeks and installed dependencies inside a task after three days. The Windows host needs the same or it accumulates. It can be a step inside `start`, mirroring `reapStaleWorkspaces` / `reapWorkArtifacts`.

### 5. Document and verify

Add the flag to the skill's start/stop sections, and note in `host-enrollment.md` whichever contract change step 3 lands on. Verify the whole path end to end: seed, start, tunnel, then `goto /tasks/generated-pdf` and a screenshot showing the fixture's task, with the composer reading "No models available" — which is the tell that the workspace is genuinely the seeded one and not the developer's.

## Not in scope

The packaged product. `ELECTRON_USER_DATA_DIR` is honoured by any build, but `__studioDrive` ships only in a dev build, so the `installed` target keeps using `eval`/`click`/`wait` and has no reason to want a seeded workspace.

Making `studio-drive boot` work on Windows. Four separate POSIX assumptions would have to go, and the result would duplicate what `windows-studio-host.mjs` already does correctly.
