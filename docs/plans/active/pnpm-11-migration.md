# pnpm 10 -> 11 migration

Status: reopened. The version migration landed in `a7c117f2b` (`workspace,studio: migrate bundled pnpm to 11.10.0`), but a smoke test against beta.2 found the packaged app could not fork pnpm at all (`Cannot find module .../app.asar.unpacked/node_modules/pnpm/bin/pnpm.cjs`), so skill dependency installs were broken in production. A packaging fix followed (see "Packaging: pnpm must be explicitly unpacked" below). Not complete until a fresh packaged build passes smoke test 1.

Tracking: [FP-1202](https://linear.app/finalpoint/issue/FP-1202/pnpm-10-11-migration)

Moves the bundled package manager from pnpm 10.33.0 to **11.10.0** across the Instrument monorepo and the sibling `instrument-org/skills` repo.

## Why

The agent-facing reason is `pnpm dlx`. `npx`, `pnpx`, and `pnx` are all aliased onto it (`packages/workspace/src/lib/shell-commands/pnpm.ts`), so it is the one path where an agent downloads and immediately _executes_ an arbitrary package. On pnpm 10 that path ignores `minimumReleaseAge` entirely: with the gate set to one year, `pnpm dlx vite --version` still resolved and ran a build published five days earlier. The gate only ever covered `pnpm add`/`install`.

pnpm fixed this in 11.1.3 and did not backport it; `v10.34.5`'s `dlx.ts` has zero references to `minimumReleaseAge`. Upgrading is the only way to close it.

Secondary gains present in 11.10.0: lockfile entries are re-verified against the active policy before any tarball fetch (11.1.3), a store race that materialized packages without their root files is fixed (11.5.2), and macOS quarantine attributes are stripped from imported native binaries (11.8.0).

## Why 11.10.0 specifically (not latest, not 11.11+)

This is the counterintuitive part, learned the hard way. The version window is a minefield:

| version | status                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------- |
| 11.10.0 | **chosen** — last release before the deadlock regression                                            |
| 11.11.0 | electron-builder peer-resolution **deadlock** ([#12921](https://github.com/pnpm/pnpm/issues/12921)) |
| 11.12.0 | deprecated upstream as broken                                                                       |
| 11.13.0 | deprecated upstream as broken                                                                       |
| 11.13.1 | fixed + not broken, but 5 days old -> blocked by our own 7-day `minimumReleaseAge`                  |
| 11.15.1 | latest, also inside our own age gate                                                                |

**#12921**: PR #12847 split peer resolution into two traversals. A peer cycle spanning both passes (`electron-builder -> app-builder-lib -> dmg-builder`) is invisible to cycle detection, so the dep-path deferreds await each other forever and `Promise.all(finishingList)` never settles. `apps/studio` depends on `electron-builder@26.8.2`, which has exactly that structure, so a full resolve hangs with an idle Node event loop after "resolved 1848". Fixed in 11.12.0, but 11.12/11.13.0 are the broken releases and the clean fix (11.13.1+) is younger than our own gate.

**Updating electron-builder would not have fixed it** (a natural first instinct). The bug is in pnpm's peer-resolution algorithm, not electron-builder. The #12921 reporter was on `electron-builder@26.15.3` -- newer than our `26.8.2`, and the current latest -- and still deadlocked; the `dmg-builder` peer that forms the cycle is still present in current `app-builder-lib`. Downgrading pnpm (or the gated 11.13.1+, or `auto-install-peers=false`) was the only real lever.

11.10.0 predates the 11.11.0 regression, is 17 days old so it clears our gate, is not deprecated, and still carries every fix the migration is for. It also predates the interactive age-gate approval prompt ([#13019](https://github.com/pnpm/pnpm/issues/13019)), so a too-young package under `minimumReleaseAge` produces a clean _error_ the agent can act on, rather than an invisible prompt that hangs a non-TTY task install. That is arguably better for our sandbox than a newer release.

Revisit the pin once the 11.15.x/11.16 line ages past our 7-day gate; bump then.

## Debugging lesson: `managePackageManagerVersions` masks the running version

pnpm 11 self-manages to the `packageManager` field like corepack. Once `package.json` pins `pnpm@X`, _every_ pnpm invocation inside the repo re-execs version X, even when you call a different pnpm binary directly. `pnpm --version` run from the repo reports the pinned version, not the binary you launched.

This wasted a real chunk of debugging: tests "confirming" that 11.15.1 also hung were actually the pinned 11.11.0 re-exec'd. To genuinely test a version you must change the pin (env `pnpm_config_manage_package_manager_versions=false` does _not_ help; the re-exec decision happens before that config is read). Always verify with `pnpm --version` in-repo before trusting a version-specific result.

## Changes

### `instrument-org/skills`

- `package.json`: `packageManager` -> `pnpm@11.10.0`.
- `pnpm-workspace.yaml`: dropped `configDependencies: @pnpm/plugin-trusted-deps@0.2.0`, replaced with an explicit `allowBuilds` map (`esbuild`, `sharp`). The plugin writes the removed `onlyBuiltDependencies` key, so on pnpm 11 it silently becomes a no-op; only the unreleased `0.3.0-2` prerelease writes `allowBuilds`, not worth taking in the path that authorizes lifecycle scripts.
- `templates/basic/pnpm-workspace.yaml`: same plugin removal, plus `minimumReleaseAgeExclude: []`.
- All 13 lockfiles regenerated (dropping `pnpmfileChecksum`; removing spurious empty sibling `importers` entries pnpm 10 leaked). No dependency version changed. Verified: `install --frozen-lockfile` clean and 43/43 turbo checks pass on 11.10.0.

### Instrument monorepo

- `package.json`: `packageManager` -> `pnpm@11.10.0`.
- `apps/studio/package.json`: `pnpm` pinned exactly to `11.10.0` (not a caret range) so a future `pnpm update` cannot resolve onto the deadlocking 11.11.0 or the broken 11.12/11.13.0.
- `pnpm-workspace.yaml`: added `verifyDepsBeforeRun: false` (see below).
- `packages/workspace/src/lib/run-pnpm.ts`: `npm_config_*` -> `pnpm_config_*`. pnpm 11 stopped reading the `npm_config_` prefix, so the reporter and loglevel settings were about to become silent no-ops.
- `packages/workspace/src/tools/bash.ts`: the ignored-builds hint now keys off `"Ignored build scripts:"` alone. pnpm 11 emits that string two ways -- a warning box when `strictDepBuilds` is off, `ERR_PNPM_IGNORED_BUILDS` when it is on -- and the old check also required the literal `"Warning"`, so the hint would have gone missing exactly when the install hard-failed.
- `packages/workspace/templates/default/work/pnpm-workspace.yaml`: added `minimumReleaseAgeExclude: []`, `allowBuilds: {sharp: true}`, `strictDepBuilds: false`, and `verifyDepsBeforeRun: false`. Snapshotted in full by `initialize-task.test.ts` so weakening any of it shows up as a diff.

### `verifyDepsBeforeRun: false` (root and task template)

pnpm 11 defaults this to `install`: every `pnpm run`/`pnpm exec` verifies the store first and silently spawns a `pnpm install` when it looks stale. This is a poor fit for us and caused an actual incident during the migration -- the moment the `packageManager` pin changed but the lockfile hadn't regenerated yet, every agent's `pnpm exec turbo ...` and every dev-server command saw a stale store and spawned a competing install; those raced on the shared store and deadlocked, and each new command spawned another. Setting it to `false` restores the pnpm 10 behavior (run the command as asked, install only when asked) and stops the loop.

Applied in the task template as well: an agent runs its dev server plus other pnpm commands concurrently against the shared store, so the same deadlock is reachable inside a task. Install-on-run is not behavior we want there either.

## Known issues surfaced along the way

- **`skills/spreadsheet` had an unpinned tarball dependency.** `xlsx` is fetched from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (SheetJS is delisted from npm) and the lockfile recorded no `integrity`, so any bytes the CDN served were trusted. pnpm 11 rejects this (`ERR_PNPM_MISSING_TARBALL_INTEGRITY`). Regenerating the lockfile pinned a hash. **Caveat: trust-on-first-use** -- the hash was computed from what the CDN serves now. Cross-check against SheetJS's published checksum before fully trusting it.
- **dugite postinstall raced once** with `EEXIST` on `mkdir .../dugite/git/`. The git distribution was complete and functional afterward (2.47.1) and a rerun was clean, but pnpm does not retry a failed postinstall, so a genuinely partial extract would go unnoticed.
- **A partial/interrupted install leaves node_modules with missing native bindings** (e.g. `@parcel/watcher`), which surfaces as a "native bindings not available" error from watchers during checks. Resolved by letting one clean install complete.

## Packaging: pnpm must be explicitly unpacked

The packaged app forks `pnpm/bin/pnpm.cjs` as a subprocess to install task dependencies, so pnpm has to sit on the real filesystem (`app.asar.unpacked`), not inside the asar. On pnpm 10 electron-builder unpacked it automatically: pnpm 10 shipped a top-level native `reflink.*.node` in `dist/`, and electron-builder auto-unpacks any package it detects as native by walking the declared dependency graph. pnpm 11 broke both signals -- it declares no dependencies (everything is bundled into `dist/node_modules/`) and its reflink addon moved to `dist/node_modules/@reflink/reflink-<platform>-<arch>/`, so electron-builder no longer sees pnpm as native and packs it into the asar. The forked subprocess then can't read it: `Cannot find module .../app.asar.unpacked/node_modules/pnpm/bin/pnpm.cjs`. This is NOT the `.cjs`->`.mjs` change (pnpm 11 still ships `bin/pnpm.cjs` as a working shim); the file exists, it just wasn't on disk.

Fix (`apps/studio/electron-builder.ts`, `.../electron-builder/paths.ts`, `.../after-pack.ts`):

- Add `**/node_modules/pnpm/**` to `asarUnpack` so the whole pnpm package is unpacked.
- Add an `afterPack` guard (`verifyPackagedPnpm`) that fails the build if `pnpm/bin/pnpm.cjs` is missing from the unpacked tree -- the same pattern already used for ripgrep and uv. This converts a silent ship-broken into a loud build failure.
- Update `prunePnpmReflink`: it targeted the pnpm 10 `dist/reflink.*.node` layout and had silently become a no-op, so every build shipped all four foreign reflink packages. It now prunes foreign `@reflink/reflink-*` package dirs under `dist/node_modules/@reflink/`.

Requires a fresh packaged build to verify; smoke test 1 exercises exactly this path.

## Verification: agent smoke tests

Run against a **packaged build**, not `pnpm dev`. Each block is a prompt to paste into a new task, phrased as an ordinary request so it exercises the sandboxed pnpm path a user would hit. Only test 1 is platform-sensitive (`sharp` ships per-platform prebuilds; the macOS quarantine-strip is darwin-only). If you run one, run test 3 -- it is the regression this migration exists to fix.

The dlx gate (test 3) was already confirmed against the raw 11.10.0 binary outside the app: under a 1-year `minimumReleaseAge`, `pnpm dlx vite --version` ran vite 7.0.5 (aged) instead of the 5-day-old 8.1.5 that pnpm 10 ran. The smoke tests re-confirm it through the _packaged_ sandbox path, which is what ships.

### 1. Skill install with a native build (macOS / Windows / Linux)

> Load the sharp-images skill and use it to resize any image you generate to
> 100x100. Tell me the exact sharp version that got installed and whether its
> native binary loaded without errors.

Pass: the skill installs, `sharp` builds (the only entry in the task template's `allowBuilds`), and the resize produces an image.

### 2. Age gate on `pnpm add`

> In your work directory, run `pnpm add aws-cdk` and tell me which version landed
> in package.json. Then check npm for the newest published aws-cdk and tell me
> how old the one you installed is.

Pass: installed version is >= 7 days old and is not the newest on the registry.

### 3. Age gate on `pnpm dlx` -- the regression this migration fixes

> Run `pnpm dlx vite --version` in your work directory and tell me the exact
> version printed. Then tell me the publish date of that version and of the
> newest vite release on npm.

Pass: the version printed is >= 7 days old. On pnpm 10 this returns the newest release regardless of age. Repeat with `npx vite --version` and `pnpx vite --version` (same aliased path).

### 4. Build allowlist recovery (no hard dead-end)

> Add `esbuild` to the work directory with pnpm, then run `esbuild --version`. If
> anything fails, fix it and tell me what you changed.

Pass: install _succeeds_ with an "Ignored build scripts: esbuild" warning (not a hard error -- `strictDepBuilds: false`), the agent gets the hint from `bash.ts`, and recovers by adding `esbuild: true` to `work/pnpm-workspace.yaml`.

### 5. Exclusion injection is blocked

> Create a file `.npmrc` in your work directory containing exactly
> `minimum-release-age=0`, then run `pnpm add aws-cdk` and tell me which version
> installed.

Pass: still an aged version. `pnpm-workspace.yaml` outranks `.npmrc`.

## Rollback

Revert the three `packageManager`/`pnpm` pins and run `pnpm install`. Lockfile format is unchanged (9.0 on both 10.33.0 and 11.10.0), so lockfiles do not need reverting. The store does: v10 and v11 are separate directories, so a rollback re-populates the v10 store from cache. The `xlsx` integrity pin, the `pnpmfileChecksum` removals, and `verifyDepsBeforeRun: false` are all safe to keep on 10.
