# Dependency work behind the PR queue

Status: proposed, nothing started. Every item here was deliberately held back from the 2026-08-29 sweep because it rewrites files that open pull requests are also touching, or because it is a decision rather than a bump. Most are gated on the open PR queue draining; Electron has a specific gate, [#102](https://github.com/instrument-org/instrument/pull/102), recorded below. Verified against the npm registry and upstream sources on 2026-08-29; re-check version claims before acting, because they go stale in days.

This is the companion to [dependency-upgrade-sweep.md](dependency-upgrade-sweep.md), which ranks the whole tree. That plan answers "what does upstream already fix for us". This one answers "what did we choose not to do while the branch was busy, and what has to be true before we do".

## Why the queue is the gate

Three of the items below rewrite shared UI wrappers, the Node pin, or the lockfile. Each is individually cheap and collectively unmergeable alongside in-flight work:

- Radix touches 45 wrappers under `components/ui/`, which large UI branches touch by definition.
- The Electron pin moves files in this repo and in the `registry` submodule together, and the pointer it needs is itself gated on #102.
- The `overrides` work rewrites lockfile regions that every dependency-touching branch also rewrites.

Doing them on a quiet branch is the difference between a mechanical diff and a week of conflict resolution.

## Ordered by value once the queue is clear

### 1. Radix, Phase 0 only: take the year of fixes

Already scoped as Phase 0 of [radix-upgrade-and-base-ui-migration.md](radix-upgrade-and-base-ui-migration.md), which stands unchanged. It is listed here because it is the single largest user-visible win in the tree and its only real cost is conflict surface.

22 `@radix-ui/react-*` packages, roughly a year behind. No API change, no migration. What it fixes, all of it live in the shipped app today:

- Menus not closing when the window loses focus, which is an Electron-shaped bug.
- React 19 infinite re-render from unstable composed ref identities.
- Nested modal and non-modal layer bugs, and pointer-events with overlapping layers. We run a non-modal overlay over the browser view.
- Dialog dismissal blocked by `stopPropagation` on the overlay; broken ARIA references when title or description are absent.
- Select typeahead focusing a removed element; placeholder not resetting on controlled resets.
- Tooltip content mounting twice; `skipDelayDuration={0}` not skipping.

Do not let this turn into the Base UI decision. Phase 0 is worth doing whether or not we ever migrate, and the migration question has its own plan.

### 2. Electron, and the pin that lives in two repos

Half of the blocker recorded in the sweep has genuinely dissolved, and half has not. Both halves matter, because the arithmetic being easy is what makes the remaining cost worth paying deliberately rather than drifting.

**What dissolved.** The sweep found that every 42.x line bundled a different Node, so there was no bump that left the pin alone. That is no longer true. 42.9.3, 42.10.1, 43.4.1 and 44.0.0 all bundle Node 24.18.1. The pin moves once, from 24.15.0, and lands wherever we choose to stop. The major stays 24, so the `@types/node` catalog entry that `check:electron-node-version` also validates does not move at all.

**What did not.** `check:electron-node-version` reads `.node-version`, `.tool-versions` and `engines.node` from the repo root, from Studio's manifest, and from `registry/`. `registry` is a submodule of the skills repo. Moving its three files means committing in skills, pushing, and advancing the submodule pointer here. The pointer sits 14 commits behind skills `main`, so advancing it does not just carry a Node pin: it adopts every registry change in between.

**The registry pointer is gated on [#102](https://github.com/instrument-org/instrument/pull/102)**, `spike/node-runtime-skill-mounts`. The oldest commit in that range, skills `c705e08`, rewrites every `SKILL.md` to invoke its scripts with `node` instead of `tsx`, which only works once the app side of #102 ships. Because it is the oldest, there is no pointer between here and skills `main` that takes the Node pin without also taking it.

That leaves two shapes, and the cheap one is not the obvious one:

- **Wait for #102.** Advance the pointer to skills `main` once it lands, and do the Electron pin in the same pass. Nothing else in the range is blocked.
- **Fork the registry.** Branch off the current pointer with the Node pin alone, push, and point the submodule at that. It works, and it buys Electron a few weeks earlier at the cost of a divergent registry branch that gets thrown away the moment #102 lands.

Take the first unless Electron becomes urgent. The pin is three lines; a divergent registry history is not worth them.

Sequence, once #102 has landed:

1. Advance the `registry` pointer to skills `main`, on its own terms and in its own commit.
2. In skills: `.node-version`, `.tool-versions`, `package.json` `engines.node` and `devEngines.runtime.version` to 24.18.1. Commit, push.
3. In instrument: the same three, plus `apps/studio/package.json` `engines.node`, plus the electron devDependency, plus the submodule pointer.
4. Run `check:electron-node-version`, which shells out to the real binary, so it is the authority rather than any table.

**Which line to take** is a real choice, not a formality:

| | 42.10.1 | 43.4.1 |
| --- | --- | --- |
| Chromium | 148 | 150 |
| Node | 24.18.1 | 24.18.1 |
| Pin cost | identical | identical |
| Risk | patch line we already ship | Chromium major under an app with an embedded browser driven over CDP |
| Lifespan | ends sooner | last line supporting Windows ia32 and Linux armv7l, which electron-builder v27 hard-fails on against 44+ |

42.10.1 is the low-risk stop and carries almost everything below. 43 is the one that wants its own validation pass. Taking 42.10.1 first costs nothing against taking 43 later, because the pin work is shared.

What either buys, all of it landing on surfaces we own:

- A memory leak when creating BrowserWindows (42.9.3). We open a window per task.
- DevTools device-metric overrides persisting indefinitely when a remote debugging client disconnects without clearing them (42.10.0). That is exactly how the in-app browser drives CDP.
- Browser-process crash and spurious preload `ENOENT` when `app.asar` is replaced on disk while running (42.6.2), which is the shape of the updater work in [auto-updater.md](../../architecture/auto-updater.md).
- Downloads of files inside an asar, including saving a packed PDF from the built-in viewer (42.9.2).
- Windows opened from a sandboxed frame not inheriting the opener's sandbox restrictions (42.5.2, 42.9.2), which feeds [browser-popups-as-agent-drivable-tabs.md](browser-popups-as-agent-drivable-tabs.md).
- `ProtocolResponse.url` requests going through the default session rather than the registering session (42.5.1). We register per-task protocol handlers for the asset origin.
- A use-after-free in `protocol.registerStreamProtocol` on a read error (42.8.1).
- The primary instance being killed or receiving truncated arguments when a second instance passes a long command line to `requestSingleInstanceLock` (42.10.1). That is the deep-link path.
- Reduced idle main-process wakeups (42.9.3), and renderer resource loads no longer waiting on main-process idle when no `webRequest` listeners are registered (42.10.1).
- `net.WebSocket` in the main process (42.7.0), relevant because we hand-roll a websocket proxy.

Plus roughly three months of Chromium security backports. `pnpm audit` currently places us inside the `electron <42.5.1` advisory.

### 3. Force the vulnerable transitives with `overrides`

The sweep left this out to keep its lockfile diff attributable, and that call was right. Worth restating precisely, because it is easy to mistake for something a refresh fixes: it is not.

Measured on 2026-08-29. `pnpm dedupe --check` is already clean, and `pnpm update --depth Infinity` over the affected names moves the audit from 1 critical / 46 high to 1 critical / 43 high while *adding* six packages. It does not clear the critical. The old copies survive because different parents pin different ranges, and nothing but an override collapses them.

| Package | Locked | Needs | Severity | Arrives via |
| --- | --- | --- | --- | --- |
| `tar` | 7.5.13 | 7.5.19 | critical | electron-builder |
| `fast-uri` | 3.0.6 | 3.1.5 | high (5 advisories) | ajv, under conf, under electron-store |
| `brace-expansion` | 2.0.2, 5.0.8 | 2.1.4, 5.0.9 | high (4 advisories) | glob, eslint resolvers, just-bash |
| `js-yaml` | 4.1.1 | 4.3.1 | high | electron-updater, parsing our own release feed |
| `extract-zip` | 2.0.1 | 2.0.2 | high | electron |
| `picomatch` | 2.3.1 | 2.3.2 | high | markdownlint-cli2, eslint plugins |
| `nanoid` | 3.3.16 | 3.3.18 | high | vitest, better-auth, embedpdf |
| `mdast-util-to-hast` | 13.2.0 | 13.2.1 | moderate | react-markdown, shiki, rehype-raw |

`brace-expansion` is the one with a reachability argument rather than an audit-hygiene argument: just-bash runs model-authored shell in the main process, so an agent-authored glob is an unprivileged path to a hang or an OOM.

Forcing a version under a build tool is not free. `tar` under electron-builder and `extract-zip` under electron both want a real build and an update install afterwards, not a green typecheck. Do this as its own commit with its own validation, and record what each override is for so the next reader can drop it when the parent catches up.

### 4. The dev-tooling wave

Unchanged from the sweep's framing: individually cheap, collectively a day of churn in lint output, and best done as one batch so the diff is attributable. eslint 10, typescript-eslint 8.67, eslint-plugin-unicorn 56 to 73, perfectionist 5, knip 6.32, oxlint 1.79, oxfmt 0.64.

One thing the sweep did not have: the three repos have drifted apart on exactly these tools. `oxfmt` is 0.61.0 in instrument and internal but 0.57.0 in skills; `knip` is 6.x in the first two and 5.x in skills; `@typescript/native-preview` is a July build here and an April build in internal. Two formatter versions across repos means `check:format` disagrees between them, and an agent formatting a file gets a different answer depending on which repo it is standing in. Align the three in one pass rather than bumping each repo on its own schedule.

### 5. Decisions that are not bumps

- **Base UI.** Scoped in [radix-upgrade-and-base-ui-migration.md](radix-upgrade-and-base-ui-migration.md). Nothing found in this sweep changes that plan's conclusion, including its note that upstream's own position is that switching component libraries is the worst thing to do to a working product. Decide it separately from Phase 0.
- **AI SDK v7.** Still gated on the transcript renderer enumerating from persisted session messages rather than through `convertToModelMessages`, exactly as the sweep recorded. That gate has not moved.
- **`arctic` is deprecated at every published version**, 3.7.0 included, and it is the Google OAuth flow on the sign-in path. Wants a replacement decision, not a version bump.
- **`electron-store` 10 to 11** drags `conf` to 15, which still declares the loose `set(key: string, value: unknown)` overload our patch removes. The bump re-creates the patch rather than retiring it, so pair it with a decision about whether the patch still earns its keep.
- **`tokenx` 1 to 2** recalibrates the estimator, which shifts every threshold tuned against the old one. Relevant to [context-compaction.md](context-compaction.md).

## The patches, and why one of them outlived its fix by a week

`@extend-ai/react-docx@0.8.1` was patched for a thumbnail unmount that upstream fixed in 0.8.4, published 2026-08-24. We carried the patch for five days after it was redundant, and would have carried it indefinitely, because nothing was watching.

`just-bash` does not have this problem: [just-bash-upstream.md](../../architecture/just-bash-upstream.md) registers every patch and agent-facing workaround with a removal trigger next to it, and says to walk both registers whenever the published version moves. The document viewers have no equivalent. Their removal trigger lived in a sentence inside [document-viewers.md](../completed/document-viewers.md), a completed plan nobody re-reads.

The remaining four patches and where they actually stand, checked 2026-08-29 against published tarballs rather than changelogs:

| Patch | Upstream state | Removal trigger |
| --- | --- | --- |
| `sonner@2.0.7` | No fix as of 2.0.8, which contains no `currentCSSZoom` anywhere. Ours is filed as [#785](https://github.com/emilkowalski/sonner/pull/785). | A release carrying #785. Otherwise rebase on every bump. |
| `app-builder-lib@26.15.7` | **Fixed upstream.** PR [#10101](https://github.com/electron-userland/electron-builder/pull/10101) merged to `master` on 2026-08-27, closing [#10066](https://github.com/electron-userland/electron-builder/issues/10066). Functionally identical to ours. | A release containing `7abb30e393`. See below; no published version has one yet. |
| `conf@14.0.0` | No fix. conf 15.1.0 still declares the loose `set` overload at line 28 of its `.d.ts`. | None pending. Re-create on any `electron-store` bump; the patch reads as a reformat and its one substantive line is easy to lose. |
| `@parcel/watcher@2.6.0` | Not a bug fix. Deletes `binding.gyp` to skip the electron rebuild. | Never; permanent by design. |

### How the app-builder-lib patch actually retires

We never name `app-builder-lib`. It arrives under `electron-builder`, `dmg-builder` and `electron-builder-squirrel-windows`, all released in lockstep at the same version, so the only lever is the `electron-builder` devDependency in Studio. The patch is keyed to the exact version, which is why a bump re-keys or retires it rather than silently dropping it.

Moving to v27 is the path, but not yet: `27.0.0-alpha.7` was published 2026-08-17, ten days before the fix merged, so no published v27 carries it either. What retires the patch is the first v27 cut from `master` after 2026-08-27, or a cherry-pick onto `release/v26`, which is still actively released from.

Note that v27 is not only a version number here. It fails fast on Windows ia32 and Linux armv7l against Electron 44+, which is the same constraint that makes Electron 43 the last line supporting those builds. Pair the two decisions rather than taking them separately.

Worth doing regardless of the queue: give the document viewers the same register `just-bash` has, or fold them into one page covering every patch. The cost of not having one is now measured.
