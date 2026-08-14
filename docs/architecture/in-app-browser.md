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

Capture requires the guest to be on-screen and unoccluded, which is why "hidden" is a near-zero opacity rather than `display: none`. At most one guest is visible at a time: a task's panel shows its guest only while its tab is foreground and parks it otherwise. **Hiding or closing the panel never disposes a guest** — only the main process's desired set does that.

[`use-browser-slot.ts`](../../apps/studio/src/client/hooks/use-browser-slot.ts) measures the slot and drives show/park; [`use-browser-targets.ts`](../../apps/studio/src/client/hooks/use-browser-targets.ts) exposes which targets have actually attached.

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

Popups follow a shape policy in [`window-open-policy.ts`](../../apps/studio/src/electron-main/browser-view/window-open-policy.ts): real `window.open` popups to http(s) are **allowed** (denying them returns null and hangs "Continue with Google" style sign-in flows), while `target=_blank` and JS tab-opens report `foreground-tab`/`background-tab` and stay denied. Opens are additionally denied while agent CDP activity is driving the guest, so automation cannot spawn a window the user never asked for. Turning popups into real agent-drivable tabs is [a plan](../plans/active/browser-popups-as-agent-drivable-tabs.md), not current behavior.

## Focus

`webContents.isFocused()` is unreliable for `<webview>` guests — it can stay stuck `true` after focus moves to a plain host-page element. The manager therefore trusts renderer-reported DOM focus (`setGuestFocus` / `setHostFocus`) and uses it to route keyboard back/forward, reload, and zoom to the focused guest instead of the tab or the whole window. Main-window zoom is CSS-only (see [responsive-layout.md](responsive-layout.md)) and never reaches the guest's webContents, so guest zoom is a separate path.

Focus is also load-bearing for agent input, which is what makes this more than bookkeeping. A guest is an inner WebContents of the renderer, so the two share one focus tree, and Chromium delivers keyboard input to whichever widget holds focus rather than to the target whose debugger carried the command. A guest that does not hold focus cannot be typed into at all: the keystrokes go to Studio's own window. `dispatch-command.ts` therefore refuses `Input.dispatchKeyEvent`, `Input.insertText`, and `Input.imeSetComposition` unless the guest document reports focus, and points the caller at clicking the element first, which is the one action that reliably reclaims it. Mouse and scroll are routed by hit-testing and need no such check. See [cdp-keyboard-input-follows-window-focus](../findings/cdp-keyboard-input-follows-window-focus.md).

[`focus-guard.ts`](../../apps/studio/src/electron-main/browser-view/focus-guard.ts) keeps the user's caret through agent activity, and splits two questions that look alike. `isAgentDrivenCommand` marks any command as the agent driving the guest, which is what attributes a side effect such as a `window.open` to automation. `bouncesGuestFocus` is the narrower set whose focus transfer is refused on the user's behalf: navigations and explicit focus calls, whose pull on focus is incidental to what was asked for. Input is deliberately excluded from the second, since rejecting the focus a CDP click grants is what sends the agent's next keystroke into the app. Focus taken by agent input is handed back once the target has been quiet for the settle tail, so a click-then-type burst reads as one stretch of work instead of a fight over the caret.

## Which browser a chord means

Focus is not the only claim on a chord, because a guest can be on screen without holding keyboard focus — the common case, since clicking the chat or the URL bar hands focus back to the host. Cmd+F and Cmd+R therefore route by what the user is *looking at*: the foreground task's browser panel registers itself in [`foreground-browser-registry.ts`](../../apps/studio/src/client/lib/foreground-browser-registry.ts) while its guest is live, its tab is foreground, and no overlay covers it, and the app-command bus offers both chords to that panel before falling back to the app-wide behavior. A focused `<webview>` swallows renderer keydowns, so these chords can only arrive as native accelerators through the main process — which is what the registry exists to bridge.

Cmd+R has no app-wide meaning at all: a claimed chord reloads the guest and an unclaimed one does nothing. Reloading the renderer destroys every guest with it — the `<webview>` elements go with the document, main reaps their entries, each task's browser comes back at `about:blank`, and the lifecycle machine closes the task's `agent-browser` sessions — which is more than anyone pressing Cmd+R is asking for. That reload is reachable on `reloadApp` (Cmd+Shift+R), whose Developer group binds only in developer mode, and on the button an app crash puts on screen. See [app-reload-destroys-the-task-browser](../findings/app-reload-destroys-the-task-browser.md).

## Lifetime

[`task-browser.ts`](../../packages/workspace/src/machines/task-browser.ts) supervises a task's browser as an XState machine with `Observed` / `Unobserved` / `GracePeriod` / `Stopping` / `Stopped` states, on two clocks: `AGENT_IDLE_TIMEOUT_MS` (1 hour) and `USER_PRESENCE_TIMEOUT_MS` (5 minutes). The renderer reports presence through `browser.live.presence` in the workspace RPC. Sessions are torn down through `agent-browser-cleanup.ts`; see [agent-browser-orphaned-daemons](../findings/agent-browser-orphaned-daemons.md) and [agent-browser-ref-map-idle-ttl](../findings/agent-browser-ref-map-idle-ttl.md) for the failure modes that shaped it.

## Related

- [agent-sandbox.md](agent-sandbox.md) — the `agent-browser` argv allowlist and asset-URL rewriting.
- [asset-origin.md](asset-origin.md) — the per-task origin the guest loads when it is pointed at the task's own files.
- [in-app-browser-full-page-screenshots](../findings/in-app-browser-full-page-screenshots.md) — why full-page capture is not just a CDP flag.
- [html-artifact-iframe-navigation](../findings/html-artifact-iframe-navigation.md) — the artifact iframe, which is a different surface from this one.
