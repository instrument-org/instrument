# HTML file artifacts: in-iframe link navigation can't be tracked or driven

**Status:** resolved — HTML artifacts render in a `<webview>` guest, which has real navigation. Last updated 2026-08-04.

## Symptom

An HTML file artifact opened in the file viewer renders in a sandboxed `<iframe>` (`apps/studio/src/client/components/sandboxed-html-iframe.tsx`). If the HTML contains a link and the user clicks it, the iframe navigates to another page in place. There is no back/forward/reload chrome, and re-selecting the same artifact in the sidebar does nothing (the router navigates to an identical search state, a no-op), so the user is stranded on the linked page with no way back to the artifact's entry page.

## Root cause

The iframe's `src` is a per-task asset origin (`http://assets.<taskId>.localhost:<port>/…`), served by the workspace Hono server. Two properties make real browser chrome impossible from the parent:

1. **Cross-origin.** The renderer and the asset origin differ by subdomain and port, so the parent can't touch `contentWindow`.
2. **Opaque origin.** The permissive sandbox omits `allow-same-origin` on purpose (untrusted agent-generated HTML), so the frame is a unique opaque origin.

Together these mean the parent cannot read `contentWindow.location`, cannot call `history.back()`/`forward()` on it (not on the cross-origin allowlist), and cannot observe where in-iframe links lead. Load events fire but expose no URL. So `canGoBack`/`canGoForward`/current-URL — everything real browser chrome needs — is unreadable.

The separate agent browser panel (`apps/studio/src/client/components/task/browser-panel.tsx`) has full chrome only because it wraps an Electron `<webview>` guest, whose `goBack()` / `goForward()` / `getURL()` / navigation events are all available. A plain iframe has none of that.

## Current behavior (fix)

Escape-to-root only, via remounting the iframe so it reloads `src` (the entry page) — the one operation that works despite the opaque cross-origin sandbox:

- A **Reload** button in the file-viewer header, shown for HTML preview only, bumps a local key on the iframe. See `apps/studio/src/client/components/file-viewer.tsx`.
- Re-selecting the already-open artifact in the sidebar bumps a nonce folded into the `FileViewer` key. See `apps/studio/src/client/components/task/view.tsx`.

Both snap the preview back to the artifact's entry page. Note this reloads `src`, not the navigated-away sub-page — the sub-page URL is unreadable cross-origin, so true reload/back of a sub-page isn't possible here.

## Resolution

The primitive changed. HTML artifacts render through the same `<webview>` guest pool the agent browser uses ([`html-artifact-preview.tsx`](../../apps/studio/src/client/components/html-artifact-preview.tsx)), pointed at the same asset URL. A guest's `goBack()` / `goForward()` / `getURL()` / navigation events are all available, so the preview has real back, forward, reload, hard reload, find-in-page, zoom, and a return-to-entry-page control, plus a read-only path readout. Both reload nonces are gone: escaping a link navigation is `loadURL(entryUrl)` from any depth, and reloading a navigated-to sub-page works for the first time.

The guest is a second target kind, `${taskId}/artifact` (see `BrowserTargetIdSchema`), created through its own `workspace.artifactPreview.open` rather than `browser.open`, which is session-keyed. It is excluded from `listTargets` and refused by the CDP bridge, so the agent's target list and CDP surface are unchanged.

**No lifetime machine.** The target id is derived from the task id, so `trash-task` closes it and removes its profile without any registry, and the app's own teardown takes the rest. One webContents per task whose HTML artifact you opened, for the life of the task. An earlier attempt supervised these with a presence lease and a grace period; it cost an XState machine, its tests, and a family of teardown races, for a resource that is already bounded by the number of tasks you open an artifact in.

**One host, deliberately.** `FileViewer` withholds Expand for HTML files. Two hosts sharing one guest have to agree on which file is on screen, who owns Cmd+F, and which may paint — none of which a viewer can answer from its own props. The artifact panel already gives an artifact the full pane, so the affordance is withheld rather than arbitrated.

### The tradeoff resolved the other way

The concern recorded here was that a guest "drops the deliberate opaque-sandbox isolation". Measured against what the iframe actually granted, the move is a net tightening:

| | iframe (before) | artifact guest (now) |
| --- | --- | --- |
| Origin | opaque | real (`assets.<taskId>.localhost`) |
| Storage / cookies | none | own profile, isolated from the browsing profile |
| Camera, mic, geolocation, USB | **granted via `allow`** | denied by the session permission handler |
| Popups | granted | **denied** (`target=_blank` still opens in the OS browser) |
| Cross-task isolation | n/a | by origin *and* by a storage profile per task |

The iframe's `sandbox` already granted scripts, forms, modals, popups and pointer-lock, and its `allow` list granted camera, microphone, geolocation, clipboard, display-capture, MIDI, payment and USB. What is new is that agent HTML can persist storage and set cookies, scoped to a per-task asset origin holding nothing but that task's own files, in a profile (`<rootDir>/<private>/artifact-preview-session/<taskId>`) separate both from the agent's browsing profile and from every other task's preview.

Per task rather than one shared directory because origin is not enough on its own: `localStorage` and IndexedDB are keyed by origin, but cookies are scoped by domain, so a page on `assets.<a>.localhost` could set one for `localhost` and reach another task's preview through a shared jar.

### What the guest had to keep doing

Two things a report can ordinarily do worked on the iframe by inheriting the host page's behavior, and had to be restored rather than falling out of the guest's stricter defaults:

- **`target="_blank"` links.** In the iframe these bubbled to the main window's `setWindowOpenHandler`, which sends them to the OS browser. An artifact guest opens no child window, but hands http(s) opens to `openExternal` — otherwise an ordinary external link in a report is silently dead, with no address bar to follow it from.
- **Downloads.** The iframe carried `allow-downloads`. The guest session cancels any download without an agent-authorized path, which is right for an agent-driven guest and wrong for a preview, so an artifact guest lets Electron prompt.

### Why this was worth doing beyond the chrome

The agent and the user load the same URL. Rendering them on different primitives meant everything origin-scoped behaved differently between the surface the agent screenshots to check its own work and the surface the user reads: `localStorage`, cookies, IndexedDB, and same-origin `fetch` of a sibling file. Agent-authored HTML that persists a filter selection, or reads its own `data.json`, could pass the agent's check and fail in front of the user. Both now render as a real origin through the identical Chromium path. Sibling fetches are same-origin and need no CORS; the `cors()` on the assets origin remains for other consumers.

## Rejected alternative

Injecting a script + `postMessage` history bridge into the HTML: works only for cooperating HTML and adds fragile two-way iframe messaging.
