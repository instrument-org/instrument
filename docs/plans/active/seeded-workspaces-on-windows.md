# Plan: seeded workspaces on the Windows test host

Status: the helper side has landed; enrolling and verifying a host has not. `windows-studio-host.mjs` grew a `dev-seeded` target and a `seed` command, and the skill documents both. What remains is machine state and evidence: add the `devSeeded` block to a host profile, create the seeded scheduled task, and run steps 1 and 5 there. Nothing in the repo is waiting on that.

Owner: whoever owns `.agents/skills/test-studio-on-windows/`. The seeder side is done and needs nothing from this work.

## What this is for

`studio-drive.mjs boot --purpose <purpose> --workspace <fixture>` builds a disposable workspace from a committed description and boots Studio against it, so a scripted run stops depending on what the machine happened to do last. That works on macOS and Linux. On Windows it is unreachable, and the reason is structural rather than a bug.

The goal: `windows-studio-host.mjs start --host <ssh-host> --target dev-seeded --workspace documents` brings up the Windows dev build against a seeded workspace, and everything downstream (`goto`, `click`, `shot` through the tunnel) works unchanged.

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

### 2. Where the seeded workspace lives

`devSeeded.userDataDir` in the host profile (`%USERPROFILE%\.instrument\studio-host.json`), so no path is embedded in a repo file. One directory, not one per fixture: the scheduled task's environment is fixed at enrollment, so the path cannot vary per run without either rewriting the task or pointing it at a junction the helper repoints. Neither is worth the moving part when switching fixtures costs a reseed of a few seconds, and the seeder already rebuilds a directory whose fixture digest no longer matches. Which fixture is in there comes from the seeder's own marker, so `status` reports it without the helper recording anything.

The helper refuses a `userDataDir` that is relative or inside the checkout, before anything is written. The seeder covers the other direction by refusing to clear a directory it did not create, which is what stands between a typo and someone's real tasks.

### 3. The seeded scheduled task

Landed as the second option: a `dev-seeded` target with its own task, CDP port and user data directory, whose action already sets `ELECTRON_USER_DATA_DIR` and `SKIP_ONBOARDING=true`. Nothing is rewritten at run time, a plain `start --target dev` is untouched, and `status` reports each task's real action. `start` validates both variables against the profile before it starts anything.

Two consequences worth knowing:

- Both dev targets run `pnpm dev` from the same checkout, and a process carries the checkout path on its command line but not which workspace it was pointed at. So `stop` on either one stops both, and stops both tasks: a task left `Running` with nothing behind it makes the next `Start-ScheduledTask` a silent no-op.
- Seeding rewrites the directory the app has open, so it only runs when that target's CDP port is dead. A live instance already holding the requested fixture is reused; one holding another fixture, or a `--fresh` against a live one, fails and says to stop it first.

### 4. Reap on the host

Only the work artifacts, matching `reapWorkArtifacts`: installed dependencies inside a task, after three days. `reapStaleWorkspaces` has no counterpart, because there is one workspace directory rather than a growing set of them, and dropping it would only buy a reseed.

### 5. Document and verify

Documented: the `dev-seeded` target and the `seed` command in the skill, the profile block and the task contract in `host-enrollment.md`.

Not verified on a host. The generated PowerShell is parse-checked and its helper functions were driven against a real seeded workspace on macOS, which covers the marker reader, the reaper, the seeder invocation and the profile guards, but not `Get-ScheduledTask`, `Start-ScheduledTask` or the seeder running on Windows at all. Remaining, in order: step 1 above, then enroll the task, then the whole path end to end -- seed, start, tunnel, `goto /tasks/generated-pdf`, and a screenshot showing the fixture's task with the composer reading "No models available", which is the tell that the workspace is genuinely the seeded one and not the developer's.

## Not in scope

The packaged product. `ELECTRON_USER_DATA_DIR` is honored by any build, but `__studioDrive` ships only in a dev build, so the `installed` target keeps using `eval`/`click`/`wait` and has no reason to want a seeded workspace.

Making `studio-drive boot` work on Windows. Four separate POSIX assumptions would have to go, and the result would duplicate what `windows-studio-host.mjs` already does correctly.
