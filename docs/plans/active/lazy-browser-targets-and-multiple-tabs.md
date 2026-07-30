# Lazy browser targets, and multiple tabs per task

Status: proposal / not started. Part 1 stands alone; Part 2 is the multiple-browser-tabs-per-task substrate that [browser-popups-as-agent-drivable-tabs.md](./browser-popups-as-agent-drivable-tabs.md) depends on.

## The shared root cause

Two problems that look unrelated come from the same decision.

**The workspace decides that a browser is needed before the CLI has said so.** [agent-browser.ts](../../../packages/workspace/src/lib/shell-commands/agent-browser.ts) calls `browser.createTarget` and mounts a `<webview>` guest _before_ spawning the CLI, because the CDP URL has to be baked into the provider plugin registry (`AGENT_BROWSER_PLUGINS`) that the spawn carries. So the wrapper has to predict, from argv alone, whether the invocation will ever want a page. It predicts with hand-maintained tables: `INFO_ONLY_FLAGS`, `BLOCKED_SUBCOMMANDS`, and the three read-flag sets behind `isBrowserFreeRead` (`READ_FETCH_FLAGS`, `READ_FETCH_VALUE_FLAGS`, `READ_SAFE_GLOBAL_FLAGS`). Each table mirrors a piece of the CLI's own argument parser and drifts every time upstream moves.

**One target per session.** `BrowserTargetId` is `${taskId}/${sessionId}` ([types.ts](../../../packages/workspace/src/types.ts)), a session identity doing duty as a page identity. The [CDP bridge](../../../packages/workspace/src/logic/server/routes/cdp-bridge.ts) therefore pins each connection to one page and fakes the whole `Target.*` domain so the agent can never discover another one.

Both fall out of "the wrapper owns target creation, and a target is a session." Fixing the first is the natural first step of fixing the second.

## What the CLI actually does

Verified against the pinned agent-browser (0.31.x; see `packages/workspace/package.json`). Keep these claims in step with the pin.

- `skip_launch_action` (`cli/src/native/actions.rs`) is the CLI's own answer to "does this command need a browser": `launch`, `close`, `read`, `har_stop`, the `credentials_*` / `auth_*` / `state_*` / `stream_*` families, `confirm`, `deny`, `device_list`, `session_info`. For those the daemon never calls `auto_launch`, so it never asks a provider plugin for a CDP URL, so it never connects to us.
- Every other action, with no live browser, calls `auto_launch` and then `ensure_page()`.
- `read` is in that list keyed on the action name alone, and `handle_read` returns a plain HTTP fetch for any invocation carrying a URL. But **skip-launch governs only the daemon.** The client independently sends its own `launch` command when any local launch option is on argv and none of `--cdp` / `--provider` / `--auto-connect` is (`should_send_local_launch_config`, `cli/src/main.rs`), and that command launches a real browser. This is why `isBrowserFreeRead`'s flag tables are load-bearing rather than redundant: the browser-free path drops the whole `AGENT_BROWSER_*` namespace, provider included, so nothing suppresses that client-side launch. Confirmed directly: `--executable-path /nonexistent/chrome read <url>` fails with "Failed to launch Chrome", while the same `read` without the flag returns the page.
- `read` with no URL reads the active page, so it needs a browser the daemon will never launch for it. As the first browser command of a session it returns "Browser not launched" (confirmed directly), after we have already created a view for it.
- Handlers that need a page already refuse cleanly without one. `state.browser.as_ref().ok_or("Browser not launched")` appears ~145 times in `cli/src`. Refusing is the house style upstream; we pre-empt it by creating the page first.
- At connect, `discover_and_attach_targets` (`cli/src/native/browser.rs`) issues `Target.getTargets` and, on an empty tree, immediately `Target.createTarget` about:blank. The only reason we don't eat that on every connection today is the synthetic single-target reply in our bridge.

## Part 1: create the target on CDP demand

The whole change is that the workspace stops guessing and answers a request instead.

The CDP URL needs no `createTarget` to construct, because the target id is already derivable from `(taskId, sessionId)` via `encodeBrowserTargetId`. So:

1. The wrapper computes the CDP URL from `encodeBrowserTargetId` and drops the eager `createTarget` call.
2. Target creation moves to the moment something asks for a browser. Two candidate hooks, in preference order:
   - **The provider plugin's `browser.launch`** ([agent-browser-plugin.ts](../../../packages/workspace/src/lib/agent-browser-plugin.ts)). The daemon spawns this only when it has decided it needs a browser, which is exactly the signal, and it fires _before_ the CDP connect, so `createTarget`'s attach wait (15s worst case, waiting on the renderer to mount a guest) stays off the WebSocket upgrade path. Requires the plugin to reach the workspace server, so it gains an HTTP callback argument alongside the CDP URL it already receives.
   - **The WebSocket upgrade handler** in the bridge, creating-or-returning when `getTargetMeta` comes back null. Simpler (no new plugin round trip) but puts the attach wait inside the upgrade.
3. `recordBrowserUse` / `enrichBrowserState` move to the same trigger, so browser state records browsers that existed rather than commands that might have wanted one.

### What this retires

All of it, permanently:

- `isBrowserFreeRead`, its three flag tables, `browserFreeReadEnv`, and the `-read` daemon session, as one unit. They exist together: a read is routed away from the provider so it can't start the task browser's daemon, and stripping the provider is exactly what re-arms the client-side local launch that the tables then have to catch. Once the provider is only a URL rather than a promise that a view exists, a read keeps it, both launch paths stay shut, and nothing needs recognizing.
- The `INFO_ONLY_FLAGS` special case for `--help` / `--version`.
- The wasted view behind `read` with no URL. The command still fails, because the daemon still won't launch for it, but it fails without having minted a guest first.
- The whole class of future drift. Every member of `skip_launch_action` is free by construction, including ones added after our pin moves, and every subcommand upstream adds that happens not to need a page.

### What it does not fix

A command that genuinely needs a page, run when no page exists, still creates one. `get url` on a session that never opened anything is the canonical case: the CLI classifies it as launch-worthy, and it is right to, because the daemon cannot know the page is empty until it has one.

That residual is handled separately, and already is: an entry now carries `navigated`, flipped on the first main-frame navigation to a real URL, and the UI keys off that rather than off attach. A target nothing ever navigated does not hijack the artifact panel and does not produce a `browserStatus` note to the model. Under lazy creation that stays the right defense, because the thing being suppressed is a browser the agent asked for by accident, not one we created by mistake.

### Risks

- **Failure surfacing.** Today a target that can't be created fails in the wrapper, before the CLI runs, with our own message. Lazily, it fails as a plugin error or a refused WebSocket upgrade, and the agent sees whatever the CLI says about that. Map it to something actionable.
- **Attach latency inside a connect.** Mitigated by preferring the plugin hook; if the bridge hook is chosen instead, the CLI's connect timeout has to tolerate a cold renderer mount.
- **Daemon reuse.** A daemon already running for the session holds the CDP URL from its own launch. Deriving the URL rather than minting it removes the staleness this currently guards against, so this gets simpler, not harder.

## Part 2: multiple tabs per task

With creation on demand in place, `Target.createTarget` at the bridge becomes the single "make me a page" signal, and it is the only one: `tab new`, `ensure_page`, and the empty-tree branch of `discover_and_attach_targets` all funnel into it, carrying a URL when there is one. That is the whole substrate for tabs, and it means not forking or reimplementing the CLI's `tab` surface.

### The identity change

This is the real work. `BrowserTargetId` has to stop being a session identity:

- Target ids become per-page (`${taskId}/${sessionId}/${n}` or similar), while the CDP endpoint the agent connects to becomes session-scoped and browser-level (`devtools/browser`) rather than one `devtools/page/<id>`.
- The 1:1 assumptions that currently ride on that id have to move: the entry map keyed by it, the renderer pool's per-id `<webview>` and partition carrier, the panel's single-guest show/park ownership, `createBrowserStatusPart`'s single-target lookup, the reaper's `agent-browser close --session` fan-out, and `browserPartition` / `targetIdFromPartition`.

### The bridge change

Replace single-target confinement with a virtual target tree scoped to the task: real `getTargets` and `attachToTarget` over the task's entries only, `Target.targetCreated` / `targetDestroyed` events as entries come and go, and `Target.createTarget` as the view factory. The interception table exists purely to prevent the agent from discovering unrelated Electron targets; scoping the tree to the task's entries achieves the same containment without the fakery.

[browser-popups-as-agent-drivable-tabs.md](./browser-popups-as-agent-drivable-tabs.md) covers the rest of that surface in detail (the `waitForDebuggerOnStart` divergence, hosting a popup as a `WebContentsView`, tab caps, the notify fallback). Treat it as the consumer: popups produce tabs, this plan is the substrate.

### Note on blank tabs

Tabs make the empty-page problem more common, not less: both `discover_and_attach_targets` and `ensure_page` fabricate an about:blank page whenever the tree is empty. The `navigated` flag from Part 1's residual is what keeps that invisible, and it needs to become per-tab along with everything else, so a blank tab does not appear in the tab strip until something loads in it.

## Phasing

1. **Lazy creation** (Part 1). Self-contained, no protocol change, no UI change. Delete the flag tables in the same commit that removes their reason to exist.
2. **Per-page target ids.** Mechanical but wide. Land it while still single-tab, so the tab work isn't also an id migration.
3. **Browser-level bridge.** Real `Target.*` over the task's entry set; validate against the CLI's `tab list` / `tab new` / `tab switch` / `tab close` and its auto-attach path.
4. **Tab UI.** Tab strip, per-tab show/park, per-tab status in chat, agent attribution.
5. **Popups as tabs**, per the popups plan.

## Open questions

- Which hook: plugin callback or WebSocket upgrade. The plugin is better on latency and precision; the bridge is fewer moving parts. Decide with a real measurement of cold-mount time inside a connect.
- Whether the per-tab id should be opaque or structured. Structured (`${taskId}/${sessionId}/${n}`) keeps the partition carrier and the debug snapshot readable; opaque removes the temptation to parse it.
- What a session-scoped CDP endpoint means for the reaper, which currently closes by session and would gain a fan-out over tabs.
- Whether a per-task tab cap belongs here or in the popups plan (it is a limit on target creation, so probably here).

## Relationship to existing work

- Substrate for [browser-popups-as-agent-drivable-tabs.md](./browser-popups-as-agent-drivable-tabs.md).
- Touches the bridge and target model described in [in-app-browser.md](../../architecture/in-app-browser.md); that doc needs updating as each phase lands.
- Part 1 removes most of what [external-browser-behind-a-flag.md](./external-browser-behind-a-flag.md) added around read routing, but not the external-session split itself, which is about connection identity rather than page creation.
