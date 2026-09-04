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

## What to check before shipping an entitlement again

The release pipeline cannot catch this, and neither can the packaged-app smoke test as it stands, because both ran clean on a build that could not start. The cheap check is to launch the built app from the command line on the machine that built it and read the error, before tagging:

```bash
open -a /path/to/Instrument.app
```

A launch that fails this way says so immediately and says nothing useful anywhere else.
