# An entitlement that signs, notarizes, and will not launch

**Status:** resolved, and the capability is reachable. Backed out of the shipped build; what it needs to go back in is below. Found 2026-09-04 on macOS 26.6, `v1.6.14-beta.1`.

Adding `keychain-access-groups` to the macOS entitlements to enable Electron's Touch ID platform authenticator produced a build that passed every gate and then would not start. The update installed, the app quit to relaunch, and nothing came back.

## What the failure looks like

Nothing that points at an entitlement.

- `codesign --verify --deep --strict` says **valid on disk**, satisfies its Designated Requirement.
- `spctl -a -t exec` says **accepted**, `source=Notarized Developer ID`.
- The updater log ends normally at `Quit teardown`, and Squirrel's `ShipIt_stderr.log` reports `Installation completed successfully`, `On main thread and launching`, then exits status 0. Nothing in either log is an error.
- There is **no crash report**, because nothing ever executes. No process is created, so there is nothing to crash.

The only direct symptom comes from launching by hand:

```
The application ... cannot be opened for an unexpected reason,
error=Error Domain=RBSRequestErrorDomain Code=5 "Launch failed."
NSUnderlyingError=... Code=163 "Launchd job spawn failed"
```

`launchd` refuses to spawn a binary whose entitlements the system will not grant. Signature validity and notarization do not cover that: the first says the bits are intact and signed by who they claim, the second says Apple scanned them. Neither asks whether this app is *allowed* the entitlements it carries.

## Why it was refused

`keychain-access-groups` is team-scoped, and the system will not take an app's word for its own team prefix. It has to be granted by an **embedded provisioning profile**, and there was none.

A shipping Developer ID app with working passkeys shows the whole shape. Its `Contents/embedded.provisionprofile` carries an Entitlements dictionary granting exactly the keys the binary claims:

```
"com.apple.application-identifier" => "<TEAM>.<bundle id>"
"com.apple.developer.team-identifier" => "<TEAM>"
"keychain-access-groups" => [ "<TEAM>.*" ]
```

Its helper processes carry none of them. Ours carried the entitlement on **every** helper, because `electron-builder.ts` sets only `entitlementsInherit`, and electron-builder's `mac.entitlements` defaults to the same conventional path — so one key added to one file reached the app and all four helpers at once.

## What it needs to ship

1. In the Apple Developer portal, give the App ID the **Keychain Sharing** capability with the access group the app asks for, and create a **provisioning profile of the Developer ID distribution type** for it. Developer ID profiles exist for this case: a directly-distributed app that needs a profile-gated entitlement.
2. Embed it. electron-builder takes `mac.provisioningProfile`; it lands at `Contents/embedded.provisionprofile`.
3. Add `com.apple.application-identifier` and `com.apple.developer.team-identifier` alongside `keychain-access-groups`, matching the profile exactly. A profile granting less than the binary claims fails the same way as no profile.
4. Split the entitlement files. `entitlementsInherit` must stay as it was; only the app's own entitlements get these keys. A helper that inherits them is refused on its own.

Steps 1 and 2 need a person with portal access, which is why this could not be repaired in place once found.

Done, and shipped in `v1.6.14-beta.3`. The profile is committed at `apps/studio/build/Instrument_Developer_ID.provisionprofile` -- it holds public certificates, the team id, and the granted entitlements, and no private key, so it is not a secret. `keychain-access-groups` needed no capability enabled on the App ID: the portal lists none, and every profile carries `<TEAM>.*` for it regardless, which the entitlement's own group falls under.

## The part that will go stale

A profile grants a fixed set, and the binary may claim no more than that set. So the moment a team-scoped entitlement is added -- push notifications, app groups, associated domains, sign in with Apple -- the committed profile is out of date, and the build signs, notarizes, and will not launch, exactly as before. Regenerate the profile in the portal and re-commit it in the same change that adds the entitlement.

Hardened-runtime entitlements (`com.apple.security.cs.*`) are not in this class. They are self-granted, need no profile, and are safe to add on their own.

The release gate turns all of this from a shipped outage into a failed build, but it does not remove the step.

## Why nothing caught it, and what does now

The smoke test gates publishing and could not have caught this. It is a separate job from the signed build, with no signing credentials, so `pnpm turbo run smoke-test` packages its own copy — and an unsigned app carries no entitlements at all, so there is nothing for the system to refuse. Publishing was gated on a green run against a different binary from the one that shipped.

The launch method was not the problem. Measured against the two real builds, the kernel enforces this on a direct `exec` as well: running `Contents/MacOS/<app>` under `ELECTRON_RUN_AS_NODE` exits 0 on the good build and is **SIGKILLed** on the broken one, with no output. Only the reporting differs — `open` says "Launchd job spawn failed", a direct exec says nothing at all.

That pair is what `apps/studio/scripts/verify-packaged-app.ts` uses, run from the release job right after signing and notarization. It needs no display, finishes in under a second, and still crosses the check that fails. It is verified both ways against the two builds this finding is about.

What remains open is the general version: the smoke test still exercises an unsigned build it packages itself, so anything else that depends on signing, notarization, or entitlements is outside what a green smoke run means.
