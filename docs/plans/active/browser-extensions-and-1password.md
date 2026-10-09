# Plan: Chrome extensions in the in-app browser, starting with 1Password

Status: on hold, not started. A throwaway spike proved each link of the chain separately (see [What the spike proved](#what-the-spike-proved)); nothing is built in Studio. Pick it up when the in-app browser's lack of a password manager starts costing users, or when extension support is wanted for its own sake.

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

Extensions load into a session, and the in-app browser already runs on its own: every page tab and every popup a page opens share one workspace profile from `session.fromPath` in `apps/studio/src/electron-main/browser-view/guest-session.ts`, while Studio's own windows run on `session.defaultSession`. Loading extensions on the guest session alone means:

- Content scripts match pages in the in-app browser and never Studio's UI.
- `tabs` and `scripting` see only the guest contents we register with the extension library, so no extension can reach the app renderer.
- Background workers and popups run in the extension's own contexts; any tab or window an extension asks for goes through our handlers, which map it to a browser tab or refuse it.
- The user and a chat's tasks drive the same tabs, so they see the same extensions.

The scope follows the profile: an extension installed once is active in every tab in that workspace, the same way sign-ins are.

## Building blocks

- [`electron-chrome-extensions`](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-extensions) (4.9 when checked): `action` popups, `tabs`, `windows`, `contextMenus`, `notifications`, `webNavigation`, `commands`, `cookies`, stand-ins for `privacy` and `downloads`, and native messaging, which finds hosts in Chrome's own manifest directories. Supports Electron 35 and later.
- [`electron-chrome-web-store`](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-web-store) (0.13 when checked): implements the store page's private install API so its own button works, keeps each extension's store ID by writing the package's public key into its manifest, checks for updates every five hours, and takes an allowlist and a `beforeInstall` hook. It checks that the package's key matches its ID but does not verify the package signature; tighten that before shipping.
- Electron's own `session.extensions.loadExtension` underneath: unpacked extensions only, persistent sessions only, reloaded on every boot.

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

Not proven: all of it running together inside Studio, field autofill (it needs a signed-in extension), and desktop unlock end to end in a signed Studio build. The helper verifies the code signature of the process that launches it, which in Studio is the same signed main binary the probe ran as, so the verdict should carry over; the signed build is what confirms it.

One unexplained event: the first install crashed the demo's main process (a null dereference in Electron with no symbols). The three boots after it were clean. Watch for it.

## The one-time Add Browser step

1Password connects only to browsers on its built-in list (Chrome, Firefox, Edge, Brave, Arc and others, each vetted by its security team) or ones the user approves under Add Browser, which takes a code-signed app. Any browser not on the list lives with this step: Zen documents it for its users, Comet users were pointed at it even after Perplexity's partnership, and ChatGPT Atlas users had it until 1Password added Atlas in late 2025. Getting onto the list is a relationship with 1Password, not something to engineer around, and not worth asking for before the product has traction.

So the product carries the step, and makes it findable: the main process can launch the helper itself and read its verdict (`Untrusted` versus accepted), so Studio can tell when the 1Password extension is installed but Instrument is not approved and show the steps right then. Whether 1Password's settings take a deep link to the Browser pane is unchecked.

## Phases

1. **Behind a flag, 1Password only.** Install the library and the store installer on the guest session only. Register every pool guest with the library. A button in the browser pane's header for extension actions and popups. The `browser`-namespace fix and the `alarms` and `idle` stand-ins, upstream to the library where they belong. The CDP bridge refuses `chrome-extension://` targets and frames, so the agent cannot drive 1Password's menus or read its pages. A signed one-off build from CI, approved under Add Browser, tests desktop unlock and field autofill.
2. **The Add Browser guidance.** Detect the untrusted state through the helper and show the steps.
3. **Open the store, or curate it.** Either any MV3 extension with a "may not work" note, or an allowlist that grows as extensions are checked. Ad blockers need thought either way: Electron allows one `onBeforeRequest` listener per session, and the built-in blocker and the local-file policy already share it.

## Risks and costs

- **License.** `electron-chrome-extensions` is GPL-3 unless bought under its Patron license (a GitHub Sponsors tier, or a proprietary-use license from the author). The store installer is MIT. Shipping needs the Patron license.
- **Upkeep.** 1Password updates its extension often, and any release can start calling an API Electron and the library do not provide. Breakage arrives on their schedule.
- **The agent and filled secrets.** The agent drives the same tabs over CDP, so it could read a filled password field or click an extension's in-page menu. Refusing extension targets in the CDP bridge covers the second; the first exists today with typed passwords and gets more common with autofill.
- **Passkeys.** The guest session sends `Permissions-Policy: publickey-credentials-get=(), publickey-credentials-create=()` on every document (`passkey-policy.ts`), so native WebAuthn is refused. 1Password's own passkey script answers before the native call when it has a passkey to offer, so this should not block it, but anything that falls through to the native call is refused. Decide passkeys deliberately when this is picked up.
- **Platforms.** Everything here was checked on macOS. 1Password's Add Browser has different rules on Windows (code signed, or installed system-wide under Program Files) and a root-owned file on Linux.

## Not doing

- **Signing in inside the extension as the main path.** It works without any of the allowlist work, but asking for an account password and Secret Key in a second place is the experience this exists to avoid.
- **Bundling extensions with the app.** The store installer makes it unnecessary, and redistributing 1Password's extension is not ours to do.
- **1Password's agentic autofill partnership.** It runs through this same extension, so it can follow; it is not a reason to start.
- **Asking 1Password to list Instrument.** Not until the product has the kind of traction that made them list Atlas.
