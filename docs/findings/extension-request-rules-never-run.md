# Extensions' request rules never run in the in-app browser

**Status:** open, checked 2026-11-27 against Electron 45.2.3's source and a probe on it (below).

An extension's `chrome.webRequest` listeners and its `declarativeNetRequest` rules do nothing in the in-app browser. An ad blocker installed from the store (uBlock Origin Lite, Ghostery, AdGuard) installs, shows its button, and blocks no requests; 1Password's own `declarativeNetRequest` ruleset is inert the same way. The install dialog still lists "Block content on the pages you open" for such an extension ([`extension-permissions.ts`](../../apps/studio/src/electron-main/browser-view/extension-permissions.ts)).

## Why

Electron chooses one request proxy per URL loader factory. In `ElectronBrowserClient::WillCreateURLLoaderFactory` (`shell/browser/electron_browser_client.cc`, around line 1696 at v45.2.3), Chromium's extension proxy, `WebRequestAPI::MaybeProxyURLLoaderFactory`, is tried only when the session's own `webRequest` has no listener. When it has one, Electron's `ProxyingURLLoaderFactory` serves the request and calls only the session's listeners; neither extension listeners nor the ruleset manager are consulted. Electron's docs describe this as its `webRequest` "taking precedence"; in practice it is all or nothing per session.

The guest session has three listeners, each doing work the browser needs:

- `onBeforeRequest`: the local-file rule ([`local-file-policy.ts`](../../apps/studio/src/electron-main/browser-view/local-file-policy.ts)), then ad blocking ([`content-blocking.ts`](../../apps/studio/src/electron-main/browser-view/content-blocking.ts)).
- `onHeadersReceived`: ad blocking's CSP filters, then the passkey `Permissions-Policy` ([`passkey-policy.ts`](../../apps/studio/src/electron-main/browser-view/passkey-policy.ts)).
- `onBeforeSendHeaders`: the client hints that go with the user agent ([`user-agent.ts`](../../apps/studio/src/electron-main/lib/user-agent.ts)).

## What it means

- Moving ad blocking into a store extension is not possible while any of these listeners stays on the guest session.

## The probe

A bare Electron 45.2.3 main process, a `session.fromPath` profile, an unpacked MV3 extension, and a page loading a script and an image the rules name:

| Session | Extension's `webRequest.onBeforeRequest` | Session and dynamic `declarativeNetRequest` rules |
| --- | --- | --- |
| No listener | fires | block (0 of 2 requests reach the server) |
| One `onBeforeSendHeaders` listener | never fires | block nothing (2 of 2 reach it) |

The manifest's `rule_resources` marked `enabled` are not enabled at load either way: `getEnabledRulesets()` answers `[]` until the extension calls `updateEnabledRulesets` itself, so an extension that relies on the manifest alone blocks nothing even on a session with no listener.
- Content scripts are unaffected, which is why cosmetic hiding and 1Password's fill work.

## What might resolve it

- Doing the three jobs some other way (a `file:` protocol handler for the local-file rule; headers set without a listener) and leaving the session's `webRequest` empty, which hands every request to Chromium's extension path, ours included only if ad blocking moves too.
- Upstream, both halves have fixes in review by the author of `electron-chrome-extensions`, each aimed at Electron 45: [electron/electron#55700](https://github.com/electron/electron/pull/55700) runs Chromium's extension proxy first and the session's listeners after it, behind a feature flag, and [electron/electron#55729](https://github.com/electron/electron/pull/55729) enables the manifest's rulesets at load. Taking the Electron release that carries both is the fix; nothing here has to move.
- Until then, the install dialog and the Extensions page say so ([`extension-support.ts`](../../apps/studio/src/electron-main/browser-view/extension-support.ts)).
