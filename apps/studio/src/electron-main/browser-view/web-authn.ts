import { APP_BUNDLE_ID } from "@instrument-org/shared";
import { app, type Session } from "electron";

import { log } from "./log";

// Baked at build time from the signing env (see electron.vite.config.ts
// `define`). `__APPLE_TEAM_ID__` is the 10-char Apple Developer team id;
// `__ENABLE_TOUCH_ID_WEBAUTHN__` is the explicit opt-in that gates the whole
// feature. Both are empty/false on dev, CI without the flag, and any build not
// signed with the matching `keychain-access-groups` entitlement -- in which
// case every guard below no-ops and the platform authenticator stays off.
declare const __APPLE_TEAM_ID__: string;
declare const __ENABLE_TOUCH_ID_WEBAUTHN__: boolean;

/**
 * Wire a browser guest session's account picker for discoverable-credential
 * requests. Fires when the Touch ID authenticator (or a roaming FIDO2 key)
 * returns more than one resident credential for a relying party; without a
 * listener the request is cancelled with `NotAllowedError`. A single account is
 * selected automatically; multiple currently pick the first, since there is no
 * in-app chooser UI yet. No-op when the platform authenticator is off.
 */
export function attachWebauthnAccountSelection(guestSession: Session): void {
  if (!keychainAccessGroup()) {
    return;
  }
  guestSession.on("select-webauthn-account", (_event, details, callback) => {
    const [first, ...rest] = details.accounts;
    if (!first) {
      // Cancel the request; nothing to select.
      callback(null);
      return;
    }
    if (rest.length > 0) {
      log.warn(
        `select-webauthn-account: ${details.accounts.length} accounts for ` +
          `${details.relyingPartyId}; auto-selecting the first`,
      );
    }
    callback(first.credentialId);
  });
}

/**
 * Enable the macOS Touch ID / Secure Enclave platform authenticator so a
 * browser guest's `navigator.credentials.create()` / `.get()` can mint and use
 * device-bound passkeys. Until this runs, `isUserVerifyingPlatformAuthenticator
 * Available()` resolves to false and platform-authenticator requests are not
 * serviced. Electron keys credentials per session/partition, so each task's
 * isolated guest profile gets its own set (see the browser-view manager).
 *
 * No-op off darwin, on unsigned/dev builds, or until the entitlement + team id
 * are in place. Call once at startup (after `app` is ready).
 */
export function configurePlatformWebAuthn(): void {
  const keychainGroup = keychainAccessGroup();
  if (!keychainGroup) {
    return;
  }
  try {
    app.configureWebAuthn({
      touchID: {
        keychainAccessGroup: keychainGroup,
        // macOS renders this as `"<App Name>" is trying to <promptReason>`;
        // `$1` is replaced with the relying party id being authenticated.
        promptReason: "sign in to $1",
      },
    });
  } catch (error) {
    // A signed build missing the matching `keychain-access-groups` entitlement
    // throws here. Log and launch unauthenticated rather than crash.
    log.error(`configureWebAuthn failed: ${String(error)}`);
  }
}

// `<TEAM_ID>.<BUNDLE_ID>.webauthn`, matching the `keychain-access-groups`
// entitlement a passkey-enabled signed build must carry (see
// build/entitlements.mac.webauthn.plist). Null unless this is a darwin build
// with the opt-in flag and a team id baked in.
function keychainAccessGroup(): null | string {
  if (
    process.platform !== "darwin" ||
    !__ENABLE_TOUCH_ID_WEBAUTHN__ ||
    !__APPLE_TEAM_ID__
  ) {
    return null;
  }
  return `${__APPLE_TEAM_ID__}.${APP_BUNDLE_ID}.webauthn`;
}
