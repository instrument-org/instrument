# Dependency sweep: what upstream has fixed for us

Status: first pass landed. hono, @hono/node-server, better-auth, vite, @parcel/watcher, xstate, use-stick-to-bottom, agent-browser, and electron-builder are upgraded and committed; electron and the AI SDK are blocked for the reasons recorded below; just-bash, execa, and dugite are untouched API migrations. Snapshot verified 2026-07-31 against the npm registry and upstream sources. Version claims go stale fast, so re-check anything here before acting on it.

This is a read of the dependency tree against what we have actually been churning on: the auto-updater, the Windows launch path, the file watcher, the agent browser, the bash sandbox, and the chat transcript. It ranks by "does upstream already fix a bug we paid for", not by how far behind a version number is.

## How to read the version numbers

`pnpm outdated -r` is the source for "what would we get", and it already applies our `minimumReleaseAge` of 10080 minutes (7 days), so its "latest" trails npm's by a release or two. `@hono/node-server` reports 2.0.11 while npm says 2.0.12; `@radix-ui/react-tooltip` reports 1.2.14 while the registry has 1.2.16. Anything published inside the last week is not installable without an exclusion, which is why `agent-browser` is listed in `minimumReleaseAgeExclude`.

Four mechanical constraints apply to every bump below:

- `pnpm update` rewrites the manifest range, and a caret range never downgrades on reinstall, so backing a bump out means pinning the old version exactly, installing, then restoring the caret. Worth knowing before starting, because it is the difference between a two-minute revert and an hour.

- Shared versions live in the `catalog:` block of [pnpm-workspace.yaml](../../../pnpm-workspace.yaml), not in the package manifests.
- Both entries in `patchedDependencies` are keyed by exact version, so bumping `@parcel/watcher` or `conf` means re-creating the patch. The `conf@14.0.0` patch reads as a reformat but its one substantive change is dropping the `set(key: string, value: unknown)` overload, so the type narrowing has to be carried forward deliberately.
- Native packages need their `allowBuilds` entry to stay accurate.

## Tier 1: upstream fixes for bugs we have been paying for

### electron 42.3.3 to 42.8.0: blocked

**Blocked, and not by the seven-day rule.** `check:electron-node-version` requires `.node-version`, `.tool-versions`, and `engines.node` in the repo root, in Studio, and in `registry/` to equal Electron's bundled Node exactly. We are pinned to 24.15.0; Electron 42.4.x bundles 24.16.0, 42.5.x bundles 24.17.0, and 42.6.0 and later bundle 24.18.0, so there is no 42.x bump available that leaves the pin alone. Three of the files that would have to move live in `registry/`, which is the read-only skills submodule, so this is a coordinated change across two repos and a submodule pointer update, not a version bump. Worth scheduling, because the payoff below is real.

Same major, patch line, and it contains the fix for a crash class we have hit from two directions.

42.6.2 fixes "a browser-process crash (`ValidateIntegrityOrDie`) and spurious preload `ENOENT` errors when an app's `app.asar` is replaced on disk (e.g. by an updater or MDM software) while the app is running". That is the shape of both the updater work in [auto-updater.md](../../architecture/auto-updater.md) and [dev-rebuild-wipes-live-main-bundle.md](../../findings/dev-rebuild-wipes-live-main-bundle.md).

Also in the range, all relevant to surfaces we own:

- 42.5.1: `ProtocolResponse.url` requests went through the default session instead of the session the handler was registered on. We register per-task protocol handlers for the asset origin.
- 42.4.1: DevTools Network panel dropped most requests after navigation while `webContents.debugger` was attached, which is exactly how the in-app browser drives CDP. Same release fixes a `safeStorage.isAsyncEncryptionAvailable()` crash before async encryption finished initializing.
- 42.5.2: windows opened from links inside a sandboxed iframe now inherit the iframe's sandbox restrictions. Feeds directly into [browser-popups-as-agent-drivable-tabs.md](browser-popups-as-agent-drivable-tabs.md).
- 42.6.0: fixes running under tsx import transpilation, which is how most of our scripts run.
- 42.6.1: crash when replacing an open application menu.

Risk: low. Validation: boot Studio, run the smoke test, exercise an update install, open a task browser with the debugger attached.

### electron-builder 26.8.2 to 26.15.7

Take 26.15.7, not the `latest` dist-tag. `latest` points at 26.15.3, but the 26.15.0 7-Zip upgrade started dereferencing symlinks, which corrupts macOS `.framework` bundles, makes codesign report an ambiguous bundle format, and breaks Squirrel.Mac update validation. 26.15.2 moved the zip target to native `zip` and 26.15.4 restored `7za -snl` for the zip and 7z targets; 26.15.3 sits between the regression and the fix. The `v26` dist-tag is the one that tracks the maintenance line.

We ship `dmg` and `zip` on macOS ([electron-builder.ts](../../../apps/studio/electron-builder.ts)), and macOS auto-update consumes the zip. A zip that fails Squirrel validation produces exactly the "staged but never installed" symptom the last several updater commits were chasing.

26.15.6 adds two more that land on us: NSIS now packs the app archive with a filter the install-time extractor can decode, so the main executable and native binaries install reliably on x64 and arm64, and a workspace sub-package's production dependencies are bundled into app.asar when the package manager resolves to the workspace root, which is the shape of this repo.

The package.json read errors that originally pinned us to 26.3.4 ([#9451](https://github.com/electron-userland/electron-builder/issues/9451), closed December 2025) do not reappear: an unsigned `--dir` build and a zip build both complete clean with no `Failed to read package.json` or ENOENT lines, the ripgrep, uv, and pnpm afterPack verifications pass, and the zip carries 155 symlinks including `Electron Framework.framework/Versions/Current`. The build does log "platform-specific optional dependencies not bundled" for the other platforms' `@parcel/watcher-*` and `@vscode/ripgrep-*` packages, which is expected for a single-arch build of a repo that declares them in `optionalDependencies`.

26.15.0 also closes GHSA-7g7r-gx96-252g (uncontrolled search path elements in AppImage builds, fixed in app-builder-lib 26.15.0). We build AppImage, deb, rpm, and tar.gz for Linux, so that one is real for us rather than theoretical. Note that `builder-util-runtime` is already at 9.7.0 through electron-updater 6.8.9, so the credential-leak advisory against `<9.7.0` is already covered.

Other things in the range that touch our build: pnpm nested dependency resolution under `nodeLinker: hoisted` (26.14.0), a CJS resolver for package subpaths in pnpm projects (26.14.0), `disableAsarIntegrity` (26.13.0), APFS DMG support (26.13.0), and NSIS process detection that no longer false-positives "app cannot be closed" on a sibling process whose name contains ours (26.13.0).

Risk: medium, because it is the build. Validation: unsigned mac and Windows builds, then a real signed mac build and an update install from a staged release.

### @parcel/watcher 2.5.1 to 2.6.0

2.6.0 landed 2026-07-20 and carries the fix for the crash we worked around: "fix SEGV due to improper ordering of static destructors" (#208) rewrites the `DirTree` cache as a function-local static, which is the standard fix for a destructor-order crash at process exit. Our workaround is [63f33c3af](https://github.com/instrument-org/instrument/commit/63f33c3af) "stop task file watchers before quit to fix parcel-watcher abort". The workaround is still worth keeping, but the underlying abort should stop happening.

It also switches glob matching from micromatch to picomatch `^4.0.4`, which drops the vulnerable `picomatch@2.3.1` out of our tree (see Tier 2), and adds `RegExp` support in `ignore`, which is a better fit for the two ignore dialects in `workspace-skill-watcher` than glob strings.

What does not change: backend auto-detection still prefers Watchman, and `checkAvailable()` still shells out. The `2>/dev/null` in #198 only silences stderr; it does not stop the process spawn or the console window on Windows. Our `NATIVE_WATCHER_BACKEND` pin stays load-bearing, exactly as [windows-watchman-probe-freezes-boot.md](../../findings/windows-watchman-probe-freezes-boot.md) concluded.

2.6.0 still ships `binding.gyp`, so the patch that deletes it (to skip the electron rebuild) has to be re-created against the new version.

Risk: low to medium (native module, two packages depend on it, patch rebase). Validation: watch a task folder on each platform, quit with watchers live, confirm no abort.

### just-bash 3.1.0 to 3.2.0

The headline is #307, "harden untrusted execution with shared aggregate budgets, liberal normal and opt-in hardened limit profiles, request-bound network validation, bounded archive and worker processing, transactional filesystem and shell state". We run model-authored shell in-process, so aggregate resource budgets and a `hardened` profile are directly in the path of [agent-sandbox.md](../../architecture/agent-sandbox.md).

It is not a free bump. Dispatched callbacks now receive a `ResolvedCommandContext` carrying required limits, custom-command execution can opt into `trusted: false`, and `createCommandContext({ fs })` is the new direct-invocation entry point. We register a lot of custom commands (`agent-browser`, `pnpm`, `node`, `python`, `ts`, `exec-shim`), so this is a real code change, not a version bump. Host-registration paths keep their trusted default, so nothing breaks silently.

Also in the range: `grep` now treats `--` as end of options (#315), executable scripts preserve their exit status (#298), `cd -` seeds from the `OLDPWD` exec option (#292), and curl gained `-G`/`--get` plus order-preserving repeated data flags (#304). Those are all agent-visible reliability wins in the sandbox.

Risk: medium. Validation: the `run-bash` skill for command-level behavior, then a real agent run per [validate-changes](../../../.agents/skills/validate-changes/SKILL.md), because limit profiles only show up under load.

### agent-browser 0.31.1 to 0.33.1

Four releases, and the two that matter map onto open work:

- Tab recovery and selection (#1543, #1532): selects a live renderer at CDP connect instead of hanging on a Memory Saver discarded tab, revives tabs on switch or after close, treats dialog-blocked tabs as live, and preserves refs on rejected operations. This is the daemon-hang class behind [lazy-browser-targets-and-multiple-tabs.md](lazy-browser-targets-and-multiple-tabs.md) and the "surface a browser only once a page loads in it" work.
- Domain allowlist hardening (#1546, 0.32.0): blocks WebRTC bypasses and applies network containment across launch modes, workers, popups, restored state, and reused daemon sessions, and rejects unsafe startup arguments. We just shipped external browsers behind a flag and separately refused `--executable-path`, so the same threat model is live for us.

Smaller: `a11y` command with axe-core audits and a matching MCP tool (0.33.0), HAR captures with response bodies (0.32.3), `find role` matching implicit ARIA roles and computed accessible names (0.32.4), element-not-found errors that keep the locator detail (0.32.4), and periodic restore-state autosaves (0.31.2).

Two things not to oversell. The 0.33.1 default 1 hour daemon idle timeout changes nothing for us because we already pass an explicit `AGENT_BROWSER_IDLE_TIMEOUT_MS` of 5 minutes; what is worth a second look is that an explicitly configured timeout applies to user-attached browsers too, which now matters more than it did before the external-browser flag. And the 0.33.2 stream work (per-client `maxFps`, latest-frame-wins, quality and size env vars) is moot while `stream` stays in our blocked-command list.

Risk: low, and we already exclude this package from `minimumReleaseAge`. Validation: agent-browser tool runs across models, plus the CDP fixture against real Chrome.

### execa 9.6.0 to 10.0.1

`killDescendants` (#1256) terminates the whole process tree on every path execa already uses to terminate: `kill()`, `cancelSignal`, `timeout`, `maxBuffer`, `cleanup`, and the `forceKillAfterDelay` escalation. Twenty files use execa, and [agent-browser-orphaned-daemons.md](../../findings/agent-browser-orphaned-daemons.md) is a finding about descendants outliving the process we killed.

Breaking changes to check: `execaCommand()` and `execaCommandSync()` are gone (#1244), the old `stdio: [..., 'ipc']` syntax is gone (#1245), cross-spawn was replaced with an internal implementation (#1251) with Windows `PATHEXT` and `.cmd` handling documented and tested (#1248), and the Node floor is 22 (we are on 24). Prototype pollution hardening (#1223) also lands in this major.

Risk: medium, mostly from the cross-spawn replacement on Windows. Validation: the Windows shell command paths, git through dugite, uv, and the agent-browser launcher.

### xstate 5.20.1 to 5.32.5

Twelve minors of fixes under our session, agent, and workspace machines. The ones with teeth:

- 5.32.5: sending an event to a stopped actor no longer throws when the event holds unserializable data. The dev-only warning used `JSON.stringify` and could throw, masking the real problem. Our events carry rich payloads.
- 5.32.3: `initialTransition`/`transition` no longer throw "Actor with system ID already exists" when the machine has an `invoke` with a `systemId`.
- 5.32.2: a state with both an exact descriptor (`foo.bar`) and a wildcard (`foo.*`) now falls back to the wildcard when the exact descriptor's guards all fail.
- 5.32.4: history state that is a direct child of an unvisited `parallel` state now enters the initial configuration instead of doing nothing.

Risk: low. Validation: the machine test suites, which are already thorough.

### ai 6.0.168 to 6.0.235: attempted and backed out

The v6 line is still maintained (`ai-v6` dist-tag at 6.0.238), so this looked like a patch-only bump that does not drag in the v7 migration. It is not, for two reasons found by doing it.

**The provider set moves as a unit.** Bumping `ai` alone fails typechecking in [get-ai-sdk-web-search-model.ts](../../../packages/ai-gateway/src/lib/get-ai-sdk-web-search-model.ts): the provider-defined web search tools resolve to `Tool<never, never>` against the newer core `ToolSet`. Moving all 14 `@ai-sdk/*` packages plus `@ai-sdk/provider` up within their existing caret ranges fixes it, so any `ai` bump is really a seventeen-package bump.

**`convertToModelMessages` no longer emits an empty assistant message**, per 6.0.199's "no longer emits an empty assistant message when a block contains only unknown data parts". Correct for model messages, but [session-to-markdown.ts](../../../packages/workspace/src/lib/session-to-markdown.ts) enumerates assistant blocks by converting through it, and a block whose parts are `step-start`, `source-url`, `data-fileChanges`, and a tool call still in `input-streaming` has nothing model-visible in it. That block now disappears from the transcript, taking the sources, the file-changes list, and the interrupted tool call with it. Two tests in `session-to-markdown.test.ts` catch this, which is the system working.

So this bump is gated on making the transcript renderer enumerate from persisted session messages rather than from model messages. That is a product change, not a dependency change, and it is worth doing on its own terms: the diagnostics surface should not lose an interrupted tool call just because the model would not have been sent one.

What we give up until then: DNS-rebinding and private-address pinning for validated downloads (6.0.238), which is the same concern as [2026-07-24-web-fetch-private-address-guard.md](../../decisions/2026-07-24-web-fetch-private-address-guard.md), a `timeout.stepMs` that actually aborts a step stalled before first output, and the `validateUIMessages` fix for persisted `output-error` tool parts with no `input` under Zod 4.4.

### use-stick-to-bottom 1.1.1 to 1.1.6

Four fixes, two of which are in the transcript's problem area: overriding CSS `scroll-behavior` in the programmatic `scrollTop` setter (#36) and clearing the resize observer on unmount (#38). We have been fixing transcript scroll behavior by hand ("jump the transcript to the live edge on prompt submit"). Upstream still has no `releaseAutoScroll`, so the fork work for the file-grid expand jump is unaffected.

Risk: very low.

### dugite 3.0.0-rc11 to 3.2.2

We ship a release candidate in production. 3.2.2 is stable and the delta is almost entirely the embedded git version, 2.47.3 to 2.53.0, which is six upstream git releases of fixes. No API change in `lib/` across the range.

Risk: low, but it is the binary behind every git operation, so it wants a real test pass on Windows in particular (long paths, `core.longpaths`, the `gitCommit` migration).

## Tier 2: security posture

`pnpm audit --prod` reports 89 advisories, and most of them are not exposure. The ones that are:

### hono 4.8.5 to 4.12.33, @hono/node-server 2.0.4 to 2.0.12

This is the single highest-value bump in the tree, and it is a same-major patch.

We are inside the affected range of GHSA-9hp6-4448-45g2 (URL path parsing path confusion, 4.8.0 to 4.9.6) and below the fix for GHSA-m732-5p4w-x69g (improper authorization, `<4.10.2`) and GHSA-2gcr-mfcq-wcc3 (`app.mount()` strips the mount prefix using the undecoded path). Our workspace server routes on the `Host` header to decide whether a request is the app origin or the `assets.<task-id>` origin ([uri-details-for-host.ts](../../../packages/workspace/src/logic/server/uri-details-for-host.ts)), so routing correctness is a security boundary here, not a nicety.

One concrete hit rather than a theoretical one: [assets.ts](../../../packages/workspace/src/logic/server/routes/assets.ts) applies bare `cors()` to the asset origin, and GHSA-88fw-hqm2-52qc (`<4.12.25`) is "CORS middleware reflects any Origin with credentials when `origin` defaults to the wildcard". Worth pairing the bump with an explicit origin allowlist.

`@hono/node-server` is worse in one specific way: GHSA-9mqv-5hh9-4cgg, unauthenticated memory-leak DoS via aborted WebSocket handshake, covers `<=2.0.9`, and we proxy websockets ([websocket-proxy.ts](../../../packages/workspace/src/logic/server/websocket-proxy.ts)).

The serve-static advisories mostly do not apply to us, because [serve-static.ts](../../../packages/workspace/src/logic/server/serve-static.ts) is our own fork of node-server's implementation pinned at commit `26f5e89`, and the assets route does its own traversal check. That cuts both ways: upstream has since fixed a Windows `%5C` traversal (GHSA-frvp-7c67-39w9) that our fork will never receive from a version bump. Worth a deliberate diff of the fork against current upstream while the file is open.

Reachability caveat, stated honestly: the server binds `127.0.0.1`. The attacker is local, which in this product means agent-driven page content, the in-app browser, and user apps, not the open internet. That is a lower bar than a public service and a higher one than "not exposed".

### Sandbox-reachable denial of service in transitive glob matching

`brace-expansion` has four DoS advisories (exponential expansion of consecutive `{}` groups, unbounded expansion length causing OOM), and we resolve `2.0.2` under `@netlify/build-info` and `5.0.3` under both `glob@13` and `just-bash@3.1.0`. just-bash runs model-authored shell in the main process, so an agent-authored glob is an unprivileged path to a hang or an OOM. `picomatch@2.3.1` (ReDoS via extglob quantifiers) arrives through `@parcel/watcher`'s micromatch and disappears with the 2.6.0 bump above.

Neither is fixed by a direct-dependency bump alone. This wants a `pnpm dedupe` pass plus an `overrides` entry for `brace-expansion`, then a check that minimatch still resolves.

### arctic is deprecated at every published version

`arctic` is marked "Package no longer supported" on npm for 3.5.0, 3.6.0, and 3.7.0 alike, so 3.7.0 is not an upgrade path, it is the same dead end one version later. We use it for the Google OAuth flow in [auth/client.ts](../../../apps/studio/src/electron-main/auth/client.ts). No action is urgent (nothing is known-vulnerable), but an unmaintained OAuth library on the sign-in path is a standing risk and should get a replacement decision rather than a version bump. Relevant to [connector-authentication-technical-notes.md](../../findings/connector-authentication-technical-notes.md).

### better-auth: real advisories, but not ours

`better-auth@1.3.7` accounts for 11 of the 89 production advisories, including two criticals. Every one of them is a server-side plugin issue (2FA session cookie cache, oidc-provider, mcp, organization invitations, api-key, magic-link and email-OTP account hijacking). This repo imports only `better-auth/client` and calls `createAuthClient`, so the exposure lives in whatever service backs `MAIN_VITE_APP_API_BASE_URL/auth`, which is not in this tree. Bumping here is audit hygiene and worth doing to keep the report readable; the actual remediation belongs to the auth service.

### vite 7.2.7 to 7.3.6

Four advisories cover `<=7.3.4`: `server.fs.deny` bypass with queries and on Windows alternate paths, arbitrary file read via the dev-server websocket, and path traversal in optimized-deps `.map` handling. Dev-server only, but we run two of them, including the shim client on a fixed port that user apps reach. Staying inside 7.x makes this a patch bump; vite 8 is a separate decision below.

### Audit entries that are not exposure

Worth recording so the next reader does not re-derive it: `undici@7.27.2` comes from `@electron/get` and only runs at install time; `postcss` is build-time under `@tailwindcss/postcss`; `kysely` and `drizzle-orm` arrive under `db0`/`unstorage` and `better-auth`, not through query paths we write; `js-yaml@4.1.1` is inside electron-updater parsing our own release feed; `fast-uri` is under `ajv` under `conf` under `electron-store`; `mdast-util-to-hast` comes from shiki 3's HTML renderer and goes away with shiki 4.

## Tier 3: capability we would get nearly free

- `@shikijs/stream` (shiki 4.2.0) renders highlighted code incrementally from a stream. We stream model output containing code blocks and currently highlight after the fact.
- `@parcel/watcher` 2.6.0 accepts `RegExp` in `ignore`, which fits our two ignore dialects better than glob strings. Ergonomics only: measured against 2.5.1 and 2.6.0 on the fs-events backend, neither globs, paths, nor regexes suppressed events for files created directly in the watched root, so this changes how patterns are written, not what gets filtered.
- agent-browser `a11y` (axe-core) is a ready-made audit surface for a product whose users build UIs, and HAR response bodies make network capture actually useful for the derive-client pattern.
- execa `killDescendants` replaces hand-rolled process-tree cleanup.
- electron 43 boots the main process from an embedded Node startup snapshot and caches framework bundles and preload scripts as V8 bytecode. We just added boot-step timing, so we would be able to measure it.
- electron-updater 7.0.0-alpha.5 adds `autoInstallEvent: "onNextLaunch"`, a session-end guard for OS shutdown killing the installer mid-install, and `installPendingUpdateIfAvailable()`. That is aimed squarely at the Linux path where we skip `quitAndInstall()` because it hangs. It is an alpha on the v27 line and the GitHub-provider fixes in the same release do not apply to us (we publish to S3), so this is a watch item, not a bump.

## Decide rather than drift

These are not "upgrade when convenient", they are projects. Listing them so they are chosen, not stumbled into.

**AI SDK v7.** `ai` 6.0.168 to 7.0.44 is one atomic bundle: 14 `@ai-sdk/*` providers all go 2.x/3.x to 3.x/4.x, `@openrouter/ai-sdk-provider` 3.0.0 is v7-only by design, and `ai-sdk-ollama` goes to 4.0. Everything becomes ESM-only, `system` is deprecated in favor of `instructions`, `onFinish`/`onStepFinish` become `onEnd`/`onStepEnd`, `experimental_context` becomes `runtimeContext`, and `stepCountIs` becomes `isStepCount`. What we would get for the work: `ToolLoopAgent` with runtime-validated `callOptionsSchema`, `allowSystemInMessages` defaulting to rejecting system messages in `messages` (a prompt-injection guard that matches [2026-07-27-nonce-bounded-untrusted-content.md](../../decisions/2026-07-27-nonce-bounded-untrusted-content.md)), a first-class tool approval flow, `timeout.stepMs` that actually aborts a step that stalls before emitting anything, and a `validateUIMessages` fix for persisted `output-error` tool parts with no `input` under Zod 4.4 (worth checking against [session-recovery-from-unsendable-content.md](session-recovery-from-unsendable-content.md), since that is a stored-message failure mode). Take 6.0.238 now, plan v7 separately.

**Electron 43.** Startup performance, `net.WebSocket` in the main process, notification APIs, `webContents.copyVideoFrameAt`. Note the deadline attached to it: electron-builder v27 fails fast on Windows ia32 and Linux armv7l against Electron 44+, which removed those builds, and 43.x is the last line that supports them until it reaches end of life in January 2027.

**Base UI.** Already scoped in [radix-upgrade-and-base-ui-migration.md](radix-upgrade-and-base-ui-migration.md), and nothing found here changes that plan's conclusion. Its Phase 0 (take the year of Radix fixes) is a Tier 1 item in everything but name.

**The dev-tooling wave.** eslint 10, typescript-eslint 8.65, eslint-plugin-unicorn 56 to 72, perfectionist 5, cspell 10, knip 6.29, oxlint 1.75 and oxfmt 0.60, and `oxlint-tsgolint` 0.24 to 7.0.2001. Individually cheap, collectively a day of churn in lint output, and best done as one batch so the diff is attributable.

**tokenx 1.3.0 to 2.0.0.** The estimator was recalibrated against `o200k_base` and the heuristics changed (short lowercase words priced as one token, line breaks after words priced separately). Every threshold tuned against the old estimator shifts, which matters for [context-compaction.md](context-compaction.md).

**electron-store 10 to 11.** Drags `conf` to a new major and invalidates our patch. Worth pairing with a decision about whether the patch is still earning its keep.

**vite 8, @vitejs/plugin-react 6, TypeScript 7.** Separate majors, each with their own blast radius. `@types/node` 24 to 26 belongs with the Node floor decision, not on its own.

## Already current, leave alone

zod 4.4.3, react 19.2.1, neverthrow 8.2.0, glob 13.0.6, sonner 2.0.7, cmdk 1.1.1, react-markdown 10.1.0, `@vscode/ripgrep` 1.18.0, typescript-result 3.5.2. TanStack Router is one patch behind (1.170.16 to 1.170.18) and oRPC five (1.14.3 to 1.14.8); both are noise-level.

## What landed

Five commits, each checked with `turbo run check:types check:lint test:ci` before committing.

1. hono 4.12.32, `@hono/node-server` 2.0.11, better-auth 1.6.25, vite 7.3.6. Production advisories went from 89 to 34 and criticals from 2 to 0. hono 4.12 types `cors()` against an unparameterized env, so the assets middleware names its env explicitly; that is the only source change in the batch.
2. `@parcel/watcher` 2.6.0, with the `binding.gyp` patch re-created against the new version. Smoke-tested that the native binding still loads under the pinned backend and still emits events.
3. xstate 5.32.5 and use-stick-to-bottom 1.1.6.
4. agent-browser 0.33.1. `a11y` is a new top-level command and, like anything absent from `BLOCKED_SUBCOMMANDS`, is now reachable from the sandbox without the skill documenting it. Worth a look when the skill is next touched.
5. electron-builder 26.15.7, validated with a real unsigned mac build plus a zip build.

Two things to know about the test run: the workspace suite failed twice under `turbo` and passed standalone both times, on tests unrelated to what was being bumped, so it is load-flaky under full parallelism. And the `pnpm outdated` numbers are the seven-day-aged ones, which is why several bumps here stop one release short of npm's `latest`.

## What is left

1. **electron**, once the Node pin moves in this repo and the skills repo together.
2. **The AI SDK**, once the transcript renderer stops enumerating assistant blocks through `convertToModelMessages`.
3. **The sandbox-reachable `brace-expansion` DoS**, which needs an `overrides` entry plus a `pnpm dedupe` rather than a direct bump, and was left out of the security batch to keep that lockfile diff attributable.
4. **just-bash 3.2.0, execa 10, dugite 3.2.2**: API migrations wearing version bumps, each worth its own review.
5. Everything in "decide rather than drift" gets a plan doc, not a commit.

Validation for anything that touches the agent loop, the sandbox, or a tool surface follows [validate-changes](../../../.agents/skills/validate-changes/SKILL.md): unit tests do not show whether a model still finds the affordance. Nothing landed here has been through an eval run or a launched app.

## Reference checkouts used

All under the local reference collection, fetched and fast-forwarded 2026-07-31 unless noted. Four were added for this sweep: `parcel-watcher`, `better-auth`, `dugite`, `use-stick-to-bottom`.

| Checkout | What to read |
| --- | --- |
| `parcel-watcher` | `src/Backend.cc` for backend selection, `src/DirTree.cc` for the destructor fix, tags `v2.5.1..v2.6.0` |
| `electron-builder` | `packages/app-builder-lib/CHANGELOG.md` and `packages/electron-updater/CHANGELOG.md` on `origin/master` (local branch does not track it) |
| `agent-browser` | `CHANGELOG.md` on `origin/HEAD`, already at 0.33.2 |
| `just-bash` | `packages/just-bash/CHANGELOG.md` on `origin/HEAD` (local branch does not track it) |
| `execa` | `docs/termination.md`, `docs/windows.md`, tags `v9.6.0..v10.0.1` |
| `ai` | `packages/ai/CHANGELOG.md`, v7 major entry |
| `dugite` | tags `v3.0.0-rc11..v3.2.2`, `script/embedded-git.json` |
| `better-auth`, `use-stick-to-bottom`, `base-ui`, `radix-primitives`, `hono`, `xstate`, `unstorage`, `knip`, `react-resizable-panels` | current as of this sweep |
| `tanstack-router` (Nov 2025), `posthog-js` (Nov 2025), `electron-log` (May 2026) | stale, checked-out branch did not fast-forward |

Electron and Chromium release notes came from the GitHub releases API rather than the local `electron` checkout, which is large and stale; that is the faster path for release notes specifically.
