# Browser popups as agent-drivable tabs

Status: proposal / not started. Depends on the multiple-browser-tabs-per-task substrate in [lazy-browser-targets-and-multiple-tabs.md](./lazy-browser-targets-and-multiple-tabs.md).

## Goal

Today a `window.open` popup from an in-app browser guest (e.g. "Continue with Google" on a site the user or agent is browsing) is either denied or opened as a throwaway top-level `BrowserWindow` that only a human can see and drive. Once a task can hold multiple browser tabs, the natural model is: **a popup becomes a new browser tab in the same task**, registered as a first-class browser target, so that

1. the user completes sign-in in-app instead of in a detached OS window, and
2. the agent can enumerate, switch to, read, and drive that tab like any other.

This also lets us retire the stopgap in [manager.ts](../../../apps/studio/src/electron-main/browser-view/manager.ts) that denies agent-initiated popups because they'd be uncontrollable -- once a popup is a contained, drivable tab, that reason goes away.

## Current state (after FP-1201)

- Guests are `<webview>` elements created in the renderer pool ([browser-pool.ts](../../../apps/studio/src/client/lib/browser-pool.ts)), attached via `will/did-attach-webview`, and driven over CDP through Electron's per-`webContents` `debugger`.
- `window.open` policy lives in [window-open-policy.ts](../../../apps/studio/src/electron-main/browser-view/window-open-policy.ts) and [manager.ts](../../../apps/studio/src/electron-main/browser-view/manager.ts): allow only genuine popups (`disposition: new-window`, http/https) and only when the user -- not agent CDP activity (`focusGuard.isGuarded`) -- is driving the guest. Allowed popups open as a child `BrowserWindow` sharing the guest's session; the opener/`postMessage` channel is preserved, so sign-in completes.
- The agent reaches guests through a **single-target** CDP proxy ([cdp-bridge.ts](../../../packages/workspace/src/logic/server/routes/cdp-bridge.ts)): each agent-browser connection is pinned to one `devtools/page/<targetId>` URL, and the whole `Target.*` domain is intercepted so the agent can never discover or attach to any target but its own (`Target.setAutoAttach` is a no-op, `getTargets` returns a synthetic single entry, `createTarget` is redirected to navigate the same view). This is exactly agent-browser's "direct-page provider" mode, which by its own design cannot contain popups. The child `BrowserWindow` also has no debugger and no `BrowserEntry`, so it is invisible to the agent at every layer.

## The load-bearing constraint

OAuth/sign-in popups complete by calling `window.opener.postMessage(...)` (or by `window.close()` + the opener polling `window.closed`). That requires a **real `window.open` opener relationship** between the popup's `WebContents` and the opener guest, in the same session. Chromium establishes that relationship only for a `WebContents` it creates as the `window.open` target -- i.e. only via Electron's `setWindowOpenHandler` allow path.

Consequence: we cannot "reparent" a popup by denying it and re-opening the URL in a fresh renderer `<webview>` guest -- that guest has `window.opener === null` and the channel is dead. The popup's `WebContents` must be the one Electron mints for the `window.open`, and a renderer-created `<webview>` guest's `WebContents` cannot be returned synchronously to Electron at open time.

The tool for this is the `createWindow` field of the window-open handler response, which lets us **construct the popup's host in the main process** and return its `WebContents`:

```ts
guest.setWindowOpenHandler((details) => ({
  action: "allow",
  createWindow: (options) => {
    const view = new WebContentsView({
      webPreferences: options.webPreferences,
    });
    // add `view` to the tab host, register it as a BrowserTarget, return its wc
    return view.webContents;
  },
}));
```

Electron wires `window.opener`/`postMessage` to whatever `WebContents` we return, regardless of how it is displayed. So the popup can be embedded as a tab **and** keep the sign-in channel -- but the host must be a main-process `WebContentsView`, not a `<webview>` guest.

### The central hosting decision

This forces a fork, because normal tabs are `<webview>` guests (renderer-hosted, CSS/zoom-composited within the React tree -- see [responsive-layout.md](../../architecture/responsive-layout.md) for why that model was chosen) while an opener-preserving popup must be a `WebContentsView` (main-hosted, main-managed bounds):

- **Option A -- mixed hosting.** Regular tabs stay `<webview>` guests; popup tabs are `WebContentsView`s slotted into the same tab UI. Smaller change, but two backends: bounds tracking, zoom, focus, screencast, and teardown all need a `WebContentsView` path in addition to the existing `<webview>` path.
- **Option B -- unify on `WebContentsView`.** Migrate all browser tabs to main-hosted `WebContentsView`s. One backend, popups are not special, agent targeting is uniform -- but it reintroduces the main-process-over-zoomed-layout bounds problem the `<webview>` pool was built to avoid, for _every_ tab.

Recommendation: start with **Option A** (popup tabs as `WebContentsView`) to ship the capability without a full migration, and treat Option B as a separate, later decision driven by whether the paint-host `<webview>` model is still worth its complexity once multiple tabs exist.

## Target design

### 1. Popup → registered browser target

On an allowed popup, mint a new `BrowserEntry` ([entry.ts](../../../apps/studio/src/electron-main/browser-view/entry.ts)) with a fresh `targetId` for the same `(taskId, sessionId)`, host its `WebContents` as a tab, attach the debugger (`ensureDebuggerAttached`), and run the normal bind lifecycle (download handler, focus guard, destroy/detach wiring). From that point it is indistinguishable from any other target: it shows up in `listTargets`, gets a `devtools/page/<targetId>` URL in the [`/json` listing](../../../packages/workspace/src/logic/server/routes/cdp-bridge.ts), and is drivable over CDP.

Note the `targetId` is currently `${taskId}/${sessionId}` and assumed unique per `(task, session)`. Multiple tabs/popups per session need a per-tab discriminator in the id (e.g. `${taskId}/${sessionId}/${tabNo}`); this is shared work with the multi-tab feature, not specific to popups.

### 2. CDP bridge: from single-target confinement to a task-scoped browser view

agent-browser's tab and popup machinery (`Target.setDiscoverTargets`, `setAutoAttach {waitForDebuggerOnStart}`, `attachToTarget {flatten}`, `Runtime.runIfWaitingForDebugger`, the `tab`/`tab new`/`tab <id>` subcommands) is built for a **browser-level** endpoint. To let the agent use tabs and popups without forking that tool, evolve the bridge from "one WebContents, Target.\* faked" to a **virtual browser target tree scoped to the task**:

- Expose the task's browser-level endpoint (`devtools/browser`) to agent-browser instead of a single `devtools/page` URL.
- Implement the `Target.*` domain against the task's `BrowserEntry` set only (never the wider Electron process): real `getTargets`, real `attachToTarget` per entry, and emit `Target.targetCreated` / `attachedToTarget` / `targetDestroyed` as entries appear and go.
- When a popup entry is created, emit `Target.targetCreated` so agent-browser surfaces it as a new tab automatically.

Electron divergence to paper over: agent-browser expects new targets to be _paused_ at `waitForDebuggerOnStart` and resumed via `runIfWaitingForDebugger`. Electron's window-open flow does not pause the child that way. Because we control creation (`createWindow`), we can attach the debugger and finish setup _before_ announcing the target, then treat `runIfWaitingForDebugger` as a no-op ack -- the target is already live. This keeps agent-browser's protocol happy without a real pause.

### 3. Agent policy once popups are contained

The `focusGuard.isGuarded` deny added in FP-1201 exists solely because an agent-triggered popup was an uncontrollable detached window. Once popups are contained, drivable tabs, agent-initiated popups can be **allowed as tabs**, subject to bounds:

- A per-task cap on concurrent browser tabs (deny/expire beyond it, and `log` the drop so it isn't a silent truncation).
- Keep them user-visible and closeable; surface tab open/close in the UI.
- Preserve the http(s)-only + `new-window`-disposition shape gate.

The user-vs-agent distinction stops being about allow/deny and becomes about _attribution_ (which tab the agent opened) and _limits_.

### 4. Lifecycle & session

- **Session:** popup tab shares the opener's partition (cookies, deny-all permission handlers, normalized UA) -- same as today's child window.
- **`window.close()`:** the OAuth popup closes itself; close the tab and fire the entry's destruction/detach chain. Decide `outlivesOpener` (default: tab closes with its opener tab).
- **Focus:** reuse the existing focus guard; an agent-opened popup tab should not steal host focus.
- **Teardown:** popup entries participate in the normal `destroyEntry` / `handleDetach` path and the `agent-browser close --session` reap.

### 5. Notify fallback (when a popup is not turned into a tab)

Even with tabs, some opens should still be denied (over the tab cap, non-http(s), policy). In those cases the agent currently gets no signal. The bridge already synthesizes CDP events (it fabricates `Page.loadEventFired` from `Page.frameStoppedLoading`), so on an agent-attributed deny we can push a synthetic `console`/`Log` entry into the agent's event stream ("popup to `<url>` blocked: over tab limit / not allowed") that agent-browser surfaces. Small, contained, and useful independently of the tab work.

## Phased implementation

1. **Make a popup an agent-visible target (no UI reparenting yet).** Keep the current child-window host, but attach a debugger + register a `BrowserEntry` for it so it appears in `/json` and is CDP-drivable. Proves the target plumbing and the opener channel survive registration.
2. **Host popups as `WebContentsView` tabs (Option A).** Switch the allow path to `createWindow` returning a `WebContentsView`, slot it into the (new) browser tab UI, wire bounds/zoom/focus/screencast for that backend.
3. **Task-scoped browser-level CDP bridge.** Replace single-target confinement with the virtual task target tree; emit real `Target.*` lifecycle events; validate against agent-browser's `tab`/popup/auto-attach paths.
4. **Relax agent popup policy.** Allow agent-attributed popups as tabs under a cap; add the notify fallback for denials.
5. **(Later, separate decision) Option B unification** on `WebContentsView` if warranted.

## Risks & open questions

- **Reality check on value.** Google (and most large IdPs) actively block automated sign-in, so an agent driving an OAuth popup still won't authenticate. The real payoff is (a) users completing sign-in in-app, and (b) agents reading and driving _general_ popups (config, preview, "open in new window" content) -- not agent-completed OAuth. Set expectations accordingly.
- **`WebContentsView` bounds under zoom** are the exact problem `<webview>` was chosen to avoid; Option A pays this cost for popup tabs, Option B for all tabs.
- **`targetId` uniqueness** must gain a per-tab dimension (shared with multi-tab).
- **agent-browser's pause/resume assumption** vs Electron's non-pausing window-open (handled by attaching before announcing; needs validation).
- **Security posture** must hold: popup tabs inherit the locked-down session and permission handlers; the tab cap and visibility are the new guardrails replacing blanket deny.
- **Dependency ordering:** this rides on the multi-browser-tab feature (tab UI, per-tab target ids, tab switching). Popups are a _producer_ of tabs; that feature is the substrate.

## Relationship to existing work

- Builds on the FP-1201 popup policy ([window-open-policy.ts](../../../apps/studio/src/electron-main/browser-view/window-open-policy.ts)), which becomes the shape gate; the `isGuarded` deny becomes a cap instead.
- Consumes the multiple-browser-tabs-per-task substrate ([lazy-browser-targets-and-multiple-tabs.md](./lazy-browser-targets-and-multiple-tabs.md)), which also owns the per-tab `targetId` change noted above.
- Distinct from [multi-window-support.md](./multi-window-support.md) (OS windows), though both touch window/target lifecycle.
