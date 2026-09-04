import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { WEBAUTHN_KEYCHAIN_ACCESS_GROUP } from "./web-authn";

// macOS matches the group the app asks for against the one its signature grants,
// exactly, and a mismatch does not fail loudly: the authenticator simply never
// appears, which looks identical to not having configured one. So the two
// strings are asserted equal here rather than left to a beta to discover.
describe("the WebAuthn keychain access group", () => {
  const entitlements = fs.readFileSync(
    path.join(import.meta.dirname, "../../../build/entitlements.mac.plist"),
    "utf8",
  );

  it("is the one the signed build's entitlement grants", () => {
    expect(entitlements).toContain(
      `<string>${WEBAUTHN_KEYCHAIN_ACCESS_GROUP}</string>`,
    );
  });

  it("is prefixed by the team the app is signed by", () => {
    expect(WEBAUTHN_KEYCHAIN_ACCESS_GROUP).toMatchInlineSnapshot(
      `"Y83DK4YU3N.com.finalpoint.instrument.webauthn"`,
    );
  });

  // codesign takes the plist literally, so an Xcode build-setting placeholder
  // would be signed in as the string it looks like and grant nothing.
  it("carries no unexpanded build-setting placeholder", () => {
    expect(entitlements).not.toMatch(/<string>\$\([^)]+\)/);
  });
});
