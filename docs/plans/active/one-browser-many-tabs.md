# One browser abstraction, many tabs

Status: proposal. Supersedes the framing of
[lazy-browser-targets-and-multiple-tabs.md](./lazy-browser-targets-and-multiple-tabs.md)
and [browser-popups-as-agent-drivable-tabs.md](./browser-popups-as-agent-drivable-tabs.md),
which stay as the detailed substrate and consumer respectively. Read this first.

## The idea

A task holds **browser tabs**. Either the user or the agent can open one, both
can see all of them, and either can drive one. That is the whole model. Today we
have three things pretending to be different — the agent's browser, the user's
browser panel, and the HTML artifact preview — and they are the same thing with
different provenance.

The evidence that they are the same thing: the agent and the user already load
the **same URL** through the **same guest pool**. An HTML artifact preview is a
tab whose URL happens to be on the task's asset origin. A popup is a tab the
page opened. A user-opened browser is a tab the user opened. Nothing about any
of them justifies its own target kind, its own RPC, or its own React host.

## What is actually in the way

One line:

```ts
// packages/workspace/src/types.ts
BrowserTargetId = `${TaskId}/${StoreId.Session}`
```

A **session identity doing duty as a page identity**. Everything downstream
inherits the 1:1 that implies: the entry map, the renderer pool's per-id guest,
the panel's single-guest show/park, `createBrowserStatusPart`'s single lookup,
the reaper's per-session fan-out, and — the one that actually blocks the feature
— the CDP bridge, which fakes the whole `Target.*` domain so the agent can never
discover a second page.

**So the tab restriction is ours, not agent-browser's.** The CLI has `tab new`,
`tab list`, `tab switch`, `tab close` and an auto-attach path, all of which
funnel into `Target.createTarget`. We intercept that and redirect it to navigate
the one view we allow. Removing the fakery *is* the feature; we do not build a
tab system, we stop suppressing one.

## The model

Per tab, borrowing a shape that is well-proven in comparable desktop agent apps:

```ts
interface BrowserTab {
  id: BrowserTargetId;          // per page, not per session
  taskId: TaskId;
  openedBy: "agent" | "user";   // provenance, fixed at birth
  boundSessionId: StoreId.Session | null;  // reassignable -- this is hand-over
  agentControl: null | {        // who is driving *right now*, and why
    sessionId: StoreId.Session;
    intent?: string;            // "signing in to Acme" -- shown in the tab strip
  };
  url: string;
  title: string;
  navigated: boolean;           // suppresses about:blank tabs from the strip
}
```

Three fields carry the product:

- **`openedBy`** is how the UI explains a tab that appeared on its own.
- **`boundSessionId` being reassignable** is hand-over. The user opens a tab,
  signs in, and hands it to the agent; or the agent finishes and releases one.
- **`agentControl`** is what makes an agent-driven browser legible rather than
  haunted. A tab the agent is currently driving says so, and says why. It is
  also the natural place to hang input-locking while automation runs.

`openedBy` and `boundSessionId` are deliberately separate. Provenance is
history; binding is current ownership. Conflating them is what makes
"hand this tab to the agent" unrepresentable today.

## Hosting: keep the pool, add a window

The one genuinely open question, and worth stating plainly because it is where
comparable apps diverge from us.

Apps that give each browser **its own window** have a much simpler time: their
view bounds are window-relative (`{x: 0, y: TOOLBAR_HEIGHT, width, height}`),
so there is no slot measurement, no zoom arithmetic, no z-index contest with
overlays, no paint-host. Every one of those exists here only because our guest
is composited inside a CSS-zoomed React layout (see
[responsive-layout.md](../../architecture/responsive-layout.md)).

We should not give that up — a browser beside the chat is the product — but we
should stop paying for it twice:

1. **In-pane tabs stay `<webview>` guests** on the existing pool. The machinery
   already works and is zoom-correct; N tabs is the same machinery with a strip
   above it and only the foreground tab shown.
2. **Add "open in its own window."** A tab detaches into a real window where the
   view is window-relative and all of the above evaporates. This is a feature
   users want anyway, and it is the same host a popup needs.
3. **Popups take the window path.** The popups plan establishes that an
   opener-preserving popup *must* be a main-process `WebContentsView` — a
   renderer `<webview>` cannot be returned to Electron at open time, so
   `window.opener` is dead. That forces mixed hosting regardless; making the
   second host "a window" rather than "a `WebContentsView` slotted into the pane"
   avoids reintroducing main-process bounds tracking over a zoomed layout.

Consequence worth accepting up front: two hosting backends, each with a clear
rule for which one applies. That is better than one backend that has to be both.

## Where state lives

- **The tab set** — id, url, title, `openedBy`, `boundSessionId` — is task
  state. It is agent-mutable, must survive closing a tab, and is not view
  state. `state.json`.
- **Which tab is foreground** stays in the route search params, where
  `artifactPanel` is now. It is view state and deep-linking a task to a
  specific tab is a feature.
- **Per-tab history** stays in the guest's own `webContents` and is not
  persisted. Restoring a tab restores its URL, not its back stack.

The current `artifactPanel: {type: "file" | "browser"}` discriminated union
dissolves: a file artifact that is HTML becomes a tab, and everything else stays
a file viewer. The panel becomes "tabs, or a file viewer" rather than "browser,
or file".

## Phasing

Each phase is independently landable and independently useful.

1. **Lazy target creation.** The workspace stops predicting from argv whether a
   command needs a browser and creates one when something asks. Deletes
   `isBrowserFreeRead` and its three drift-prone flag tables. No protocol or UI
   change. Detail in the substrate plan, Part 1.
2. **Per-page target ids.** Mechanical but wide. Land while still single-tab so
   the tab work is not also an id migration.
3. **Task-scoped `Target.*` at the bridge.** Real `getTargets` /
   `attachToTarget` / `createTarget` over the task's entries; delete the
   synthetic single-target interception. Validate against the CLI's own `tab`
   surface.
4. **Tab strip.** Foreground tab shown, `openedBy` and `agentControl` surfaced,
   blank tabs suppressed via `navigated`.
5. **HTML artifacts as tabs.** The artifact preview becomes "open this file in a
   tab". Retires the sandboxed iframe and both reload nonces.
6. **Open in its own window**, then **popups as tabs** on that host.

## What this retires

- The `Target.*` interception table in the CDP bridge.
- `isBrowserFreeRead`, `browserFreeReadEnv`, the `-read` daemon session, and the
  `INFO_ONLY_FLAGS` special case.
- The artifact iframe, `SandboxedHtmlIframe`, and both HTML reload nonces.
- The redaction in the agent's browser instructions telling it not to use tabs.

## Risks

- **Phase 2 is wide and boring**, which is where mistakes hide. It touches the
  entry map, the pool, the partition carrier, the status part, and the reaper.
  Land it alone.
- **A tab cap** is needed before phase 3 ships: `Target.createTarget` becomes
  agent-reachable, and an agent in a loop can mint pages. Cap per task, refuse
  past it with a clear CDP error.
- **Untrusted content in a real origin.** Agent-authored HTML in a tab gets
  storage and cookies. Per-task storage profiles are the containment, and the
  reasoning is recorded in
  [html-artifact-iframe-navigation](../../findings/html-artifact-iframe-navigation.md):
  origins isolate `localStorage`, but cookies are domain-scoped, so one profile
  shared across tasks would be a cross-task channel.
- **Two hosting backends** (phase 6) means bounds, zoom, focus, capture and
  teardown each need both paths. Deferred to last for that reason.

## Open questions

- Does a tab belong to a session or to the task? `boundSessionId` says session,
  but a user-opened tab has no session until it is handed over. Probably: the
  task owns tabs, sessions borrow them.
- Does the agent see tabs it did not open? Leaning yes — it can already see the
  user's browser today — but `tab list` returning the user's tabs is a real
  privacy surface worth a deliberate answer.
- Whether `openedBy` survives a hand-over or is replaced by it.
