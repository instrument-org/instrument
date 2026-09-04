# What refuses the task browser

**Status:** standing register, current. One row per refusal we have met, with what each one turned out to be and where it stands. The per-issue findings linked from the table carry the measurements and their dates; this file is the map, so a new refusal can be placed against the ones already understood instead of re-derived.

Read it before spending on a refusal. Every entry below was explained wrongly at least once, and every wrong explanation came of reasoning from a single clean-looking measurement instead of running a control. The subject invites that failure specifically: these hosts answer inconsistently, so a plausible mechanism is always available and usually wrong.

## What the task browser presents

One identity, everywhere, not varied by host. It names the app rather than claiming to be Google Chrome, because a claim a site can check and disprove is worse than no claim.

| Surface | Value |
| --- | --- |
| User-Agent | `Mozilla/5.0 (<platform>) AppleWebKit/537.36 (KHTML, like Gecko) <AppName>/<ver> Chrome/<major>.0.0.0 Safari/537.36` |
| `sec-ch-ua` (guest) | GREASE, `Chromium`, and the app, in Chromium's own derived order |
| `sec-ch-ua` (app's own session) | GREASE and `Chromium` only |
| `navigator.userAgent` / `userAgentData` | equal to the headers above, on the guest |

That shape is the one Edge, Opera, Vivaldi, Samsung Internet, and every Electron app ship: a product token beside a reduced Chrome version. It is deliberately not Brave's, which reports a UA byte-identical to Chrome's and can afford to, being a full Chrome build underneath.

Both halves move together or neither does. The header is ours to write, because Electron emits no client hints at all; the page half moves only through CDP on a session with an attached debugger; and a header naming a brand the page denies is a louder signal than either value alone. `apps/studio/src/electron-main/lib/user-agent.ts` holds the rule, [browser-client-hints-are-ours-not-chromium-s](browser-client-hints-are-ours-not-chromium-s.md) holds why.

## The escalation ladder

1. **The task browser.** A `<webview>` guest on the workspace's persistent profile — one profile shared by every task, so a sign-in survives across tasks and restarts.
2. **The user's own Chrome**, via `agent-browser --profile`. A real Chrome with the user's real profile, where there is nothing to detect and passkeys work.
3. Nothing below that. Reaching past the browser to a scripted HTTP client is not a third rung; it is measurably worse, per the 429 row.

**Rung 2 is behind the `external_browser` feature flag, and the flag is off by default.** For a user who has not turned it on, the ladder has one rung, and the agent is told so: the targeting guidance renders a different branch that names no other browser. So a session where the agent does not offer to switch is ambiguous evidence, and reading the session context for which branch rendered is the first thing to check before concluding anything about the agent's judgment.

With the flag on, the agent used to under-use rung 2: it stopped at asking the user to clear the block rather than offering to switch. Four surfaces told it to stop there -- the skill's interstitial recovery, the skill's authenticated-work recipe, the deny-page text `web_fetch` returns on a blocked host, and the targeting guidance itself.

All four now name the second move, and one detail decided whether that changed anything. Stating the fork abstractly -- "offer the browser that could" -- did not move the model at all: driven against the retail host in the running app, it reported the block and closed on asking the user to clear it, without ever checking what other targets existed. Naming `--profile` and saying the offer comes unasked moved it in one attempt: it probed the available profiles and offered both routes. Same task, same model, same host, one wording change between them. An affordance the model has to go and confirm before mentioning is one it will not mention.

## The register

| Refusal | What it actually is | Ours to fix | State |
| --- | --- | --- | --- |
| Google consumer sign-in: "This browser or app may not be secure" | A UA with no product token, claiming to be stock Chrome from a runtime that fails Chrome's checks. Not embedded-browser detection, and not the client hints | Yes | **Fixed.** [Detail](a-bare-chrome-identity-is-what-google-refuses.md) |
| Google passkey challenge (`signin/challenge/pk`) | Electron ships the WebAuthn transport but none of Chrome's WebAuthn UI, so neither the cross-device QR sheet nor a platform authenticator is available | Partly — see Passkeys | **Open.** Password or "Try another way" is the route through |
| Press-and-hold interstitial on a large retail host | Two bot vendors stacked: PerimeterX/HUMAN, whose signature challenge this is, and DataDome. It fires within a few page views, so it is not volume; a real browser on the same machine is unaffected; and it covers the origin rather than the page that tripped it | One lever, below | **Open, vendors identified.** See The two-vendor host |
| 429s from that same host to scripted clients | Not a rate limit, not a header set, not the client stack. Roughly thirty controlled requests across five client stacks established only that the host answers inconsistently — a real browser was refused minutes either side of a scripted client being served | No | **Closed as not ours.** [Detail](a-429-that-is-not-a-rate-limit.md) |
| Cloudflare, Akamai, DataDome managed challenges | Unmeasured against this browser at all | Unknown | **Unmeasured** |

Two rows are easy to conflate and should not be. The 429s and the press-and-hold come from the same host, and the 429 investigation closed the *scripted client* question without touching the *browser* one: the interstitial is a separate refusal, served to the browser, and nothing in that finding explains it.

## The two-vendor host

The retail host in the register runs PerimeterX/HUMAN and DataDome at the same time, which is worth recording because it bounds what is worth attempting there.

PerimeterX is served first-party, from a subdomain of the site rather than the vendor's own, alongside the vendor origins and its `_px3` / `_pxvid` cookies; DataDome ships its own tag beside it. Both combine device fingerprinting with behavioral telemetry, so a refusal there is not one signal to find and correct — it is a score, and a browser can lose it on inputs we have no lever over.

Two of our known gaps are the plausible contributors, and they are not equally ours.

**The fingerprint half is not ours.** `window.chrome` is a hollow object here and absent inside an iframe, which is exactly the kind of cheap, high-confidence check a fingerprint vendor keys on, and there is no native lever for it in Electron. Nothing about the identity work above touches it: the host refused this browser when its User-Agent was byte-identical to Chrome's, which is the clearest evidence available that the User-Agent was never what it read.

**The behavioral half is ours, and is worth fixing on its own merits.** The CLI's `fill` sets an element's `value` directly and dispatches a synthetic `input` event, so the page is told a user typed when the event carries `isTrusted: false`; printable characters then go through `Input.insertText`, which produces no `keydown`, `keypress`, or `keyup` at all. That is a behavioral profile no human produces. It also has a plain correctness cost that stands whatever the vendors do: setting `value` directly updates React's value tracker, so a controlled input swallows the change and re-renders its old value, and text lands appended rather than replacing.

So the honest expectation for this host is that fixing the input path is worth doing and may not be enough, because the fingerprint half stays broken and there are two independent vendors scoring. Do not spend against it as though one correction will clear it.

## What Electron cannot give us

The gap between this browser and a real Chrome is narrower than it looks, and all of it is in Chrome's product layer rather than the engine. The TLS and HTTP/2 fingerprints, the network stack, and Blink are Chromium's own and identical to Chrome's — which is why a leak suite returns green and a fingerprinting suite scores zero on both headless and stealth. What is missing is the parts of `chrome/browser` Electron does not build:

- **`window.chrome` is a hollow object**, and absent entirely inside an iframe, where real Chrome carries `loadTimes`, `csi`, and `app`. No native lever exists, and it is the most plausible single tell a fingerprinting vendor would key on.
- **No WebAuthn UI.** No cross-device QR sheet, and no platform authenticator at all until `app.configureWebAuthn({ touchID })` is called.
- **No second page target for the agent.** Its CDP connection is pinned to one page, so popups are denied while it drives and `target=_blank` clicks are redirected into the same tab. A user driving the guest gets real popups, which is what keeps popup-based sign-in flows working.
- **Every permission request is denied**, because there is no browser chrome in which to prompt, so `Notification.permission` reads `denied` where an untouched Chrome reads `default`.
- **`screen.colorDepth` and window geometry disagree with Chrome**, the second contradictorily: the guest reports the host window's outer bounds against its own layout viewport.

[task-browser-self-report](task-browser-self-report.md) measures each against a real Chrome on the same machine, along with the several that turned out not to be differences at all.

Closing any of them means an upstream Electron change, a native bridge, or rung 2. It does not mean writing the values from page script.

## What we do not do

Overwrite any of this from the page. Every harness surveyed rewrites `deviceMemory`, `screen`, `outerHeight`, and `window.chrome`, then patches `Function.prototype.toString` to hide the rewrites. Declining that is why every function on `Navigator.prototype` still serializes as `[native code]` here, and why the stealth score is zero: nothing is a disguise, so nothing reads as one. Where a value can be corrected at its source — through CDP's user-agent metadata, through a window's real bounds — correcting it makes the report true and is worth doing. Where the only available change is a page-side fiction, leave it.

## Passkeys

Three tiers, one of them close.

- **Touch ID platform authenticator. Working.** `app.configureWebAuthn({ touchID: { keychainAccessGroup } })` enables it; until that call, `isUserVerifyingPlatformAuthenticatorAvailable()` resolves `false` and platform requests are not serviced at all. Shipping it needs an embedded provisioning profile granting the keychain group, which a first attempt did not have: the build signed, notarized, and then would not launch at all ([detail](an-entitlement-that-notarizes-and-will-not-launch.md)). With the profile in place, a signed build reports `isUVPAA=true`, raises the Touch ID prompt, and registers a credential against a live relying party with `authenticatorAttachment: "platform"`.

  Two things follow from how these credentials are stored. They are device-bound and never synced through iCloud Keychain, so a passkey the user's account already has on a phone is out of reach and the only route is enrolling a new one here after signing in another way. And `navigator.credentials.get()` finding more than one of them raises `select-webauthn-account` on the session, which cancels the sign-in with `NotAllowedError` if nothing answers -- a failure that reads as the site rejecting the credential rather than as a missing picker. Credentials are device-bound, held in the macOS keychain, and isolated per session partition — which works out here, since every task shares one browser profile, so an enrolled passkey is usable from any task. It needs a `keychain-access-groups` code-signing entitlement, so it cannot be verified in an unsigned dev build. It buys enrolling a passkey on this machine and then using it; it does not reach one that already lives on a phone or in iCloud Keychain.
- **Cross-device hybrid, the QR sheet.** Chromium's caBLE transport is compiled into Electron, but the sheet that draws the QR is Chrome UI Electron does not ship, and Electron exposes nothing for it: no API, no event, no delegate hook, nothing in `shell/browser/webauthn/` beyond the account-selection path. Searched rather than assumed. Closing it means an upstream Electron change, or a native `AuthenticationServices` bridge whose page-side shim over `navigator.credentials` is the one thing this file says not to write — on a sign-in page, where it would be read.
- **Rung 2.** The user's own Chrome already does all of it.

## Open questions worth measuring

- **Whether the input path is what the two-vendor host reads.** It is the one lever we hold there, it has an independent correctness bug, and nothing has measured whether fixing it changes the outcome.
- **Whether the product token costs anything.** A crude allowlist keyed on major-browser UA strings would reject it. The risk is real and unmeasured; the counter-argument is that such a list rejects Edge and Opera too. The identity harness in [a-bare-chrome-identity-is-what-google-refuses](a-bare-chrome-identity-is-what-google-refuses.md) A/Bs it against any origin.
- **Whether rung 2 clears what rung 1 cannot**, on the hosts in the register. Assumed throughout, demonstrated nowhere.
