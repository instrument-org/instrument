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

The standing gap is that the agent under-uses rung 2. It has the flag and the prompt describes it, but on a refusal it stops and asks the user to sign in rather than offering to switch. That is a prompt-and-skill problem, not an identity one, and the skill's own interstitial guidance currently steers the other way.

## The register

| Refusal | What it actually is | Ours to fix | State |
| --- | --- | --- | --- |
| Google consumer sign-in: "This browser or app may not be secure" | A UA with no product token, claiming to be stock Chrome from a runtime that fails Chrome's checks. Not embedded-browser detection, and not the client hints | Yes | **Fixed.** [Detail](a-bare-chrome-identity-is-what-google-refuses.md) |
| Google passkey challenge (`signin/challenge/pk`) | Electron ships the WebAuthn transport but none of Chrome's WebAuthn UI, so neither the cross-device QR sheet nor a platform authenticator is available | Partly — see Passkeys | **Open.** Password or "Try another way" is the route through |
| Press-and-hold interstitial on a large retail host | Unidentified. It fires within a few page views, so it is not volume; a real browser on the same machine is unaffected; and it covers the origin rather than the page that tripped it | Unknown | **Open, undiagnosed.** The vendor has never been identified — see Open questions |
| 429s from that same host to scripted clients | Not a rate limit, not a header set, not the client stack. Roughly thirty controlled requests across five client stacks established only that the host answers inconsistently — a real browser was refused minutes either side of a scripted client being served | No | **Closed as not ours.** [Detail](a-429-that-is-not-a-rate-limit.md) |
| Cloudflare, Akamai, DataDome managed challenges | Unmeasured against this browser at all | Unknown | **Unmeasured** |

Two rows are easy to conflate and should not be. The 429s and the press-and-hold come from the same host, and the 429 investigation closed the *scripted client* question without touching the *browser* one: the interstitial is a separate refusal, served to the browser, and nothing in that finding explains it.

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

- **Touch ID platform authenticator.** `app.configureWebAuthn({ touchID: { keychainAccessGroup } })` enables it; until that call, `isUserVerifyingPlatformAuthenticatorAvailable()` resolves `false` and platform requests are not serviced at all. Credentials are device-bound, held in the macOS keychain, and isolated per session partition — which works out here, since every task shares one browser profile, so an enrolled passkey is usable from any task. It needs a `keychain-access-groups` code-signing entitlement, so it cannot be verified in an unsigned dev build. It buys enrolling a passkey on this machine and then using it; it does not reach one that already lives on a phone or in iCloud Keychain.
- **Cross-device hybrid, the QR sheet.** Chromium's caBLE transport is compiled into Electron, but the sheet that draws the QR is Chrome UI Electron does not ship, and Electron exposes no delegate to supply one. Closing it means an upstream Electron change, or a native `AuthenticationServices` bridge whose page-side shim over `navigator.credentials` is the one thing this file says not to write — on a sign-in page, where it would be read.
- **Rung 2.** The user's own Chrome already does all of it.

## Open questions worth measuring

- **Which vendor serves the press-and-hold challenge.** One `agent-browser network requests` on the challenge page names it from the script origins, and the answer decides whether anything is fixable: a behavioral vendor and a fingerprint vendor call for different work, and today we are guessing which one we fail.
- **Whether the product token costs anything.** A crude allowlist keyed on major-browser UA strings would reject it. The risk is real and unmeasured; the counter-argument is that such a list rejects Edge and Opera too. The identity harness in [a-bare-chrome-identity-is-what-google-refuses](a-bare-chrome-identity-is-what-google-refuses.md) A/Bs it against any origin.
- **Whether rung 2 clears what rung 1 cannot**, on the hosts in the register. Assumed throughout, demonstrated nowhere.
