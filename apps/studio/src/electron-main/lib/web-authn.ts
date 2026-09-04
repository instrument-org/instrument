import { APP_BUNDLE_ID } from "@instrument-org/shared";
import { app } from "electron";

import { createScopedLogger } from "./electron-logger";

const log = createScopedLogger("WebAuthn");

// The Apple Developer team the app is signed by. It prefixes the keychain access
// group because macOS enforces the group against the code signature, so the
// value has to name the team that actually signed this build.
const APPLE_TEAM_ID = "Y83DK4YU3N";

// Kept beside the runtime call, and asserted against
// build/entitlements.mac.plist by the test next to this file: the OS matches the
// two strings exactly, and a build whose entitlement says something else fails
// silently rather than loudly.
export const WEBAUTHN_KEYCHAIN_ACCESS_GROUP = `${APPLE_TEAM_ID}.${APP_BUNDLE_ID}.webauthn`;

/**
 * Turn on the macOS platform authenticator, so a passkey a site offers can be
 * created and used in the task browser.
 *
 * Electron services no platform WebAuthn request at all until this is called:
 * before it, `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`
 * resolves false and a "use your passkey" prompt goes nowhere, which is what a
 * user meets on a Google account that has one.
 *
 * What it buys, and what it does not. Credentials live in the macOS keychain,
 * bound to this device's Secure Enclave, and are never synced through iCloud. So
 * a passkey can be enrolled here after signing in another way and used from then
 * on; one that already lives on a phone or in iCloud Keychain stays out of
 * reach, because reaching it needs the cross-device QR flow Electron ships no UI
 * for. `docs/findings/what-refuses-the-task-browser.md` carries the rest of that
 * ladder.
 *
 * Electron isolates the credentials per session, by a metadata secret it
 * generates itself. That lands well here only because every task shares one
 * browser profile: a passkey enrolled during one task works in all of them.
 *
 * The access group is enforced against the code signature, so this takes effect
 * only in a build signed with the matching `keychain-access-groups` entitlement.
 * Anywhere else it is a no-op rather than an error -- an unsigned dev build
 * accepts the call and leaves `isUVPAA()` false, so nothing advertises an
 * authenticator it cannot serve.
 */
export function configurePlatformAuthenticator(): void {
  if (process.platform !== "darwin") {
    return;
  }
  try {
    app.configureWebAuthn({
      touchID: { keychainAccessGroup: WEBAUTHN_KEYCHAIN_ACCESS_GROUP },
    });
  } catch (error) {
    // Worth a line rather than a crash: without it the browser is the one that
    // shipped before this, which is a browser without passkeys and not a broken
    // one.
    log.warn("Could not enable the platform authenticator", error);
  }
}
