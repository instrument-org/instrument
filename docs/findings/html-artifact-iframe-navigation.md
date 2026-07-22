# HTML file artifacts: in-iframe link navigation can't be tracked or driven

**Status:** open — minimal reset-to-root shipped; full browser chrome deferred. Last updated 2026-07-17.

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

## What might resolve it later

Real back/forward/address chrome requires changing the primitive, not the iframe. Route HTML file artifacts through the existing `<webview>` guest pool (`apps/studio/src/client/lib/browser-pool.ts` + `apps/studio/src/electron-main/browser-view/manager.ts`) pointed at the asset URL, and reuse a generalized version of the browser panel's chrome. That pool and manager are keyed purely by an opaque `BrowserTargetId`, but target creation currently flows through `workspace.browser.open` (a task/session browsing session), so this needs a new non-session target kind plus the overlay-slot plumbing (body-mounted guest positioned over a measured slot).

Tradeoff to weigh before doing this: a `<webview>` guest loads the asset origin as a real origin with cookies/storage, dropping the deliberate opaque-sandbox isolation the iframe gives untrusted agent-generated HTML. The rejected alternative — injecting a script + `postMessage` history bridge into the HTML — was ruled out: it only works for cooperating HTML and adds fragile two-way iframe messaging.
