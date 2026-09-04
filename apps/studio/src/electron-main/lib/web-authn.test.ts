import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { WEBAUTHN_KEYCHAIN_ACCESS_GROUP } from "./web-authn";

// macOS matches the group the app asks for against the one its signature grants,
// exactly, and a mismatch does not fail loudly: the authenticator simply never
// appears, which looks identical to not having configured one. So the two
// strings are asserted equal here rather than left to a beta to discover.
const buildDir = path.join(import.meta.dirname, "../../../build");
const read = (name: string) =>
  fs.readFileSync(path.join(buildDir, name), "utf8");

describe("the WebAuthn keychain access group", () => {
  const entitlements = read("entitlements.mac.plist");

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

// The helpers are signed against their own entitlements, so an app-scoped key
// inherited down to them is refused on the helper's signature -- and what a
// user sees is the whole app failing to launch. This is the regression that
// shipped: one file served as both, because naming only entitlementsInherit
// left electron-builder defaulting the app's entitlements to the same path.
describe("the helper entitlements", () => {
  const inherited = read("entitlements.mac.inherit.plist");

  it.each(["keychain-access-groups", "com.apple.application-identifier"])(
    "does not inherit %s, which belongs to the app alone",
    (key) => {
      expect(inherited).not.toContain(key);
    },
  );

  it("still carries what the Chromium runtime needs", () => {
    expect(inherited).toContain("com.apple.security.cs.allow-jit");
    expect(inherited).toContain(
      "com.apple.security.cs.disable-library-validation",
    );
  });
});
