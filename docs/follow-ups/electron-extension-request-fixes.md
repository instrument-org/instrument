# Whether Electron lets extensions block requests beside the browser's own listeners

**Status:** open · **Check after:** 2026-12-18, or at the next Electron upgrade · **Last checked:** 2026-11-27

## What we're waiting to learn

An extension's `webRequest` listeners and its `declarativeNetRequest` rules never run in the in-app browser, because the guest session has `webRequest` listeners of its own and Electron then skips Chromium's extension request handling ([extension-request-rules-never-run.md](../findings/extension-request-rules-never-run.md)). Store ad blockers install and block nothing, and the install dialog says so for every extension that asks for those permissions ([`extension-support.ts`](../../apps/studio/src/electron-main/browser-view/extension-support.ts)).

Two open Electron pull requests fix it, both by the author of `electron-chrome-extensions` and both aimed at Electron 45: electron/electron#55700 runs the extension proxy first and the session's listeners after it, behind a feature flag (`ExtensionsAlongsideWebRequest`), and electron/electron#55729 enables the rulesets an extension's manifest marks enabled when it loads. Nothing here moves while we wait; the browser's own listeners stay.

## The signal

- #55700 merged and in an Electron 45 or 46 release: its release notes name it, and the feature flag exists.
- #55729 merged and released.
- Neither: both still open.

## Where to look

The two pull requests on GitHub, and the release notes of the Electron line the app is on (`apps/studio/package.json`).

## What each answer means

- **#55700 ships:** take that Electron, turn the flag on for the guest session, and repeat the probe in the finding with the guest session's three listeners in place: an extension's `onBeforeRequest` should fire and its session rules block. Then drop `Blocking content on pages` and `Seeing what pages load` from `extension-support.ts`, check uBlock Origin Lite blocks beside the built-in blocker on a page with ads, and close the finding.
- **Only #55729 ships:** take it; nothing visible changes until #55700 does, since the rules still never run.
- **Neither:** move the date.

## Result

Not checked yet.
