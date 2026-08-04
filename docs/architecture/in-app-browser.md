# In-app browser

Each task can hold a browser the **agent drives over CDP** and the **user drives with mouse and keyboard** — the same guest, not two browsers. This doc maps where that guest actually lives, who owns its lifetime, and how the two drivers reach it, because the pieces are split across the renderer, the Electron main process, and the workspace server, and none of them is the obvious place to start reading.

For why the agent gets a managed `agent-browser` wrapper rather than the upstream CLI, see the [decision record](../decisions/2026-07-10-managed-agent-browser-wrapper.md); for the browser profile, [workspace-browser-profile](../decisions/2026-07-13-workspace-browser-profile.md).

## The guest is a renderer-owned `<webview>`, not a main-process view

This is the fact that makes everything else make sense, and it is not what you would guess from `apps/studio/src/electron-main/browser-view/`.

The guest is a `<webview>` element appended to `document.body` in the **renderer**, managed by the pool in [`client/lib/browser-pool.ts`](../../apps/studio/src/client/lib/browser-pool.ts). The main process owns only _which targets should exist_ and streams that desired set over the `browser.targets` RPC ([`electron-main/rpc/routes/browser.ts`](../../apps/studio/src/electron-main/rpc/routes/browser.ts)); the pool reconciles to it, mounting on add and disposing on remove.

Each guest stays parented to `document.body` for its whole life so that React reconciliation, or a host subtree being hidden, can never unmount it. Unmounting would drop its compositor surface, which breaks capture and input.

## Two visibility modes, and why it is never truly hidden

- **paint-host** — laid out at the guest's logical size but visually hidden (`opacity: 0.001`). Chromium still paints it on screen, so `capturePage()` and CDP input keep working while nothing is showing it.
- **visible** — positioned over a host slot (the task page's browser panel) and scaled to fit, with input enabled.

Capture requires the guest to be on-screen and unoccluded, which is why "hidden" is a near-zero opacity rather than `display: none`. **Hiding or closing the panel never disposes a guest** — only the main process's desired set does that.

Nothing in the pool limits how many guests are visible: `showOverSlot` and `setPaintHost` are per-target, and two guests over two disjoint rects would both paint. In practice the callers keep it to one, because a task's browser panel and its artifact preview are the same slot (`artifactPanelSchema` is a discriminated union, and `TaskView` renders one or the other) and each shows its guest only while its tab is foreground.

Two things can cover a slot without looking like a tab switch, and both are inputs to the hook rather than something it can detect:

- A full-window **overlay** (an app-wide studio modal, or the file viewer's expand modal) is drawn over the page, but the guest is mounted on `document.body` outside every dialog subtree, so it would keep painting straight over the dim layer. A host under one passes `covered` and parks; see [`use-guest-covered.ts`](../../apps/studio/src/client/hooks/use-guest-covered.ts).
- A host that lives *inside* an overlay wants the opposite: it passes a `zIndex` so the guest clears the overlay. Radix's body-level `pointer-events: none` does not make the guest inert, because the pool's container sets `pointer-events: auto` explicitly.

When both a panel and a modal are mounted for the same target, the raised one shows and the covered one parks; closing the modal flips `covered` back and hands the guest to the panel. Without that flip the panel would never re-claim it, because the modal's slot parks the guest as it unmounts and the panel's own inputs never changed.

[`use-browser-slot.ts`](../../apps/studio/src/client/hooks/use-browser-slot.ts) measures the slot and drives show/park; [`use-browser-targets.ts`](../../apps/studio/src/client/hooks/use-browser-targets.ts) exposes which targets have actually attached.

## Two target kinds

`BrowserTargetId` has two admissible forms, one per guest kind ([`types.ts`](../../packages/workspace/src/types.ts)):

```
${taskId}/${sessionId}   session guest   -- the agent-drivable browser this doc is mostly about
${taskId}/artifact       artifact guest  -- the task's HTML artifact preview
```

`artifact` is a fixed sentinel, not an id; session ids are `ses_`-prefixed ULIDs, so the two cannot collide. `decodeBrowserTargetId` returns a discriminated `{kind}` so callers that only make sense for one kind have to say which.

The artifact guest exists so that the surface the agent verifies its own work on and the surface the user reads are the same kind of thing — both a real origin, both a real webContents. See [html-artifact-iframe-navigation](../findings/html-artifact-iframe-navigation.md). It differs from a session guest in four ways:

- **One per task**, navigated between files with `loadURL` rather than one webContents per HTML file.
- **Its own storage profile, per task** (`<rootDir>/<private>/artifact-preview-session/<taskId>`), so agent-authored pages get their own cookie jar and storage rather than sharing the browsing profile — and rather than sharing one with each other. The distinct asset origins are not enough on their own: `localStorage` and IndexedDB are keyed by origin, but cookies are scoped by domain, so a page on `assets.<a>.localhost` could set one for `localhost` and read it from another task's preview through a shared jar. `trash-task` removes the profile with the task.
- **Not agent-reachable.** `listTargets` skips it, so it never appears in the agent's `/json` discovery, and the CDP bridge refuses a WS upgrade for an artifact-kind id.
- **Opens no child window**, where a session guest allows real sign-in popups — though `target=_blank` still reaches the OS browser (see the popup policy below).
- **Downloads prompt** rather than being cancelled. The session's `will-download` handler cancels anything without an agent-authorized save path, which is what an agent-driven guest wants; a preview has no agent, and a download button in a generated report worked on the iframe this replaced.

Its lifetime is [`artifact-preview.ts`](../../packages/workspace/src/machines/artifact-preview.ts), not `task-browser.ts`: a presence lease plus a 30s grace period, with no agent-idle clock and no `agent-browser close --session` fan-out, neither of which describes a passive preview.

## Attach lifecycle

`createTarget` in [`manager.ts`](../../apps/studio/src/electron-main/browser-view/manager.ts) records an entry, then waits for the renderer to mount the guest and Electron to fire `did-attach-webview`. Target ids accepted in `will-attach-webview` are drained through a FIFO, and each entry carries a generation bumped per create so the renderer pool can diff a recreate of a just-destroyed id against the old one.

Attachment resolves a one-shot signal created with the entry ([`entry.ts`](../../apps/studio/src/electron-main/browser-view/entry.ts)); teardown rejects it. That is what stops a `createTarget` racing a teardown from hanging until its own timeout. Destruction notifies listeners for _any_ reason — explicit close, detach, renderer crash, or a handshake that timed out before the guest attached.

## How the agent reaches it

```
agent bash tool
  `agent-browser ...` (managed wrapper: lib/shell-commands/agent-browser.ts)
      |  CDP over ws
  workspace server CDP bridge (logic/server/routes/cdp-bridge.ts + websocket-proxy.ts)
      |  ws://127.0.0.1:<port>/…/devtools/page/<targetId>
  main process dispatch-command.ts  ->  guest webContents.debugger
```

The wrapper rejects upstream flags and subcommands that would select another connection or persistence model, and rewrites screenshot/download paths into the task's `tmp/` (see [agent-sandbox.md](agent-sandbox.md) for the argv policy). Two quirks live in [`dispatch-command.ts`](../../apps/studio/src/electron-main/browser-view/dispatch-command.ts):

- **Screenshots bypass the debugger.** `Page.captureScreenshot` is served from `webContents.capturePage` instead, because the debugger's `fromSurface` path blocks on a compositor frame when the window is occluded or minimized, while plain `capturePage` lets Electron force a frame.
- **`Browser.getWindowForTarget` returns a stub.** Electron's debugger does not implement the `Browser` domain, and agent-browser probes it to discover window dimensions, so the gateway answers with a fixed stub matching the default viewport rather than logging an error per session.

## Policy split: the panel may do things the agent may not

`Emulation.setDeviceMetricsOverride` is **refused outright** for agent-browser callers in `dispatch-command.ts`, but available to the panel's "View as" menu through [`device-emulation.ts`](../../apps/studio/src/electron-main/browser-view/device-emulation.ts). The difference is `scale`: the panel computes it from the guest's live measured bounds, so the surface always shrinks to fit what is on screen. An external caller cannot know the guest's current on-screen size, and an unscaled oversized override is what corrupted the panel with dead space and cropped rendering. See also [in-app-browser-device-emulation](../findings/in-app-browser-device-emulation.md).

Popups follow a shape policy in [`window-open-policy.ts`](../../apps/studio/src/electron-main/browser-view/window-open-policy.ts): real `window.open` popups to http(s) are **allowed** (denying them returns null and hangs "Continue with Google" style sign-in flows), while `target=_blank` and JS tab-opens report `foreground-tab`/`background-tab` and stay denied. Opens are additionally denied while agent CDP activity is driving the guest, so automation cannot spawn a window the user never asked for, and an artifact guest opens no child window at all — that allowance exists for flows reached by browsing, which agent-generated HTML has none of. It does still hand `target=_blank` http(s) opens to `openExternal`, matching what those links did on the iframe it replaced; refusing them outright would leave an ordinary external link in a report dead with no address bar to follow it from. Turning popups into real agent-drivable tabs is [a plan](../plans/active/browser-popups-as-agent-drivable-tabs.md), not current behavior.

## Focus

`webContents.isFocused()` is unreliable for `<webview>` guests — it can stay stuck `true` after focus moves to a plain host-page element. The manager therefore trusts renderer-reported DOM focus (`setGuestFocus` / `setHostFocus`) and uses it to route keyboard back/forward, reload, and zoom to the focused guest instead of the tab or the whole window. Main-window zoom is CSS-only (see [responsive-layout.md](responsive-layout.md)) and never reaches the guest's webContents, so guest zoom is a separate path.

## Lifetime

[`task-browser.ts`](../../packages/workspace/src/machines/task-browser.ts) supervises a task's **session** browser as an XState machine with `Observed` / `Unobserved` / `GracePeriod` / `Stopping` / `Stopped` states, on two clocks: `AGENT_IDLE_TIMEOUT_MS` (1 hour) and `USER_PRESENCE_TIMEOUT_MS` (5 minutes). The renderer reports presence through `browser.live.presence` in the workspace RPC. Sessions are torn down through `agent-browser-cleanup.ts`; see [agent-browser-orphaned-daemons](../findings/agent-browser-orphaned-daemons.md) and [agent-browser-ref-map-idle-ttl](../findings/agent-browser-ref-map-idle-ttl.md) for the failure modes that shaped it.

The artifact guest has its own machine (see [Two target kinds](#two-target-kinds)) with only the parts that apply: a presence lease over `artifactPreview.live.presence` and a 30s grace period, short enough that a closed panel does not hold a webContents and long enough to absorb switching between two HTML files or flipping tabs. Three independent guards stop a webContents leaking, because the renderer asks for the resource and the main process owns it: the lease rides a subscription so an aborted stream releases it, the grace timer fires on its own with nothing sent, and stopping the task reaps unconditionally through the parent.

## Related

- [agent-sandbox.md](agent-sandbox.md) — the `agent-browser` argv allowlist and asset-URL rewriting.
- [in-app-browser-full-page-screenshots](../findings/in-app-browser-full-page-screenshots.md) — why full-page capture is not just a CDP flag.
- [html-artifact-iframe-navigation](../findings/html-artifact-iframe-navigation.md) — why HTML artifacts moved off a sandboxed iframe onto this pool.
