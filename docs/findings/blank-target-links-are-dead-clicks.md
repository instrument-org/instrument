# `target=_blank` links are dead clicks

**Status:** Fixed 2026-08-28 — a denied tab-open now navigates the guest that asked for it, and the guest's context menu offers "Open Link". Real popups are unchanged.

Clicking a link that opens in a new tab did nothing at all in the in-app browser. No navigation, no tab, no window, no message. Reported from a shopping session: on the Amazon cart, the product title in each row would not open, while the Amazon logo in the corner worked — which reads as "the browser is broken on some links and fine on others" and gives the user nothing to act on.

## Why

The cart title is `<a target="_blank" rel="noopener">`. Chromium reports that click to Electron as disposition `foreground-tab`, and [`window-open-policy.ts`](../../apps/studio/src/electron-main/browser-view/window-open-policy.ts) allowed only `new-window`:

```ts
if (details.disposition !== "new-window") {
  return { action: "deny" };
}
```

`setWindowOpenHandler` runs **before** Chromium mints a WebContents, so a denial is not a tab that opened somewhere unreachable — it is a navigation that never started. Nothing to focus, nothing to expose, nothing to close. The Amazon logo is a plain same-tab link, so it never reaches the handler and navigates normally.

That policy came in with `77ee91e58` (`studio: allow user-driven sign-in popups in agent browser guests`, FP-1201), which carved real `window.open` popups out of a guest that previously blocked *every* open. `_blank` was left denied because there was no second tab to put it in — correct as far as it went, but it left the click with no outcome and no signal.

The agent hits the same wall from the other side, and worse. Its CDP connection is pinned to one page ([cdp-bridge](../../packages/workspace/src/logic/server/routes/cdp-bridge.ts)), and [`manager.ts`](../../apps/studio/src/electron-main/browser-view/manager.ts) denied every open while `focusGuard.isGuarded`, so `agent-browser click` on a `_blank` link returned `✓ Done` with the page unmoved. In the reported session the model read that as a harness bug and spent a turn theorizing about tabs it could not see, when the reachable move was to read the `href` and `open` it.

## What it does now

A denied open whose disposition is `foreground-tab` or `background-tab` and whose URL is http(s) navigates the guest in place, deferred out of the handler with `setImmediate` because it runs inside Chromium's decision for that navigation. A guest holds one page, so the honest reading of "open this somewhere else" is "open it here" — for a `_blank` link and equally for the cmd- or middle-click that asked for a tab behind this one. Neither can be honored as asked until a guest can hold more than one page, and landing them here beats dropping them.

Two things follow from where the fallback sits:

- **The guard withholds a window, not a navigation.** It runs even while the guest is agent-guarded. `new-window` opens stay fully denied there, so automation still cannot spawn a window nobody asked for, but a `_blank` link becomes reachable to the agent for the first time — its CDP connection is pinned to one page, so before this the link was unreachable except by reading the `href` out of the DOM and navigating by hand.
- **Non-http(s) targets stay denied**, unchanged.

The guest's context menu now carries "Open Link" above "Copy Link" ([`guest-interactions.ts`](../../apps/studio/src/electron-main/browser-view/guest-interactions.ts)), shown for http(s) links only. It is the manual path for anything the policy still declines, and the only path for a link that opens no tab at all.

A hostile page can now move the guest by calling `window.open(url, "_blank")` without a gesture, where before it was denied. That is not new capability: the same page can set `location.href` with no gesture at all.

Verified live against a booted instance: a scripted `target="_blank" rel="noopener"` click inside a guest at `https://example.com/` left it at `https://example.com/blank-target-probe`, and a real middle-click on a plain link took the guest to that link's target. Dispositions and URL shapes are covered in [`window-open-policy.test.ts`](../../apps/studio/src/electron-main/browser-view/window-open-policy.test.ts); the agent-guarded path and the menu item have no test.

## What is still missing

Nothing about this is what a tab-open *asked for*. The real fix is [browser popups as agent-drivable tabs](../plans/active/browser-popups-as-agent-drivable-tabs.md), where a `_blank` link, a middle-click, and a sign-in popup all become tabs both the user and the agent can reach; the fallback here is what a one-page guest can do in the meantime, and it should give way to real tabs rather than survive alongside them. That plan is written around sign-in popups — this finding is the evidence that ordinary links are the more common way a user meets the gap, and they meet it silently.

## Related

- [in-app-browser.md](../architecture/in-app-browser.md) — the popup shape policy and where the guest lives.
- [App reload destroys every task browser](app-reload-destroys-the-task-browser.md) — the other way a browser action produces a surprising nothing.
