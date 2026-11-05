# Plan: Chrome extensions in the in-app browser, starting with 1Password

Status: open. Phase 1 is built behind a flag and proved the chain inside Studio, and what is left unverified waits on a signed-in extension. A throwaway spike first proved each link separately, then the in-Studio spike proved them together (see [What the spike proved](#what-the-spike-proved)); since the plan was written the library it rests on went MIT, its author took over Electron's own extension code, and the one bug the spike hit became an upstream issue with a fix pending. [Phases](#phases) lands 1Password first and opens the store after.

## Why

The in-app browser cannot use the password manager people already have. Someone who keeps their logins in 1Password has to copy each one across by hand, and a browser that cannot fill a password is one people stop signing in to. The agent then inherits fewer signed-in sessions to work with.

Extension support is how every Chromium browser solves this, and it buys the rest of the Chrome Web Store along with it. What it does not buy is a way around 1Password's own browser allowlist: see [The one-time Add Browser step](#the-one-time-add-browser-step).

## What the user gets

1. They open the Chrome Web Store in the in-app browser and press its own install button. The store already offers it to us as a Chromium browser ("Add to <app>").
2. 1Password's button appears in the browser pane's header.
3. Once, they add Instrument under 1Password › Settings › Browser › Add Browser and approve it. Studio notices when this is needed and shows the steps.
4. From then on it behaves as it does in Chrome: unlock with Touch ID through the desktop app, fill from the field menu, no separate sign-in.

Without step 3 the extension still works, but only by signing in to the 1Password account inside it (email, Secret Key, password). That is the fallback, not the product.

## How it fits the browser

Extensions load into a session, and the in-app browser already runs on its own: every page tab and every popup a page opens share one workspace profile from `session.fromPath` in [`guest-session.ts`](../../apps/studio/src/electron-main/browser-view/guest-session.ts), while Studio's own windows run on the app session. Loading extensions on the guest session alone means:

- Content scripts match pages in the in-app browser and never Studio's UI. With `allowFileAccess` left off they also stay out of `file://` pages, so the file viewer and a page in Edit are untouched.
- `tabs` and `scripting` see only the guests we register with the library, so no extension can reach the app renderer.
- Background workers and popups run in the extension's own contexts; any tab or window an extension asks for goes through our handlers, which map it to a browser tab or refuse it.
- The user and a chat's tasks drive the same tabs, so they see the same extensions.

The scope follows the profile: an extension installed once is active in every tab in that workspace, the same way sign-ins are. The packages live beside the profile, in the workspace's machine folder (`getBrowserSessionDir` in [`chat-dir-utils.ts`](../../packages/workspace/src/lib/chat-dir-utils.ts) names the profile), since an extension's own state is in the profile already.

Where each piece attaches, read against [in-app-browser.md](../architecture/in-app-browser.md):

- **Tabs.** The guest is a renderer-owned `<webview>`, which the library's own demo browser knows as one kind of tab, finding its window through `getOwnerBrowserWindow`, so nothing here is off its path. `will-attach-webview` in [`manager.ts`](../../apps/studio/src/electron-main/browser-view/manager.ts) already sets the guest's session, and `did-attach-webview` hands us the guest contents to register with its host window; the entry's teardown unregisters it. The library is told which tab is current from the pool's `shown` report, which main keeps on the entry.
- **The session.** The library takes our session in its constructor and registers one frame preload and one service-worker preload on it, beside the one [`content-blocking.ts`](../../apps/studio/src/electron-main/browser-view/content-blocking.ts) registers and the page editor's per-guest preload. Its action UI names a session by a string, and its session resolver (`setSessionPartitionResolver`) maps a name of ours to the `fromPath` session, so nothing has to become a partition.
- **The header button.** Studio's renderer runs on the app session, where the library's browser-action preload puts a `<browser-action-list>` element and serves icons over its `crx://` protocol. That is the quickest way to a working button; the pane in [`browser-panel.tsx`](../../apps/studio/src/client/components/window/browser-panel.tsx) can replace it with a button of its own that sends the same messages once the look matters.
- **Popups.** An action's popup is a frameless child window the library sizes to the page's preferred size and places from the button's rectangle in window coordinates. Studio's UI zoom is CSS `zoom`, and element rectangles already come back in zoomed coordinates, so the popup lands under the button at any zoom. It closes on blur, and under multiple windows it parents to the window of the tab it was opened for.
- **Extension pages in the session.** A popup, an options page or a first-run page is a `chrome-extension://` contents in the guest session, which the registry in [`guest-registry.ts`](../../apps/studio/src/electron-main/browser-view/guest-registry.ts) today would file as a page's popup. They get a role of their own, so the window-open policy, the local-file rule, the passkey header and ad blocking each decide what to do with one rather than treating it as a page.
- **The agent.** The bridge in [`cdp-bridge.ts`](../../packages/workspace/src/logic/server/routes/cdp-bridge.ts) attaches the agent to a page's frames. 1Password draws its inline menu as a `chrome-extension://` iframe inside the page, which runs in its own process and so would be a frame target of its own; the bridge refuses those by scheme, so the agent cannot read or click an extension's menus. Content scripts run in isolated worlds the agent does not evaluate in.
- **Native messaging.** The library finds a host's manifest where Chrome keeps them and spawns the host as a child of the main process, which is the process 1Password's helper checks the signature of. See [The one-time Add Browser step](#the-one-time-add-browser-step).

## Building blocks

- [`electron-chrome-extensions`](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-extensions) (4.10 when checked, MIT since that release; 4.0 through 4.9 were GPL-3 with a paid license for proprietary use): `action` popups, `tabs`, `windows`, `contextMenus`, `notifications`, `webNavigation`, `cookies`, `permissions`, stand-ins for `privacy` and `downloads`, and native messaging, which finds hosts in Chrome's own manifest directories. Supports Electron 35 and later; its service-worker preload needs Chromium's sandbox on.
- [`electron-chrome-web-store`](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-web-store) (0.13 when checked, MIT): implements the store page's private install API so its own button works, keeps each extension's store ID by writing the package's public key into its manifest, checks for updates at launch and every five hours, loads what it installed on every boot, and takes an allowlist, a denylist and a `beforeInstall` hook. It reads the CRX3 header for the key but does not verify the package's signature; tighten that before the store opens past an allowlist.
- Electron's own `session.extensions.loadExtension` underneath: unpacked extensions only, persistent sessions only, reloaded on every boot. Electron itself serves `scripting`, `storage`, `webRequest`, `declarativeNetRequest`, `alarms`, most of `runtime`, part of `management` and part of `tabs`; the library fills in the rest and routes what needs a window or a tab through our handlers.
- Electron's extension code is now maintained by the library's author. A fix set that landed in October 2026 (electron/electron#55155, backported to 45 without the cookie and clipboard parts and to 46 whole; nothing of it reached 44) covers four things this plan meets: `clearStorageData` unregistering extension service workers, `chrome.alarms` not persisting across restarts, `chrome.management` missing for an extension with the `management` permission, and a service worker stopped after thirty seconds while it holds a WebSocket. A registered-tab mode is in review upstream (electron/electron#55270, aimed at 45 and 46 as well), in which only the views an app registers count as tabs and a popup never does; until then every contents in the session gets a tab id, which the library's handlers paper over.

## What 1Password needs

Read from the extension's manifest (8.12.44, MV3, minimum Chrome 140; Studio's Electron 45 is Chromium 156): a module service worker, content scripts at `document_start` on every site including one in the page's main world, a `declarativeNetRequest` ruleset, and these permissions.

| Permission | Served by |
| --- | --- |
| `scripting`, `storage`, `webRequest`, `declarativeNetRequestWithHostAccess` | Electron. |
| `alarms`, `idle` | Chromium's core extension providers, which Electron registers whole apart from `webstorePrivate`. The throwaway spike on 44.1 needed a stand-in for each to get the worker up; inside Studio on 44.9 the worker came up with neither, so no stand-in is carried. Alarms do not survive a relaunch on 44 (fixed in 45); `idle` only drives auto-lock, which the desktop app does anyway. |
| `management` | Electron, since 45; 44 refused it to an extension declaring the permission, and the worker ran fully in the spike there regardless. |
| `tabs`, `webNavigation`, `contextMenus`, `notifications`, `nativeMessaging` | The library. |
| `privacy`, `downloads` | The library's stand-ins. |
| `webRequestAuthProvider` | Nothing. Only reached for proxy sign-in. |
| `commands` (`_execute_action`, `lock`) | Nothing in the library. Studio can bind the two itself: open the popup, and tell the extension to lock. Not needed to work; needed to feel like Chrome. |

Each content script and the worker read the API through `browser` as well as `chrome`, which is the bug below.

## What the spike proved

Run against the library's demo browser on Electron 44 (Studio's major version), outside the repo:

| Link | Result |
| --- | --- |
| Store install | The store page offered "Add to <app>"; its button installed 1Password 8.12 with its store ID |
| Background worker | Died at first on `browser.windows.WINDOW_ID_NONE`. Chromium now exposes a native `browser` namespace that is a separate object from `chrome`, and the library only installs its APIs on `chrome`. Installing them on both, plus stand-ins for `alarms` and `idle`, got the worker fully up: WASM core, database, autofill rules |
| Page script | 1Password's main-world script ran in pages (`navigator.credentials` wrapped) |
| First-run page | Rendered from the toolbar button |
| Native messaging | The library launched 1Password's helper and they exchanged messages; the helper refused with `BrowserVerificationFailed` / `UnknownBrowser`, its allowlist |
| 1Password's verdict on Instrument | Launching the helper from the signed release binary (`ELECTRON_RUN_AS_NODE=1` with a script that spawns it the way the library does) got state `Untrusted`, id `com.finalpoint.instrument`. After adding Instrument.app under Add Browser, the helper accepted it and waited for the extension; plain `node` was still refused |

The `browser` namespace bug is now the library's issue #189 (it breaks uBlock Origin and every Plasmo-built extension the same way), with a one-line fix open as its pull request #190 that points `browser` at the patched `chrome`. Until it merges, Studio carries it as a patch on the package.

One unexplained event: the first install crashed the demo's main process (a null dereference in Electron with no symbols). The three boots after it were clean. Watch for it.

Then run inside Studio, behind the flag, on Electron 44.9 in a development build, with the extension installed from the store page in a browser tab:

| Link | Result |
| --- | --- |
| Store install | The store page offered "Add to Instrument"; its button installed 8.12.44 with its store ID into the folder beside the profile, and the next boot loaded it from there with the worker started |
| Background worker | Up in full with the `browser` patch alone: WASM core, database, autofill rules, no stand-in for `alarms` or `idle`, and no "not yet implemented" line from the library's stand-ins |
| Content scripts in a `<webview>` guest | A sign-in page's guest carried the isolated world named for the extension and the main-world script (`navigator.credentials.get` wrapped), so Chromium injects into guests as into any tab |
| Native messaging | The helper was reached from Studio's own main process and answered `UnknownBrowser`, as a development build is signed ad hoc |
| `chrome.tabs.create` | 1Password's welcome page opened as a tab of the window through the new-tab path a page's own links take, and the library got the guest back for it |
| The header button | `<browser-action-list>` in the address row, before Ask, drew the action, and a click reached the extension. Its icon loads over `crx://` only when the app session's handler for that scheme exists before the window's page commits, since a frame is given its loaders for custom schemes at commit, and when the scheme is in Studio's one `registerSchemesAsPrivileged` call, since the library registers it at import and the app's later call replaces the list |
| Popup, inline menu, autofill | Not reached. Before an account is signed in, 1Password's action has no popup page (a click opens its welcome tab instead) and its content script draws nothing in fields, so these wait on a signed-in extension: either the signed build below, or signing in inside the extension in the spike instance for the check alone |

The extensions come up when the browser session is first configured, which is the first browser tab, not at boot; phase 2 decides whether a workspace with an extension installed starts the session at launch.

## What is still unproven

Nothing here is a research question; each is a check with a signed-in extension or a packaged build.

- **The popup under the button and the inline menu.** Both need an account in the extension. The library sizes the popup to the page's preferred size and places it from the button's rectangle in window coordinates, which under Studio's CSS `zoom` is what `getBoundingClientRect` already reports; a check at a zoom other than 1x is still owed.
- **Ad blocking and the local-file rule around extension frames.** Neither refused the extension's own pages in the spike, but no page with an extension iframe in it (the inline menu) was reached, so the CSP filters and the local-file rule leaving `chrome-extension://` frames and resources alone is still to be seen.
- **The passkey header.** Every document gets `Permissions-Policy: publickey-credentials-get=()`. 1Password's main-world script wraps `navigator.credentials.get` and answers passkey requests itself when it has one to offer, so the header should not reach it, but a request that falls through to the native call is refused. Check with a site that has a passkey in 1Password.
- **Desktop unlock end to end.** The helper verifies the code signature of the process that launches it, which in Studio is the same signed main binary the probe ran as, so the verdict should carry over. A Developer ID build from the preview workflow, added under Add Browser, confirms it. The self-signed builds the test VMs run cannot stand in: 1Password refuses an ad-hoc signature.
- **Field autofill.** Needs the signed-in extension above.
- **The packaged preloads.** The library resolves its preload files beside its own entry, which bundling into main moves. The page editor's guest preload is already built beside main by [`electron.vite.config.ts`](../../apps/studio/electron.vite.config.ts); the library's two files go the same way, and the packaged build is where that is checked.

## The one-time Add Browser step

1Password connects only to browsers on its built-in list (Chrome, Firefox, Edge, Brave, Arc and others, each vetted by its security team) or ones the user approves under Add Browser, which takes a code-signed app. Any browser not on the list lives with this step: Zen documents it for its users, Comet users were pointed at it even after Perplexity's partnership, and ChatGPT Atlas users had it until 1Password added Atlas. Getting onto the list is a relationship with 1Password, not something to engineer around, and not worth asking for before the product has traction.

So the product carries the step, and makes it findable: the main process can launch the helper itself and read its verdict (`Untrusted` versus accepted), so Studio can tell when the 1Password extension is installed but Instrument is not approved and show the steps right then. Whether 1Password's settings take a deep link to the Browser pane is unchecked.

## Phases

1. **A spike inside Studio, behind the developer-mode features pane.** A flag in [`features.ts`](../../apps/studio/src/shared/features.ts). Add both packages; construct the library on the guest session with the session resolver; register each guest at attach and unregister it at teardown; serve the store page and let its button install; the `<browser-action-list>` element in the pane header. Carry the `browser` fix as a package patch and the `idle` stand-in beside it. Done when the worker reports itself up in Studio's logs, the button opens the popup under it, and a page shows 1Password's inline menu. This is the go or no-go on the whole plan, and it is a day of work.
2. **The product behind the flag, 1Password only.** The registry's role for extension pages and what each session policy does with it. `chrome.tabs.create` opens a tab of the window through the same path a page's new-tab open takes; `selectTab` follows the pane. The bridge refuses `chrome-extension://` frames. The `_execute_action` and `lock` shortcuts bound in Studio. Where Chromium's sandbox is off ([`chromium-sandbox.ts`](../../apps/studio/src/electron-main/lib/chromium-sandbox.ts), a Linux AppImage started with `--no-sandbox`), no service-worker preload runs and an MV3 extension cannot work, so the flag's row says extensions are unavailable there. A signed preview build, approved under Add Browser, tests desktop unlock and field autofill. The `browser` fix goes upstream.
3. **The Add Browser guidance.** Detect the untrusted state through the helper and show the steps, in the pane and on the extension's first-run page if it can be told.
4. **The store, open.** Any extension on the store installs after a sheet says what it may do, the way Chrome's does; an extension whose APIs Electron and the library do not serve installs and then half-works, so a "may not work" note on its store page only if that proves common. A place in Settings that lists what is installed, removes one and shows what the updater did. Verify the CRX3 signature before an install. Ad blockers need thought: Electron's `webRequest` wins over an extension's on the same request, and `declarativeNetRequest` is served natively, so a Lite-style blocker likely works while the built-in blocker still runs; measure before stacking two.

Electron 45 carries the fix set (alarms across relaunch, management, workers surviving a clear), so none of those needs a workaround here, and its iCloud passkeys bear on the passkey decision below.

## Risks and costs

- **Upkeep.** 1Password updates its extension often, and any release can start calling an API Electron and the library do not provide. Breakage arrives on their schedule. The library's author maintaining Electron's extension code shortens the distance between a gap and its fix, but Studio still has to take the Electron that carries it.
- **The agent and filled secrets.** The agent drives the same tabs over CDP, so it could read a filled password field or click an extension's in-page menu. Refusing extension frames in the CDP bridge covers the second; the first exists today with typed passwords and gets more common with autofill.
- **Every tab is the extension's.** An extension with `<all_urls>` sees the chat's and the tasks' tabs as well as the person's, since they are one browser. That is what Chrome does too, and for 1Password it is the point; the allowlist in phase 4 is where it is weighed per extension.
- **Passkeys.** The guest session sends `Permissions-Policy: publickey-credentials-get=(), publickey-credentials-create=()` on every document ([`passkey-policy.ts`](../../apps/studio/src/electron-main/browser-view/passkey-policy.ts)), so native WebAuthn is refused. 1Password's own passkey script answers before the native call when it has a passkey to offer, so this should not block it, but anything that falls through to the native call is refused. Decide passkeys deliberately in phase 2. Electron 45's `app.configureWebAuthn` is not a way around this for the browser: its platform passkeys serve only the domains in the app's associated-domains entitlement, each with an `apple-app-site-association` file, so it can sign a person in to Instrument's own site and nothing else; passkeys for the sites a tab visits come through the extension.
- **Unverified packages.** Until phase 4 verifies signatures, an installed package is trusted on its transport, an HTTPS download from Google's update service, and on its key matching the ID the store named. Narrow while the allowlist is one extension; not acceptable for an open store.
- **Platforms.** Everything here was checked on macOS. 1Password's Add Browser has different rules on Windows (code signed, or installed system-wide under Program Files) and a root-owned file on Linux, and a Linux install with the sandbox off has no MV3 extensions at all.

## Not doing

- **Our own runtime on Electron's native support alone.** Electron serves the page-side APIs; everything a window or a tab is involved in (`tabs`, `windows`, `action`, popups, native messaging) is what the library is, and the license reason to rewrite it is gone.
- **Signing in inside the extension as the main path.** It works without any of the allowlist work, but asking for an account password and Secret Key in a second place is the experience this exists to avoid.
- **Bundling extensions with the app.** The store installer makes it unnecessary, and redistributing 1Password's extension is not ours to do.
- **1Password's agentic autofill partnership.** It runs through this same extension, so it can follow; it is not a reason to start.
- **Asking 1Password to list Instrument.** Not until the product has the kind of traction that made them list Atlas.
- **Waiting for Electron's registered-tab mode.** It makes the library's job cleaner, not possible; the handlers cover the gap today.
