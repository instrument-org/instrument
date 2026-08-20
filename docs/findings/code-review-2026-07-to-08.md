# Code review: guards over real binaries and mounts that do not hold

**Status:** one finding and three nits open, five findings fixed. First recorded 2026-08-05 reviewing 804 commits from 2026-07-05 to `c8a4c39ed` (v1.6.0-beta.0). Re-validated 2026-08-10 at `c2ee91221`, 139 commits later, which added the `/project` mount and one new finding. Every item below was re-reproduced at that revision.

Re-checked 2026-08-12 at `451daa198`: all six findings and all three nits still stood, unchanged. None of the files they name had been touched in between except by a repo-wide spelling pass (`df0aa68e5`).

Findings 1 through 5 were fixed the same day, each with the recorded repro as a test that fails against the code it describes. Finding 6 is open and is a decision rather than a fix; see its section. The three nits are open.

## Scope and method

Reviewed against `REVIEW.md`'s priority order: containment, packaging/release, data loss, privacy, agent-turn correctness. Read the current state of the highest-churn files in those areas plus the full diff for `packages/workspace/src/lib/` and `apps/studio/src/electron-main/`. Every finding was reproduced against the real binary, or against the real resolver in a throwaway test, not inferred from reading.

**Not covered:** renderer UI components (document viewers, prompt editor, the transcript rework that is most of the 2026-08-05 to 2026-08-10 churn), the seeded-workspace and skills-registry tooling, evals, and the oxlint/oxfmt migration. Those are the bulk of the line count and the lowest risk per line.

The theme is one shape repeated: this period added several guards over real binaries and real mounts, each written with a correct and well-argued rationale, and in five cases the implementation is one token or one mount away from not applying. Three have tests that pass while the bypass works.

| # | Where | What | Severity | 08-12 status |
|---|---|---|---|---|
| 1 | `lib/workspace-fs-layout.ts`, `lib/resolve-agent-path.ts` | The private-dir check is task-mount-only, so `/project/.instrument/settings.json` is readable **and writable** through the file tools and `rg` | High | Fixed, `5981801ec` |
| 2 | `lib/shell-commands/rg.ts` | Task private-dir guard bypassed two ways; `rg.test.ts` passes anyway | High | Fixed, `83877beaa` |
| 3 | `lib/create-app-updater.ts` | Install latch sticks on an async install failure; no retry without an app restart | High | Fixed, `c42b8a274` |
| 4 | `lib/shell-commands/git.ts` | `git config` write denylist bypassed two ways, reaching `alias.<x> = !cmd` | Medium | Fixed, `235f6d247` |
| 5 | `lib/shell-commands/rg.ts` | `-z` denial defeated by flag bundling | Medium | Fixed, `83877beaa` |
| 6 | `lib/shell-commands/agent-browser.ts` | Unsandboxed main-process fetch with no private-range check | Medium | Open, and a decision first |

---

## 1. The project mount's private dir is reachable, and writable, outside bash

Landed 2026-08-06 in `48240712c` ("workspace: cap project instructions and mount the project folder"). The project's own folder now mounts **read-write** at `/project` (`workspace-fs-layout.ts:229-240`), deliberately exempt from the `effectiveFolderAccess` rule that refuses write access to any attached folder overlapping the workspace root. The rationale, stated both in the commit message and in the code at `workspace-fs-layout.ts:222-228`, is:

> What that guard is actually protecting, the settings that name the project's folders and the access granted to each, stays unreachable, because `buildBashFs` masks the private dir inside this mount.

`buildBashFs` does mask it (`:165-172`). But that mask only exists inside the just-bash virtual filesystem, and the private-dir check in every other consumer is written as a **task-mount special case** rather than a property of the mount:

- `resolve-agent-path.ts:317` applies `isTaskPrivatePath` only when `mount === layout.task`; every other mount falls through to the symlink check alone.
- `workspace-fs-layout.ts:440-449` (`resolveReadOnlyHostPath`, what the `rg` shim uses) does the same.

Verified by calling the real resolvers against a layout carrying a project mount:

```
resolveAgentPath        /project/.instrument/settings.json -> /ws/projects/acme/.instrument/settings.json
resolveWritableToolPath /project/.instrument/settings.json -> /ws/projects/acme/.instrument/settings.json
resolveReadOnlyHostPath /project/.instrument/settings.json -> /ws/projects/acme/.instrument/settings.json
resolveAgentPath        /task/.instrument/state.json       -> refused   (control)
```

So `read_file`, `write_file`, `edit_file`, and `rg` all reach it, and the mount is `readOnly: false`, so the write path is not refused either.

**Why the write matters.** `projects/<Name>/.instrument/settings.json` holds `folders: [{ access, path }]` (`schemas/project.ts:6-31`). `detectProjectChanges` reads those on the next user message and writes them into task state as attachments carrying that `access` (`detect-project-changes.ts:88-113`), subject only to `effectiveFolderAccess`, which refuses read-write solely for folders overlapping the workspace root. An agent that appends `{"path": "/Users/<user>/Documents", "access": "read-write"}` to that file gets a read-write `/mnt` mount of it, in **every task in that project**, on the next turn. That is precisely the escalation the exemption's rationale says is out of reach.

**The asset origin was hardened for this and the file tools were not**, which is the tell that the mount was reviewed one consumer at a time. `routes/assets.ts:23` and `:99` replaced the old root-anchored `/.instrument` check with `PRIVATE_DIR_SEGMENT_REGEX`, matching the segment anywhere in the path, with a comment explaining that this route resolves host paths itself so `maskPrivateDirFs` does not cover it. The same sentence is true of the file tools and of `rg`.

**Fixed** in `5981801ec`, as suggested: `WorkspaceFsMount.masksPrivateDir`, set for the task and project mounts, read by `resolveVirtualAbsolutePath`, `resolveReadOnlyHostPath`, and `buildBashFs`, so the mask a mount declares and the mask it gets cannot diverge. The four resolver cases are tests, plus one that an attached folder's own `.instrument` stays reachable: a folder the user shared is theirs, and a directory of that name in it is an ordinary one.

---

## 2. The `rg` shim's task private-dir guard does not hold

`packages/workspace/src/lib/shell-commands/rg.ts:81-83` prepends `--glob '!/.instrument/**'` to every invocation, with the comment "ripgrep walks the real directory, so the virtual-filesystem mask over the private dir does not apply." `bridgePathArgs` (`:155`) additionally refuses a virtual path that resolves into the private dir. Both are correct in intent. Neither holds. Re-reproduced at `c2ee91221` against `@vscode/ripgrep` 1.18.0.

**Bypass A: a relative path operand.** `bridgePathArgs` only inspects arguments that start with a mount point (`/task`, `/mnt/...`, `/project`, `/skills`). A relative operand is passed through untouched, and ripgrep does not apply `--glob` filters to files named explicitly on the command line:

```
rg NEEDLE .instrument/state.json
```

returns the file's contents. No flags required.

**Bypass B: a later glob re-includes the directory.** ripgrep's glob precedence is last-wins and the deny glob is prepended, so any positive glob the agent passes overrides it:

```
rg --hidden --glob '.instrument/**' NEEDLE
rg --hidden --iglob '.INSTRUMENT/**' NEEDLE
rg --hidden -g '**' --files
```

All three list and search the private dir. The third is something an agent might type without meaning anything by it.

**Why it matters.** The private dir carries attached-folder **host** paths (in `state.json` at the time of this review, folded into `settings.json` since), which is the machine-layout leak `maskPrivateDirFs`, the `resolveNativeHostPath` quarantine, and `resolveAgentPath`'s private-dir error all exist to prevent. `docs/findings/private-dir-masking-is-not-a-boundary.md` already establishes the mask is friction rather than a boundary and that native interpreters go around it. That does not make this a non-issue: `loopback-block-is-curl-only.md` states the governing rule for exactly this case, that the gap between "one command" and "a script" is the entire value of the control, and that adding a command to the sandbox without the equivalent check quietly undoes it. `rg` is not an interpreter the model has to deliberately reach for; the bash description tells it "Use `rg` for all searching."

**Test coverage is false-passing.** `rg.test.ts:114` ("never walks the private dir, even when asked for hidden files") and `:120` ("refuses an explicit path into the private dir", which uses the *virtual* `/task/.instrument/state.json`) both still pass while both bypasses work. No tests were added here in the 08-05 to 08-10 window.

**Fixed** in `83877beaa`. The deny glob now goes after the agent's arguments (and ahead of a `--`, since everything past that is an operand). One thing the fix turned up that the finding did not: appending is not enough on its own, because ripgrep builds its matcher from every `--glob` and then adds every `--iglob`, so `--iglob '.INSTRUMENT/**'` outranks a trailing `--glob '!/.instrument/**'` whatever the order typed. The deny is spelled both ways for that. For the operands, every argument that is not a flag is resolved through the sandbox's own `resolvePath` and refused if it lands in the private dir -- asked of all of them rather than of the ones in path position, since which positional is the pattern takes parsing every flag the wrapper hands through. All three repros are tests.

---

## 3. A failed install latches the updater until the app restarts

`apps/studio/src/electron-main/lib/create-app-updater.ts` is untouched since the first review. `:517-537` holds `installRequest` for the lifetime of the process whenever `runInstall` returns `{type: "installing"}`, which is correct on the happy path because the app is quitting.

`runInstall` decides that at `:473` by reading `takeInstallFailure()` **synchronously** after `updater.install()`. The docblock at `:103` explains why: electron-updater catches a missing installer or a failed launch, emits `error`, and returns normally. But that emit is only synchronous for NSIS. `MacUpdater.quitAndInstall()` delegates to `autoUpdater.quitAndInstall()` and re-emits Squirrel.Mac's failure from the native updater's `error` event, which lands after `runInstall` has already returned.

When it does:

- the `failed` handler (`:245`, `:254`) sets `installFailure`, publishes `{type: "error"}`, and clears `phase.installing`;
- `installRequest` is never cleared;
- every later click resolves the stale `{type: "installing"}` and logs "Install already requested, joining the in-flight request";
- `updater.install()` is never called again.

The user sees an error, the update stays staged, and the install button is dead until they quit and reopen the app. macOS is both where the async path is and where the surrounding work concentrated (`334d91b5e`, `8e334629a`, `e69c58374` all deal with macOS staging teardown).

`create-app-updater.test.ts:355` and `:373` cover install failure, but both emit the error synchronously from inside the `installs` mock, so neither exercises this.

**Fixed** in `c42b8a274`, the first of the two: the `failed` handler clears `installRequest` where it already sets `installFailure` and clears `phase.installing`, so the three things one failed attempt owns are released together. The test fires `failed` a tick after `installs` returns and asserts the second click installs.

---

## 4. The `git config` write denylist has two one-token bypasses

`rejectUnsafeConfigWrite` (`packages/workspace/src/lib/shell-commands/git.ts:335`) is untouched since the first review. It exists, per its own docblock, because "FORCED_CONFIG outranks the file for the keys it names, but it cannot preempt an arbitrary `alias.<anything>`, so the write itself has to be refused." It picks the key with `rest.find((arg) => !arg.startsWith("-"))` (`:347`), the first non-flag token after `config`.

**Bypass A: the modern subcommand form.** Git 2.46 added `git config set <key> <value>`; dugite 3.0.0-rc11 still ships git 2.47.1 (re-checked). The first non-flag token is `set`, which is not a blocked key, so the write goes through:

```
git init -q .
git config set alias.pwn '!echo ESCAPED'
git pwn                                  # -> ESCAPED
```

**Bypass B: any preceding flag that takes a value.** `--file` is a `PATH_VALUE_FLAG`, so it is path-bridged and containment-checked, but its value is also the first non-flag token, so it becomes the "key":

```
git config --file .git/config alias.pwn2 '!echo ESCAPED_VIA_FILE'
git pwn2                                 # -> ESCAPED_VIA_FILE
```

Both land an alias in the repo config that git runs through `sh` on every later invocation. Both re-reproduced at `c2ee91221`.

**Severity.** Medium, not high: `docs/architecture/agent-sandbox.md` already says the argv layer is defense in depth against the easy path rather than a boundary, and notes that `.git/hooks` are writable through the file tools anyway. But the check is there to close the easy path, and both of these are the easy path. `git.test.ts` covers `config <key> <value>`, `config --add`, and `config --file` with a *traversal* path, so the gap is specifically the two spellings not tested.

**Fixed** in `235f6d247`, the inversion: any argument after `config` that parses as a blocked key is refused, rather than whichever token happens to sit in key position. The other option means tracking git's grammar for both spellings and every value-taking flag, which is the thing that was already one token away from wrong. What the inversion costs is a *read* of one of these keys refused along with the write, which is a listing nobody needs.

---

## 5. The `rg` `-z` denial is defeated by flag bundling

`rg.ts:183` refuses `--search-zip`/`-z` because, per the docblock, decompression "would turn a read-only binary into an execution vector, which is the assumption `resolveReadOnlyHostPath` is documented to rely on." The short-flag check is `/^-[a-z]+$/i.test(arg) && arg.includes("z")`, which only matches an all-letter cluster. A cluster ending in a value-taking flag with an attached number does not match:

```
rg -zC3 needle file.gz     # decompresses and matches; wrapper does not deny
```

Re-reproduced at `c2ee91221`. Whether it reaches a real subprocess depends on whether `gzip`/`xz`/`zstd` are on the sandbox `PATH`, which is worth checking either way. The parsing bug is real regardless.

**Fixed** in `83877beaa`, with one correction to the suggested fix. Stopping at the first non-letter refuses `rg -ez file`, which is `-e z`, a search for the pattern `z`: a short flag that takes a value swallows the rest of its cluster. The scan walks the cluster and stops at the first flag that takes one, from `rg --help` for the build we bundle. A value-taking flag missing from that set costs a refusal that should have been allowed; only a letter wrongly in it would let `-z` through, which is why it grows by reading the help rather than by guessing.

---

## 6. `agent-browser read <url>` is an unsandboxed fetch with no private-range check

`isBrowserFreeRead` (`lib/shell-commands/agent-browser.ts:316`) routes a bare `read <url>` to a daemon session that answers it with a plain HTTP fetch, no page and no CDP. That is a good optimization and the detection is carefully exact. It is also an HTTP path running outside the just-bash network policy, and `loopback-block-is-curl-only.md` states the rule it misses: "Any new HTTP path that runs outside the sandbox (main-process tools, for instance) does not inherit this at all and needs its own guard to stay consistent with `curl`."

Verified against the bundled `agent-browser` 0.33.1 binary with a local server on `127.0.0.1`: `agent-browser read http://127.0.0.1:<port>/` returns the page. `curl` refuses the same URL (`denyPrivateRanges: true` in `create-bash-env.ts`), and the `web_fetch` tool refuses it too (`lib/private-address.ts`, whose docblock says it exists to "mirror the just-bash sandbox's `denyPrivateRanges` posture").

The capability is not new (`agent-browser open http://127.0.0.1:...` reached the same thing before), so this is a consistency gap rather than a hole. It is worth closing because there are now four independent implementations of "do not reach private addresses" with three different answers: `curl` (blocked), `web_fetch` (blocked, with a documented DNS-rebinding TOCTOU), `agent-browser read` (open), and the managed browser (open by design). One owner and one predicate would be better than four.

**Fix.** Run `isPrivateHostname` over the `read` URL in the wrapper before spawning, matching `web_fetch`. Or decide deliberately that the browser paths are exempt and say so in `loopback-block-is-curl-only.md`, so the next fetch path added does not have to re-derive the answer.

**Left open deliberately, 2026-08-12, because the first of those is not a fix on its own.** The task's app is served on localhost, so a private-range block over `read` refuses the agent its own preview along with the user's router: `read http://<taskId>.localhost:<port>/` is a reasonable way to check the page it just built. The capability survives either way (`open` then `text` reaches the same page, by design), so blocking `read` alone moves the cheapest spelling out of reach and leaves the expensive one, which is friction rather than a boundary -- the shape `private-dir-masking-is-not-a-boundary.md` is about.

What is worth doing instead is the question the finding ends on: one owner and one predicate for "do not reach private addresses", which has to answer whether the task's own origin is an exception and how it is recognized. That is a decision, not a patch, and it is the same decision for `curl` (which refuses the app preview today) as for `read`. Until it is made, `read` reaching localhost is a gap that is recorded rather than closed.

---

## Nits

- `rg.ts:212` bridges any argument starting with a mount point, so a search *pattern* that happens to start with one (`rg '/task/output'`) is silently turned into a host path and searched for as text. The docblock reasons about the opposite case (a bare `/` prefix being more likely a regex than a path) but the mount-prefixed case has the same problem. Still present, and untouched by the fix for finding 2, which deliberately did not start parsing which positional is the pattern.
- `agent-browser.ts:1033-1034` writes `command-output-<runId>.{stdout,stderr}.log` into `work/screenshots/` on Windows and removes them in a `finally`. A hard kill leaves them behind in a directory the agent sees and that is reported as its own file changes. Still present.
- `assign-mount-names.ts:69` compares an ancestor segment against `path.basename(os.homedir())` and relabels it `Home`, so an unrelated directory sharing that basename gets relabeled. Narrowed but not gone: `bcfceb033` made qualification happen only on a namesake collision, so the false positive now needs two attached folders with the same basename.

### Resolved or superseded since the first review

- `assign-folder-names.ts` was reworked and renamed to `assign-mount-names.ts` (`bcfceb033`, `7b948f94f`). The over-qualification it caused (`~/Documents/test` mounting at `/mnt/Documents-test`) is fixed; only the `Home` relabel nit above survives.
- The `serve-static.ts` suffix-range nit is dropped. It is pre-existing (January) and unchanged, so it is out of scope for this review.

## Not findings, checked and clean

Recorded so the next review does not re-derive them. Re-checked at `c2ee91221` where the code moved.

The renderer imports no Electron or Node built-ins (re-verified). `rehype-raw` is enabled only on the release-notes route, not on model output. Mermaid runs at `securityLevel: "strict"` (DOMPurify). The `webview` attach hook pins `contextIsolation`/`sandbox`/`webSecurity` explicitly. `guardNavigation` plus `openExternal`'s protocol allowlist cover both navigation shapes. The `app://` protocol handler's vendor path pattern makes `..` unspellable. `openTaskFile`/`openTaskFileWith` validate through `RelativeTaskPathSchema` and check the chosen app against the enumerated candidates. `effectiveFolderAccess` canonicalizes both paths before the workspace-overlap check, and the `/project` exemption to it is deliberate and documented (finding 1 is about the mask it leans on, not about the exemption itself). The writable-mount path resolver re-checks symlink containment that the bash sandbox would otherwise have provided. The `attachedFolderChanges` per-turn part correctly covers the 60-minute session-context staleness rule for folder-access grants. The asset origin's private-dir check was correctly generalized to a path segment when `/project` landed.

## Related

- `docs/findings/private-dir-masking-is-not-a-boundary.md` — why findings 1 and 2 are regressions against stated intent rather than new architectural gaps.
- `docs/findings/loopback-block-is-curl-only.md` — the rule findings 2 and 6 are measured against.
- `docs/architecture/agent-sandbox.md` — the containment layering all of these sit in. Its inventory covers `/project` (added by the same commit as finding 1), and `:15` states the guarantee finding 1 was about: the project's `.instrument` is "masked inside this mount so the agent cannot rewrite the folders the project contributes or the access granted to each". That sentence was true of bash and of nothing else; the fix for finding 1 is what makes it true as written.
