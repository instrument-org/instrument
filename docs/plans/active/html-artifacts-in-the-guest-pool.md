# HTML artifacts in the guest pool

Status: active — built and driven against a running Studio. Remaining items are in
[What is still unverified](#what-is-still-unverified).

Render HTML file artifacts through the `<webview>` guest pool instead of the
sandboxed `<iframe>`, so the surface the agent verifies its own work on and the
surface the human reads are the same kind of thing.

## Why this is not about back/forward

Back/forward chrome is the visible payoff, and it is the smaller half.

The agent and the human already load the **same URL**. `agent-browser goto
output/report.html` is rewritten onto the per-task asset origin by
[`agent-browser-asset-url.ts`](../../../packages/workspace/src/lib/shell-commands/agent-browser-asset-url.ts),
and that origin is exactly what `getAssetUrl` puts in the iframe's `src`. What
differs is the surface underneath: the agent gets a real origin in a `<webview>`
guest, the human gets an opaque-origin sandboxed iframe.

So when the agent screenshots a page to check its own work, it is validating
something the human will not see. Anything that keys off origin — `localStorage`,
`sessionStorage`, IndexedDB, cookies, `document.domain`, same-origin `fetch`
of a sibling file — behaves differently in the two. Agent-authored HTML that
persists a filter selection, or reads its own `data.json` through a code path
that branches on a CORS failure, is exactly the class of thing that passes the
agent's check and fails in front of the user. Unifying the surface is what makes
the agent's self-verification cover the human's experience.

Prior art: [html-artifact-iframe-navigation](../../findings/html-artifact-iframe-navigation.md)
names this approach and its blocker; [in-app-browser.md](../../architecture/in-app-browser.md)
is where the guest actually lives.

## Q1: can two guests be visible at once?

**The constraint is per-slot, not absolute — and in the artifact panel the
conflict cannot arise at all.**

The sentence in `in-app-browser.md` ("at most one guest is visible at a time") is
a description of what the current callers do, not an invariant the pool
enforces. `browser-pool.ts` keys `paintOwners` by target id, and neither
`showOverSlot` nor `setPaintHost` has any step that hides other guests. Two
guests at two disjoint fixed-position rects would both paint. The pool's own
comment says as much: *"each task's browser panel shows its guest only while its
tab is the foreground tab … so two guests can never be shown at once"* — a
consequence of one panel per tab, not a mechanism.

More decisively, the scenario the brief worries about — browser panel open, user
opens an HTML artifact — **cannot happen in one task tab**. `artifactPanelSchema`
is a discriminated union of `{type: "file"}` and `{type: "browser"}`, and
`TaskView` renders `TaskBrowserPanel` *or* `FileViewer` into the same
`ResizablePanel`. They are the same slot. Opening an HTML artifact replaces the
browser panel; it does not sit beside it.

So this design has no conflict at its core. It has one at its edge:
`TaskFileViewerModal`, which is a dialog over the whole window and can be opened
while a browser panel is showing behind it. There the panel's guest must park, and
today nothing tells it to — the modal is not a tab switch, so `useIsActiveTab`
stays true and `useBrowserSlot` keeps painting the panel's guest over a slot the
overlay is now covering. **That is a bug that already exists on `main`**, and this
plan has to fix it rather than inherit it. See
[The modal](#the-modal-is-the-only-real-two-guest-case).

## Q2: does the pool support a per-target partition?

**Yes — but at the manager, not the pool, and via `partitionDir` rather than the
`partition` attribute.** This matters because it is the thing that dissolves the
security tradeoff.

The renderer's `partition` attribute is only a carrier for the target id
(`browserPartition()` in `shared/browser.ts`); `will-attach-webview` immediately
overrides it with `webPreferences.session = sessionForEntry(entry)`, and
`sessionForEntry` does `session.fromPath(entry.partitionDir, { cache: true })`.
`partitionDir` is already a per-entry field, threaded all the way from
`BrowserConfig.createTarget(id, sessionId, partitionDir)`.

Every current caller — `workspace.browser.open` and `agent-browser.ts` — happens
to pass the same `getBrowserSessionDir()`. Nothing requires that. An artifact
target passing a different directory gets its own cookie jar, storage, and cache,
with no change to the pool at all.

The permission posture comes for free and is **stricter than the iframe's**.
`sessionForEntry` installs `setPermissionRequestHandler(() => callback(false))`
and `setPermissionCheckHandler(() => false)` — every permission denied. The
current iframe's `allow` list grants camera, microphone, geolocation, clipboard,
display-capture, MIDI, payment, and USB. Moving agent-generated HTML from the
iframe to a guest *removes* those grants.

## Q3: same guest instance, or same guest kind?

**Same kind. Recommended, not merely defaulted to.**

*Same instance* — the artifact preview literally being the agent's guest — is
what "the agent sees what the user sees" most strongly implies, and it is the
wrong call here for four reasons, in ascending order of severity:

1. **Input conflicts are already a known cost.** `browser-panel.tsx` carries
   `editingUrlRef` purely so an agent navigation cannot overwrite a URL the user
   is mid-way through typing. That is the mild version of the problem; sharing an
   instance generalizes it to every control.
2. **The lifetimes are different and irreconcilable.** The agent's guest is
   session-scoped and reaped on a 1-hour agent-idle clock. An artifact preview is
   file-scoped and should live exactly as long as something is showing it. One
   webContents cannot have both.
3. **The agent navigates away mid-read.** Under one instance, the agent moving on
   to the next page yanks the document out from under a user who is reading it,
   with no recourse — the user's back button and the agent's history are the
   same history.
4. **Decisive: it would make a human click mutate agent state.** Because the
   artifact panel and the browser panel are the same slot (Q1), "same instance"
   means opening `report.html` from the file sidebar *is* navigating the agent's
   browser. A user browsing their own output would silently rewrite the page the
   agent is working against, and would show up in the agent's next `get url` as
   though the agent had gone there.

*Same kind* gets what the "why" actually asks for: both surfaces are real
origins, both are real webContents, both are screenshot-able and drivable, both
render through the identical Chromium path with identical privileges. The agent's
screenshot becomes valid evidence about the human's view. What it does not get is
a shared cursor, and that was never the goal.

If a deliberate "show me what the agent is looking at" is wanted later, it should
be an explicit hand-over gesture (adopt the agent's guest into the panel), not an
implicit consequence of opening a file.

## Design

### A second target kind

`BrowserTargetId` is `` `${TaskId}/${StoreId.Session}` ``, branded, with both
halves validated. Artifact guests are not session guests, so the id gains a
second admissible form:

```
${TaskId}/${StoreId.Session}   session guest   (unchanged)
${TaskId}/artifact             artifact guest  (new)
```

`artifact` is a fixed sentinel, not an id. Session ids are `ses_`-prefixed
ULIDs, so there is no collision. `decodeBrowserTargetId` becomes a discriminated
return (`{kind: "session", id, sessionId}` | `{kind: "artifact", id}`).

**One artifact guest per task, not one per file.** The panel calls `loadURL` when
the selected file changes, exactly as a browser tab does. This is what keeps the
cost at one webContents per task with a preview open, makes escape-to-root a
plain `loadURL(entry)`, and — because the expand modal shows the same file the
panel does — means the modal and the panel are two slots contending for *one*
guest, which `paintOwners` already handles correctly.

Known limitation, recorded rather than solved: a task open in two tabs with
different files selected shares one guest, so the URL follows the foreground tab.

**Coordination.** [lazy-browser-targets-and-multiple-tabs.md](./lazy-browser-targets-and-multiple-tabs.md)
Part 2 proposes retiring session identity from the target id entirely
(`${taskId}/${sessionId}/${n}`). This plan is a second consumer of the same
premise and should land *before* that migration, so the migration moves one id
scheme with two known kinds rather than being designed around a kind it did not
know about. The sentinel form survives that change unmodified.

### Creation, and not leaking a webContents

`workspace.browser.open` is a task/session browsing concept and is the wrong
door. Artifact targets get their own RPC pair, `workspace.artifactPreview.open` /
`.close`, and their own `BrowserConfig.createArtifactTarget(id, partitionDir)`.

Lifetime is **not** `task-browser.ts`. That machine keys `knownTargets` by
session id, and its teardown calls `closeAgentBrowserSessionsForSessions` —
agent-browser daemon cleanup that is meaningless for a preview. Its clocks are
wrong too: a 1-hour agent-idle timer on a passive preview is a webContents held
for an hour after the user closed the panel.

Instead, a sibling machine `machines/artifact-preview.ts` with only the shape
that applies: a presence lease (acquired while an HTML preview is mounted,
released on unmount) and a short grace period — 30s, so switching between two
HTML files or flipping tabs does not thrash a create/destroy cycle — then stop.
No agent-idle clock, no daemon fan-out. Parent-wired like `taskBrowser` so
stopping a task reaps it.

Three independent guards against leaking a webContents, because one is not
enough for a resource the renderer asks for and the main process owns:

- The presence lease is a subscription, so an aborted stream releases it — the
  same mechanism `browser.live.presence` already relies on.
- The machine's grace timer fires on its own; nothing needs to send a close.
- Task stop reaps unconditionally.

### Chrome

`browser-panel.tsx` splits. The target-generic part — nav state sync off
`did-navigate` / `did-fail-load`, zoom, find, the load-error overlay — becomes a
`use-guest-navigation` hook plus a presentational toolbar. `TaskBrowserPanel`
keeps the session-specific parts (the `workspace.browser.open` auto-open effect,
the "Reopen browser" empty state, the URL bar).

The artifact preview gets a **narrower** toolbar, deliberately: back, forward,
reload, escape-to-root, find, zoom, open-externally, and a read-only path
readout. **No editable URL bar.** A free-form address bar would turn a preview of
the agent's output into a general-purpose browser running in a real origin, which
is a larger surface than this change is asking for.

`htmlReloadNonce` and `TaskView`'s `artifactReloadNonce` both go away, replaced
by real operations that the `WebviewElement` interface already exposes:
`reload()`, `reloadIgnoringCache()`, `goBack()`, `goForward()`, and
`loadURL(file.url)` for escape-to-root. The nonce is only deletable because
these exist — confirmed present in `browser-pool.ts`'s `WebviewElement`, and
already driven by the browser panel.

One trap: the guest must not be keyed on anything that remounts. `FileViewer` is
already remounted by key on URL change, and the slot unmounting merely parks the
guest — but the *target* has to be keyed on `(taskId, "artifact")` alone, or
every re-select pays a create.

### Policy: the artifact guest is a third caller, and the narrowest

- **`dispatch-command.ts`** is reached only over CDP from `agent-browser`, which
  derives its target id from `createTarget(id, sessionId)` and never browses
  `/json`. So nothing changes there. But the artifact target *would* be reachable:
  `listTargets(id)` returns every entry for a task, and the CDP bridge routes any
  parseable `BrowserTargetId`. **Both exclude artifact-kind targets**, so
  the agent's target list and CDP surface stay byte-for-byte what they are today.
- **`window-open-policy.ts`**: the artifact guest denies **all** window opens. The
  panel's allowance exists for OAuth sign-in popups; agent-generated HTML has no
  such need, and a real popup window spawned from a local artifact is not
  something to permit.
- **Device emulation** stays unavailable, matching the agent path.

### Security, stated as a ledger

The iframe deliberately omits `allow-same-origin`, and that opaque origin is
close to the only isolation it has left — its `sandbox` already grants scripts,
forms, modals, popups, and pointer-lock, and its `allow` list grants camera,
microphone, geolocation, clipboard, USB and more.

With a dedicated partition (Q2), the move is not the one-way loss the finding
assumed:

| | iframe today | artifact guest |
| --- | --- | --- |
| Origin | opaque | real (`assets.<taskId>.localhost`) |
| Storage / cookies | none | own partition, isolated from the browsing profile |
| Camera, mic, geolocation, USB | **granted via `allow`** | denied by the session handler |
| Scripts, forms, modals | granted | granted |
| Popups | granted | **denied** |
| Cross-task isolation | n/a | by origin — each task is its own asset host |

What is genuinely new: agent HTML can persist storage across reloads and set
cookies, both scoped to a per-task asset origin holding nothing but the task's own
files. What is genuinely removed: four device-permission grants and popups. On
balance this is a tightening, and the one-line summary in the finding ("dropping
the deliberate opaque-sandbox isolation") is true only if the partition is not
used. Use it.

The partition directory is a single shared one for all artifact guests —
`<rootDir>/<private>/artifact-preview-session` — because per-task isolation is
already supplied by the distinct asset origins.

### The modal is the only real two-guest case

`TaskFileViewerModal` is where the body-mounted guest meets a dialog, and it has
two problems that are not the same problem.

**Measurement is fine.** `use-browser-slot` reads only `getBoundingClientRect()`
and feeds those numbers to a `position: fixed` container that is appended to
`document.body`, outside `ZoomRoot`. Per
[css-zoom-rect-vs-layout-px](../../findings/css-zoom-rect-vs-layout-px.md), rects
are already in on-screen px, which is exactly the space an unzoomed fixed element
needs — and the hook's `ResizeObserver` is used as a trigger, never as a
measurement, so it never mixes the two spaces. This is why the panel is correct
at any zoom today, and it generalizes to the modal unchanged: the dialog content
applies `useAppZoomStyle` and portals to body, so its slot's rect is likewise
real px.

**Z-order is not fine, and is a certain break.** `showOverSlot` hardcodes
`zIndex: "0"`. `DialogPrimitive.Overlay` and `Content` are `z-50`. A guest shown
over a slot inside the modal paints *behind* the overlay. `showOverSlot` needs a
z-index parameter — and per [leaking-z-index-stacks](../../findings/leaking-z-index-stacks.md),
raising it has to be justified rather than bumped: the guest genuinely has to
paint above a sibling subtree it is not inside.

**Pointer events are the real unknown.** Radix's modal dialog sets
`pointer-events: none` on the body and re-enables it on the content subtree. The
guest is body-mounted and *outside* that subtree, so it may be inert to clicks
while the modal is open. `browser-panel.tsx` already had to pass `modal={false}`
to its dropdown for the mirror-image of this reason. The likely fix is a
non-modal `DialogPrimitive.Content`, which then costs the focus trap and
outside-dismiss.

And the pre-existing bug from Q1: the modal must park a *browser panel's* guest
behind it. That is a signal the panel does not currently have — opening a dialog
is not a tab switch — so `useBrowserSlot` gains a "covered by an app-wide modal"
input alongside `isActiveTab`.

### What must not regress

- **`viewMode: "raw"`.** Untouched. The `html` entry in `VIEWERS` keeps its
  `viewMode === "raw" ? renderText(context) : …` branch; only the preview arm
  changes.
- **Escape-to-root.** Strictly better: `loadURL(entry)` returns to the artifact's
  entry page from *any* depth, where the nonce could only remount `src`. True
  reload of a navigated-to sub-page becomes possible for the first time.
- **Range requests and CORS.** `assets.ts` applies Hono `cors()` on the assets
  origin regardless of who is asking, so the `Access-Control-Allow-Origin: *`
  that lets sandboxed HTML fetch its siblings is unchanged. From a real origin
  those sibling fetches become **same-origin** and need no CORS at all — strictly
  simpler than today. Range handling lives in `serveStaticFile` and is
  consumer-agnostic. Low risk, but it is the thing that would silently break
  agent-authored HTML that loads its own data, so it is on the verification list.
- **`useAutoOpenBrowserArtifact`** keys on `encodeBrowserTargetId(id,
  selectedSessionId)`, so an artifact target appearing in `navigatedTargets`
  cannot false-trigger it. Same for `create-browser-status-part.ts`.

## Rejected

- **Reusing `workspace.browser.open`.** It takes a `sessionId` because it
  registers with the session-keyed lifetime machine. Passing a fake session id to
  reach the guest pool would put artifact targets into
  `closeAgentBrowserSessionsForSessions`, i.e. fan out `agent-browser close
  --session` for a session that never existed.
- **Supervising artifact guests with `task-browser.ts`.** Wrong key, wrong
  clocks, wrong teardown. Detailed above.
- **One guest per HTML file.** Turns a browsing pattern into N webContents and
  needs a stable file-derived id (the `StoreId` schema enforces ULIDs, so this
  wants a hash, which then has to be collision-argued). One guest that navigates
  is what a browser does.
- **An editable URL bar on the preview.** Turns artifact preview into a general
  browser in a real origin.
- **The `postMessage` history bridge**, already rejected in the finding: works
  only for cooperating HTML.

## What was verified against a running Studio

Per `.agents/skills/validate-changes/SKILL.md` this is rung 4 throughout — guests,
focus, visibility and z-order are not observable from reading. Driven with an
artifact page written to exercise the specific differences: origin readout,
`localStorage`, a sibling `fetch`, and a link to a second page.

- **The premise.** The guest loads the real asset origin
  (`http://assets.<taskId>.localhost:<port>`), not an opaque one; `localStorage`
  reads and writes succeed; `fetch("data.json")` returns the sibling file. All
  three are things the opaque-origin iframe could not do. Zero iframes remain in
  the preview path.
- **Q1.** The artifact panel and browser panel are the same slot, as predicted.
- **Q2.** With a distinct `partitionDir`, the asset origin's `localStorage`
  appears only under `.instrument/artifact-preview-session`; the agent's
  `browser-session` profile has no entry for that origin at all.
- **Agent surface unchanged.** `/json?id=<taskId>` does not list the live
  artifact target, and a CDP WS upgrade for `<taskId>/artifact` is refused while
  a session-shaped id on the same bridge is still accepted.
- **The nonce replacement.** Following an in-page link moves the guest to the
  sub-page, the toolbar tracks it (back enabled, forward disabled, path readout
  updated), and escape-to-root returns to the entry page — with `localStorage`
  surviving the round trip. Home is correctly disabled at the entry page.
- **The modal.** The guest paints above the overlay at the raised z-index and
  resizes to the modal's slot, still one shared guest.
- **Pointer events, the item flagged as most likely to break: it does not.**
  Radix does set `pointer-events: none` on the body, but `showOverSlot` already
  sets `pointer-events: auto` on the guest's container, and hit testing over the
  guest with the dialog open returns the guest. No `modal={false}` workaround
  and no non-modal `Content` was needed, so the focus trap and outside-dismiss
  are kept.
- **Leaks.** Closing the panel keeps the guest through the grace period and then
  reaps it — no webContents and no CDP target afterwards. Reopening from a fully
  reaped state creates a fresh one.
- **`viewMode: "raw"`.** Shows source and parks the guest.
- **Slot tracking.** The guest's bounds match the measured slot rect exactly.

Two defects were found this way and fixed, neither visible from reading:

1. **The panel never re-claimed the guest after the expand modal closed.** Two
   slots contend for one guest; the modal's slot parks it as it unmounts, and the
   panel's own inputs never changed, so nothing re-showed it. Fixed by making
   the unraised preview `covered` while an overlay is up, so closing it flips the
   input back and the panel re-claims.
2. **Reopening a reaped preview hung on "Opening preview…".** The open call was a
   cached query, which replayed its old answer instead of asking for a new guest.
   Fixed by driving it from a mutation keyed on there being no live guest.

### Two hosts, one guest: the shape the rest of the bugs shared

Code review found four more, and three were the same mistake in different
clothes. The artifact panel and the expand modal are two mounted hosts of one
pooled guest, and anything that is *singular* — the visible slot, the Cmd+F
opener, the current page — needs to say which host owns it. Nothing about a
host's own props answers that, which is why each needed an explicit input:

- **Expanding threw the reader back to the entry page.** The modal's mount ran
  the same navigate-on-mount effect the panel does, so following a link and then
  enlarging discarded the sub-page. A host that mounts over a guest another
  preview is already showing now adopts the page on screen; every later run
  navigates as before, so go-home still works from the modal.
- **Cmd+F died after closing the modal.** The find opener is a single slot: the
  modal claimed it, cleared it on unmount, and the panel — inputs unchanged —
  never re-registered. `useBrowserFind` takes the same `covered` signal the slot
  does, so only the front-most host registers and it re-registers on the way
  back out.
- **Every backgrounded tab pinned a webContents.** Presence was leased on mount
  rather than on being the foreground tab, so the machine never left `Observed`
  and the grace period never ran. Gated on `isActiveTab`, matching the session
  browser. The open effect had to be gated too, or a reaped background tab would
  immediately re-create the guest and feed the reaper forever.

The fourth was unrelated: the preview's overflow menu had no window-blur
dismiss, so clicking into the guest left it stuck open — the browser panel had
already solved this, and the logic is now a shared `useGuestMenuState`.

All four verified in a running Studio: the sub-page survives an
expand/collapse round trip, Home still works from inside the modal, a
backgrounded tab's guest is reaped after its grace period and is *not*
re-created, and returning to the tab brings a fresh guest back.

A repo test also caught that the new toolbar's icon-only buttons carried tooltips
but no accessible name — a real gap, since the scripts that drive Studio pick
controls by name.

### What is still unverified

- **App zoom at 0.5x and 2x**, and a splitter drag at each. The slot measurement
  and per-frame tracking are unchanged by this work and shared with the browser
  panel, which is already correct at zoom; the bounds invariant was confirmed at
  1x.
- **Range requests** against a large media file referenced from artifact HTML.
  `serveStaticFile` is consumer-agnostic and untouched.
- **A physical OS-level click** inside the guest. Host-level CDP input does not
  route into a `<webview>` at all — verified by a control that failed with no
  modal open — so this was established by hit testing instead.
- **Force-quitting the renderer** mid-preview, and a task open in two tabs with
  different files selected (the known shared-guest limitation above).

## Then

`docs/findings/html-artifact-iframe-navigation.md` moves to resolved and
`docs/architecture/in-app-browser.md` gains the second target kind — including a
correction to "at most one guest is visible at a time", which is a description of
the callers rather than an invariant.
