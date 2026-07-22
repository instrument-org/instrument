# Plan: agent browser ad blocking

Status: draft, not started. Revisit when browser reliability or page-noise issues justify changing the default rendering model for task browsers.

---

## Background / why

The task browser currently renders pages without a browser-level ad blocker. That is the most faithful representation of the page, but it also exposes agents to noisy, slow, intrusive, and sometimes hostile ad/tracker surfaces that normal users often block in their own browsers.

Ad blocking is a normal capability for automated browser environments. Hosted browser services expose it as a session setting, and Electron can support it at the session level. For Instrument, the natural integration point is the task-scoped browser session created from `session.fromPath(partitionDir)` in [manager.ts](../../../apps/studio/src/electron-main/browser-view/manager.ts).

The main product question is not whether this is technically possible. It is how to make the blocked rendering model explicit, reversible, and maintained enough that it does not become a hidden source of browser failures.

## Success criteria

- The agent browser can run with a common, well-understood ad/tracker blocker.
- Blocking state is visible to both the user and model-facing browser context.
- A task can reload or continue browsing with blocking disabled.
- Blocked-request telemetry is available for diagnosis without exposing noisy raw logs by default.
- Filter lists update on a predictable cadence and degrade gracefully when offline.
- The implementation is scoped to the task browser, not Studio's own app shell.

## Product direction

### Adopt

- Default-on blocking only if we can ship a clear escape hatch.
- A per-task or per-target browser state flag:
  - `blocking: "enabled" | "disabled"`
  - last filter-list update time
  - blocked-request count for the current page or navigation
- Model context that says when blocking is active, for example:

  ```text
  The task browser is rendering this page with ad/tracker blocking enabled. If the page
  appears broken or asks to disable an ad blocker, use the browser controls to reload
  without blocking.
  ```

- A user-visible control in browser chrome or debug UI to reload the current page with blocking disabled.
- An agent-accessible command path, such as an `agent-browser` option or browser RPC, to disable blocking for the task browser and reload.
- A blocker implementation based on maintained filter-list semantics rather than a small hand-written host blacklist.

### Avoid

- Silent default-on blocking with no model-visible disclosure.
- Treating the blocked rendering as the canonical representation of every site.
- Global Electron session blocking that could affect Studio, auth flows, connectors, or non-task browser surfaces.
- A static filter-list snapshot that only changes when the app updates.
- A custom ad-blocking rules engine unless a maintained package fails our needs.

## Current implementation to account for

- [manager.ts](../../../apps/studio/src/electron-main/browser-view/manager.ts) creates task browser targets, binds guests, and builds the Electron session with `session.fromPath(partitionDir)`.
- [packages/workspace/src/rpc/routes/browser.ts](../../../packages/workspace/src/rpc/routes/browser.ts) starts task browser targets and passes the task-specific partition directory.
- [packages/workspace/src/lib/shell-commands/agent-browser.ts](../../../packages/workspace/src/lib/shell-commands/agent-browser.ts) wraps the `agent-browser` CLI and is the likely place to expose a controlled escape hatch to the agent.
- [packages/workspace/src/lib/browser-status-model-text.ts](../../../packages/workspace/src/lib/browser-status-model-text.ts) formats model-facing browser state and should include blocking state if this ships.

## Proposed architecture

### Session-scoped blocker

Attach the blocker to the task browser's Electron session in `sessionForEntry()`. This keeps blocking scoped to the Chromium profile for a task browser target.

Prefer a maintained Electron-compatible package, such as an ABP/uBO-style filter-list engine, that can:

- load common ads and tracking lists
- update lists independently of app releases
- persist compiled list state for fast startup
- report whether a request was blocked
- disable or bypass blocking for a session or navigation

Electron's `webRequest` API only supports one listener per event, so this should be implemented behind one browser-session network hook or a package that owns that hook. If we later need more `onBeforeRequest` behavior, add a small multiplexer rather than registering independent listeners.

### Blocking state

Add browser target state for:

- enabled or disabled blocking
- last successful list update time
- list update error, if any
- blocked-request count for the last top-level navigation

Use this state in:

- browser debug snapshot
- user-visible browser UI
- model-facing browser context
- optional diagnostics logs

### Escape hatch

Support at least one explicit bypass flow before enabling blocking by default:

- User UI: "Reload without blocking" on the browser surface or debug browser controls.
- Agent path: a constrained command or RPC that disables blocking for the current task browser and reloads the current URL.

The escape hatch should be task-scoped and reversible. It should not permanently mutate global app settings unless the user explicitly asks for that.

### Filter-list lifecycle

The blocker should keep a compiled cached list in app-private state, not inside the task folder. Task exports should not include ad-blocker cache data.

List update behavior should be:

- refresh in the background on a bounded cadence
- use the cached list when offline
- expose stale-list age in diagnostics
- fail open or stay disabled if no usable list is available

Open decision: decide whether "fail open" means no blocking, or last-known-good blocking with a stale warning. Last-known-good is probably better for reliability if the list is not extremely old.

## Implementation phases

### Phase 1: spike

1. Add a local spike that attaches a maintained blocker to one task browser session.
2. Verify navigation, screenshots, text extraction, downloads, popups, and CDP command handling still work.
3. Compare blocked and unblocked loads on:
   - a news site with heavy ad/tracker load
   - a site with anti-ad-blocker messaging
   - a login-heavy site
   - a simple static page
4. Record page breakage cases and blocked-request counts.

### Phase 2: state and diagnostics

1. Add target-level blocking state to the browser manager.
2. Show blocking state in the debug browser snapshot.
3. Track blocked-request counts per navigation.
4. Add model-facing browser context that discloses active blocking.

### Phase 3: escape hatch

1. Add "reload without blocking" from the browser UI or debug surface.
2. Add a constrained agent-accessible route for disabling blocking on the current task browser.
3. Add the inverse route if re-enabling blocking during the same task is useful.
4. Make sure the state change survives page reloads but not necessarily unrelated tasks.

### Phase 4: list updates

1. Persist the blocker cache in app-private data.
2. Add background refresh with bounded network use and timeout behavior.
3. Surface stale-list age and refresh failures in diagnostics.
4. Decide whether app startup waits for a cached blocker or starts the task browser immediately and attaches the blocker when ready.

### Phase 5: default behavior

1. Ship behind a feature flag.
2. Dogfood with default-off, then default-on for internal builds if breakage is low.
3. Move to default-on only after the escape hatch and stale-list diagnostics are working.

## Open decisions

1. Default mode: enabled by default, opt-in per task, or feature-flagged until more data exists.
2. Filter source: prebuilt ads/tracking lists from a maintained package vs explicit list URLs we own.
3. Update cadence: app startup, daily background refresh, or refresh only after a stale threshold.
4. State persistence: per target only, per task, or global default with per-task override.
5. User UI location: browser chrome, debug page only, command menu, or all of these.
6. Model wording: how much blocked-rendering caveat to include without wasting context on every browser turn.

## Risks

- Blocked pages are not fully authentic. The agent may miss ad-funded layout, anti-ad-block messages, consent flows, or tracking-dependent behavior.
- Some sites break or intentionally gate content when ad blockers are detected.
- Stale filter lists can become a hidden reliability issue if they only update with app releases.
- Filter-list updates add background network behavior that needs clear ownership, diagnostics, and privacy expectations.
- Browser `webRequest` listener ownership can conflict with other session-level request interception if we add it casually.
- Aggressive blocking can make screenshots and accessibility snapshots differ from what a user sees in their normal browser.

## Non-goals

- Building a general privacy browser.
- Blocking ads in external user browsers.
- Adding cosmetic filtering polish before request-level blocking and the escape hatch are proven.
- Applying blocking to Studio's renderer, onboarding windows, auth, or connector flows.
