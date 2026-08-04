# HTML file artifacts: in-iframe link navigation can't be tracked or driven

**Status:** resolved — HTML artifacts render in a `<webview>` guest, which has real navigation. Last updated 2026-08-03.

## Symptom

An HTML file artifact opened in the file viewer rendered in a sandboxed `<iframe>`. If the HTML contained a link and the user clicked it, the iframe navigated to another page in place. There was no back/forward/reload chrome, and re-selecting the same artifact in the sidebar did nothing (the router navigates to an identical search state, a no-op), so the user was stranded on the linked page with no way back to the artifact's entry page.

## Root cause

The iframe's `src` is a per-task asset origin (`http://assets.<taskId>.localhost:<port>/…`), served by the workspace Hono server. Two properties made real browser chrome impossible from the parent:

1. **Cross-origin.** The renderer and the asset origin differ by subdomain and port, so the parent can't touch `contentWindow`.
2. **Opaque origin.** The permissive sandbox omitted `allow-same-origin` on purpose (untrusted agent-generated HTML), so the frame was a unique opaque origin.

Together these meant the parent could not read `contentWindow.location`, could not call `history.back()`/`forward()` on it (not on the cross-origin allowlist), and could not observe where in-iframe links led. Load events fired but exposed no URL. So `canGoBack`/`canGoForward`/current-URL — everything real browser chrome needs — was unreadable.

## Resolution

The primitive changed. HTML artifacts now render through the same `<webview>` guest pool the agent browser uses (`apps/studio/src/client/components/html-artifact-preview.tsx`), pointed at the same asset URL. A guest's `goBack()` / `goForward()` / `getURL()` / navigation events are all available, so the preview has real back, forward, reload, hard reload, find-in-page, zoom, and a return-to-entry-page control, plus a read-only path readout. Both reload nonces are gone: escaping a link navigation is now `loadURL(entryUrl)`, which works from any depth, and reloading a navigated-to sub-page is possible for the first time.

The guest is a second target kind, `${taskId}/artifact` (see `BrowserTargetIdSchema`), with its own RPC (`workspace.artifactPreview`), its own lifetime machine (`machines/artifact-preview.ts`: a presence lease plus a 30s grace period), and its own storage profile. It is excluded from `listTargets` and refused by the CDP bridge, so the agent's target list and CDP surface are unchanged.

### The tradeoff resolved the other way

The concern recorded here was that a guest "drops the deliberate opaque-sandbox isolation". Measured against what the iframe actually granted, the move is a net tightening:

| | iframe (before) | artifact guest (now) |
| --- | --- | --- |
| Origin | opaque | real (`assets.<taskId>.localhost`) |
| Storage / cookies | none | own profile, isolated from the browsing profile |
| Camera, mic, geolocation, USB | **granted via `allow`** | denied by the session permission handler |
| Popups | granted | **denied** (`target=_blank` still opens in the OS browser) |
| Cross-task isolation | n/a | by origin *and* by a storage profile per task |

The iframe's `sandbox` already granted scripts, forms, modals, popups and pointer-lock, and its `allow` list granted camera, microphone, geolocation, clipboard, display-capture, MIDI, payment and USB. What is genuinely new is that agent HTML can persist storage and set cookies, scoped to a per-task asset origin holding nothing but that task's own files, in a profile (`<rootDir>/<private>/artifact-preview-session/<taskId>`) separate both from the agent's browsing profile and from every other task's preview. Verified against a running Studio: the asset origin's `localStorage` is written only into that profile and is absent from `browser-session`.

The profile is per task rather than one shared directory because origin is not enough on its own: `localStorage` and IndexedDB are keyed by origin, but cookies are scoped by domain, so a page on `assets.<a>.localhost` could set one for `localhost` and reach another task's preview through a shared jar.

### Why this was worth doing beyond the chrome

The agent and the user load the same URL. Rendering them on different primitives meant everything origin-scoped behaved differently between the surface the agent screenshots to check its own work and the surface the user reads: `localStorage`, cookies, IndexedDB, and same-origin `fetch` of a sibling file. Agent-authored HTML that persists a filter selection, or reads its own `data.json`, could pass the agent's check and fail in front of the user. Both now render as a real origin through the identical Chromium path.

Sibling fetches are now **same-origin** and need no CORS. The `cors()` on the assets origin remains for other consumers.

### What the guest had to keep doing

Two things a report can ordinarily do worked on the iframe by inheriting the host page's behavior, and had to be restored explicitly rather than falling out of the guest's stricter defaults:

- **`target="_blank"` links.** In the iframe these bubbled to the main window's `setWindowOpenHandler`, which sends them to the OS browser. An artifact guest opens no child window, but it hands http(s) opens to `openExternal` instead of refusing them, or an ordinary external link in a generated report would be silently dead — there is no address bar to follow it from.
- **Downloads.** The iframe carried `allow-downloads`. The guest session cancels any download without an agent-authorized path, which is right for an agent-driven guest and wrong for a preview, so an artifact guest lets Electron prompt for a location. A "Download CSV" button in a report keeps working.

## Rejected alternative

Injecting a script + `postMessage` history bridge into the HTML: works only for cooperating HTML and adds fragile two-way iframe messaging.
