**Status:** fixed and measured, 2026-09-21. In-app CDP bridge (`packages/workspace/src/logic/server/routes/cdp-bridge.ts`), against agent-browser 0.38.1.

# `agent-browser open` returned before the page had loaded

Through the in-app browser, `agent-browser open <url>` returned while the document was still `loading`, so the read one step later saw an empty page. A real session hit this on every Amazon product page: `open` then `get text body` came back as inline `<script>`, nothing, or `Element not found: body`, and the model recovered only by reading a second time. Twelve of twelve `/dp/` opens in that transcript raced. It is not Amazon-specific; any page whose document keeps parsing past the navigation commit is exposed.

## What was happening

`open` awaits the `Page.navigate` response and returns on it. Electron answers `Page.navigate` the moment the load is *committed* (a `loaderId` is issued), long before the document parses. agent-browser is built to then block for the load event, but through our bridge it did not: measured, `open` returned in the same millisecond `Page.navigate` resolved, with no `Page.loadEventFired` of any kind sent in between. The same `open` against real Chrome over CDP waits and returns `complete`, so the gap is specific to how the bridge drives agent-browser, not to agent-browser itself.

The bridge already synthesized `Page.loadEventFired` (Electron's debugger emits none natively) from `Page.frameStoppedLoading` for **any** frame. An Amazon listing carries a dozen ad iframes, some still finishing the page being left when the navigate is issued, so an early iframe stop produced a load event on a document whose `<title>` had not parsed. Narrowing that synthesis to the main frame alone was necessary but not sufficient: `open` still returned early, because it was not blocking on the load event through the bridge at all.

## The fix

The bridge holds the `Page.navigate` response until the main frame's own `Page.frameStoppedLoading`, capped at 20s (under agent-browser's 30s per-command timeout, with margin). Since `open` awaits that response, holding it is what makes `open` return only once the document has loaded, independent of agent-browser's own lifecycle logic. The main frame is the one whose `Page.frameNavigated` carries no `parentId`; its id holds across navigations. A same-document navigation (a hash change) carries no `loaderId` and fires no load, so it is not held. `createMainFrameLoadGate` isolates the frame tracking and the hold, unit-tested in `cdp-bridge.test.ts`; the end-to-end behavior was measured against five real product pages, each now `complete` with its `productTitle` present on the first read.

## What is left

- The cap is a safety valve, not a wait strategy: a page that never fires a main-frame load returns at 20s with whatever had rendered. The agent can still `wait` or re-read; the alternative (holding to agent-browser's own 30s) trades that for a hard command-timeout error.
- The root reason agent-browser's post-navigate load wait is a no-op through the bridge was not run to ground (the deserialized `loaderId` is present, so the wait branch should run). The hold makes it moot, but if a future agent-browser change starts double-waiting, revisit: it would then wait for a second load event the held navigate already consumed. The synthesized load event still fires, so a buffered one satisfies that wait promptly in practice.
- Reproduce the bridged-vs-direct difference with the `studio-drive.mjs bash` recipe in the `studio-chrome-devtools` skill: `agent-browser open <dp-url>` then `agent-browser eval 'document.readyState'`.
