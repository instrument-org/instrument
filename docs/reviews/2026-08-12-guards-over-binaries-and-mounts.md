# Guards over real binaries and mounts

Reviewed: `425f1fc1a..c2ee91221`

Asked for a review of the commits from 2026-07-05 through v1.6.0-beta.0 (`642af072e`), against `REVIEW.md`'s priority order: containment, packaging and release, data loss, privacy, agent-turn correctness. Read the current state of the highest-churn files in those areas plus the full diff of `packages/workspace/src/lib/` and `apps/studio/src/electron-main/`. Re-validated at `c2ee91221`, 139 commits later, which added the `/project` mount and finding A, and re-checked unchanged at `451daa198` on 2026-08-12. Every finding was reproduced against the real binary or the real resolver, not inferred from reading. The theme: guards over real binaries and mounts, each with a sound rationale, one token or one mount away from applying, three of them with tests that passed while the bypass worked. Checked and clean, so not re-derived: the renderer imports no Electron or Node built-ins; `rehype-raw` runs only on the release-notes route; Mermaid runs at `securityLevel: "strict"`; the `webview` attach hook pins `contextIsolation`, `sandbox` and `webSecurity`; `guardNavigation` plus `openExternal`'s protocol allowlist cover both navigation shapes; the `app://` vendor path pattern makes `..` unspellable; `openTaskFile`/`openTaskFileWith` validate the path and the chosen app; `effectiveFolderAccess` canonicalizes both paths before the workspace-overlap check; the writable-mount resolver re-checks symlink containment; the asset origin's private-dir check matches the segment anywhere in the path.

## Findings

### A. The project mount's private dir is readable and writable outside bash

- Status: fixed `5981801ec`
- Where: `resolve-agent-path.ts:317-318`, [workspace-fs-layout.ts:440](/packages/workspace/src/lib/workspace-fs-layout.ts#L440); the mount at [workspace-fs-layout.ts:229-240](/packages/workspace/src/lib/workspace-fs-layout.ts#L229-L240)
- What: `/project` mounts read-write on the premise that `buildBashFs` masks its `.instrument`, but the private-dir check in `resolveAgentPath` and `resolveReadOnlyHostPath` applied only to the task mount, so `read_file`, `write_file`, `edit_file` and `rg` reached `/project/.instrument/settings.json`. An agent appending a read-write folder there got it mounted in every task of the project on the next turn. The fix makes the mask a property of the mount (`masksPrivateDir`) read by every resolver and by `buildBashFs`.

### B. The `rg` wrapper's private-dir guard does not hold

- Status: fixed `83877beaa`
- Where: [rg.ts:81-82](/packages/workspace/src/lib/shell-commands/rg.ts#L81-L82), [rg.ts:155-170](/packages/workspace/src/lib/shell-commands/rg.ts#L155-L170)
- What: a relative operand (`rg NEEDLE .instrument/state.json`) skipped `bridgePathArgs` and ripgrep does not filter explicit operands by `--glob`; a later positive glob (`--glob '.instrument/**'`, `--iglob '.INSTRUMENT/**'`, `-g '**'`) overrode the prepended deny. `rg.test.ts` passed throughout. The fix appends the deny in both `--glob` and `--iglob` spellings and resolves every non-flag argument through the sandbox's `resolvePath`.

### C. A late install failure latches the updater until restart

- Status: fixed `c42b8a274`
- Where: [create-app-updater.ts:473](/apps/studio/src/electron-main/lib/create-app-updater.ts#L473), [create-app-updater.ts:517-537](/apps/studio/src/electron-main/lib/create-app-updater.ts#L517-L537)
- What: `runInstall` reads the failure synchronously after `updater.install()`, but on macOS Squirrel's error arrives after it returns, so `installRequest` stays `{type: "installing"}` and every later click joins it without installing. The tests emitted the error synchronously. The fix clears `installRequest` in the `failed` handler.

### D. The `git config` write denylist has two one-token bypasses

- Status: fixed `235f6d247`
- Where: [git.ts:351](/packages/workspace/src/lib/shell-commands/git.ts#L351)
- What: the key was the first non-flag token after `config`, so `git config set alias.x '!cmd'` (git 2.46+) and `git config --file .git/config alias.x '!cmd'` both wrote an alias git runs through `sh`. The fix refuses any argument that parses as a blocked key, which also refuses reading one.

### E. The `rg` `-z` denial is defeated by flag bundling

- Status: fixed `83877beaa`
- Where: [rg.ts:190](/packages/workspace/src/lib/shell-commands/rg.ts#L190)
- What: the short-flag check matched only all-letter clusters, so `rg -zC3 needle file.gz` decompressed. The fix walks the cluster up to the first value-taking flag, so `-ez` (`-e z`) stays allowed.

### F. `agent-browser read <url>` fetches private addresses with no check

- Status: open
- Where: [agent-browser.ts:317](/packages/workspace/src/lib/shell-commands/agent-browser.ts#L317)
- What: a bare `read <url>` is answered by a plain HTTP fetch outside the just-bash network policy, so `read http://127.0.0.1:<port>/` returns the page while `curl` and `web_fetch` refuse it. Four paths answer "may this reach a private address" three ways.
- Note: left open deliberately on 2026-08-12. Blocking `read` alone also refuses the agent its own localhost preview and leaves `open` then `text` reaching the same page, so the fix is a decision: one owner and one predicate for private addresses, including whether the chat's own origin is an exception. Still no check at HEAD.

### G. A search pattern that starts with a mount point is bridged as a path

- Status: open
- Where: [rg.ts:164-167](/packages/workspace/src/lib/shell-commands/rg.ts#L164-L167)
- What: `bridgePathArgs` rewrites any argument starting with a mount point, so `rg '/task/output'` searched for the host path as text.
- Note: since `beb9bc00c` the agent works at real paths, so a pattern under a folder is rewritten only where the shell and host spellings differ, but a pattern that looks like a path outside every folder is now refused as a read outside the folders. Not re-verified by running it.

### H. Windows leaves `command-output-<runId>` logs in the agent's work folder after a hard kill

- Status: open
- Where: [agent-browser.ts:1034-1035](/packages/workspace/src/lib/shell-commands/agent-browser.ts#L1034-L1035)
- What: on Windows the wrapper writes stdout and stderr to files in the screenshots folder and removes them in a `finally`; a hard kill leaves them where the agent sees them and reports them as its own changes. Unchanged at HEAD.

### I. Any ancestor named like the home folder is relabeled `Home`

- Status: superseded `beb9bc00c`
- Where: `assign-mount-names.ts:69`
- What: a namesake-collision qualifier compared an ancestor segment with `path.basename(os.homedir())`, so an unrelated folder with that name was labeled `Home`. The file was deleted when the agent moved to real paths.

### J. Attached folders were qualified with an ancestor even without a collision

- Status: fixed `bcfceb033`
- Where: `assign-folder-names.ts:52-57` at `642af072e`
- What: `~/Documents/test` mounted at `/mnt/Documents-test`, and the agent called it "the documents-test folder". Found in the first pass and fixed before the re-validation.

### K. Suffix byte ranges are answered 416

- Status: open
- Where: [serve-static.ts:59](/packages/workspace/src/logic/server/serve-static.ts#L59)
- What: the range parser requires a start offset, so `Range: bytes=-500` (the last 500 bytes) is refused with 416.
- Note: dropped from the original review as pre-existing and out of scope, and described there only as "the suffix-range nit"; the reading here is from the code, still unchanged at HEAD.

## Not covered

Renderer UI components (document viewers, the prompt editor, the transcript rework that was most of the 08-05 to 08-10 churn), the seeded-workspace and skills-registry tooling, evals, and the oxlint/oxfmt migration.
