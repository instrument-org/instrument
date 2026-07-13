# Passkeys (Touch ID WebAuthn) in the in-app browser

Goal: let a user completing a login inside a browser guest authenticate with a
passkey, using the macOS Touch ID / Secure Enclave platform authenticator.

## What's implemented (inert until enabled)

Runtime wiring is in place and gated behind an explicit opt-in, so dev, CI, and
existing signed releases are unchanged until the flag is set:

- `apps/studio/src/electron-main/browser-view/web-authn.ts`
  - `configurePlatformWebAuthn()` -> `app.configureWebAuthn({ touchID })` on
    darwin. Until called, `isUserVerifyingPlatformAuthenticatorAvailable()` is
    `false` and platform requests are unserviced.
  - `attachWebauthnAccountSelection(session)` -> handles the `select-webauthn-
account` session event (multiple resident credentials). Single account auto-
    selects; multiple pick the first (no chooser UI yet).
- Called from `index.ts` (startup) and `manager.ts` `sessionForEntry` (per guest
  session).
- Team id + opt-in baked at build time via `electron.vite.config.ts` `define`
  (`__APPLE_TEAM_ID__`, `__ENABLE_TOUCH_ID_WEBAUTHN__`).
- `apps/studio/build/entitlements.mac.webauthn.plist` — template entitlements
  (base hardened-runtime flags + `keychain-access-groups`), NOT wired into
  electron-builder.

## To enable (external steps, cannot be done/tested from source alone)

1. Apple Developer portal: add the **Keychain Sharing** capability to the
   `com.finalpoint.instrument` App ID and generate a matching **provisioning
   profile**. Signing a `keychain-access-groups` a profile doesn't authorize
   fails.
2. Fill the real team id into `entitlements.mac.webauthn.plist` (replace
   `TEAMID`), or generate it from `$APPLE_TEAM_ID` at build time.
3. Point `mac.entitlements` **and** `mac.entitlementsInherit` at that file in
   `electron-builder.ts` (embed the provisioning profile alongside).
4. Build env: `ENABLE_TOUCH_ID_WEBAUTHN=true` and `APPLE_TEAM_ID=<team id>`.
5. Test on a **signed** build (unsigned/dev can't carry the entitlement).

## Caveats / scope

- **Device-bound, not iCloud-synced.** Credentials live in this Mac's Secure
  Enclave; they don't sync and aren't visible to iCloud Keychain or other Macs.
  Apple silicon / T2 only.
- **Per-session isolation.** Electron keys credentials per partition, so a
  passkey registered in one task's guest is not visible in another. Matches the
  per-task browser model; may surprise users who expect one shared passkey.
- **Secure context required.** `navigator.credentials.*` throws on non-HTTPS
  origins.
- **Human-vs-agent browsing.** Guests currently block popups
  (`setWindowOpenHandler` deny) and deny all permissions; many interactive
  logins (OAuth) need popups. A human-login mode likely needs a distinct guest
  profile. Out of scope here.
- **No iCloud / third-party (1Password) passkeys.** Reaching the system passkey
  provider needs the Apple-approval-gated `com.apple.developer.web-browser.
public-key-credential` entitlement (real browsers only). Not pursued.
- USB/NFC security keys are a separate path (need a native module on macOS); not
  covered here.

## Password managers (for reference, not implemented)

- **1Password:** cannot integrate in an embedded Electron browser — Electron
  doesn't expose `chrome.nativeMessaging`, and 1Password enforces a signed-
  browser allowlist it won't extend. Fallback is the `op` CLI (copy/paste).
- **Bitwarden:** the only plausible embed (self-contained, MV3) via
  `session.loadExtension` + the `electron-chrome-extensions` shim. Unverified on
  Electron 42; needs empirical testing.
- Extensions can't serve passkeys in Electron (`chrome.webAuthenticationProxy`
  is unsupported), so passkeys must come from the OS authenticator above.
