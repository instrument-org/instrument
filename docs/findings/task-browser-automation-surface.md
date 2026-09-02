# What the task browser tells a site about itself

**Status:** current. Measured 2026-09-01 on Electron 42.3.3 (Chromium 148.0.7778.218), macOS 26.6.2 arm64, against a live `<webview>` guest. Everything below is a reading, not a fix; nothing here has been changed. The reported block itself turned out to be paced rather than fingerprinted — see [what the block actually correlates with](#what-the-block-actually-correlates-with).

A user reported that Wayfair blocks the task browser. That site runs a "Press & Hold" interstitial with a reference id, served from an iframe, and once it fires it covers the whole origin rather than the page that tripped it. This records what the guest actually exposes, which of it is anomalous, and what the anomalies are worth. The header and client-hint half of the same question is [browser-client-hints-are-ours-not-chromium-s](browser-client-hints-are-ours-not-chromium-s.md); that work shipped before this block was reported and did not prevent it.

## How to take the reading again

`scripts/fingerprint-probe.mjs` in the [studio-chrome-devtools skill](../../.agents/skills/studio-chrome-devtools/SKILL.md) reaches into a guest through the host page's `<webview>` handle and reports the surface below. Open a page in the guest first, because an `about:blank` guest reports almost nothing.

```bash
node .agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs run \
  .agents/skills/studio-chrome-devtools/scripts/fingerprint-probe.mjs --args '{"taskId":"<task-id>"}'
```

Public suites are the other half, because they encode what collectors actually weigh. Pointing the guest at one is an ordinary navigation, and its result is a page you can read back.

## What is anomalous

Four values are ones a real Chrome does not produce. They are ranked by how cheap they are to check from page script, which is the only ranking that matters to a collector.

**`window.chrome` is a hollow object, and absent entirely inside an iframe.** It exists, so a shallow `"chrome" in window` passes, but it has no keys at all: `runtime`, `app`, `csi`, `loadTimes`, `webstore`, `connect`, and `sendMessage` are all undefined. Inside a same-origin iframe, `window.chrome` is `undefined`. This is the **only outright FAIL** the guest scores on a public detection suite (`HEADCHR_IFRAME`), and the iframe is where an interstitial's own script runs.

**`navigator.deviceMemory` reports 32.** The Device Memory specification rounds to a power of two and clamps the upper bound at 8, and Chrome implements that clamp, so 32 is a value no real Chrome emits on any hardware. It also leaks the machine's actual RAM. Reproduced independently by a second Electron app on the same machine, so this is Electron-wide rather than anything Studio does.

**Window geometry is impossible.** The guest reports `outerWidth` 1202 against `innerWidth` 1280 — an outer window narrower than the viewport it contains, which cannot happen in a real browser. The guest is reporting the host Studio window's bounds while its own layout viewport follows the guest element, so the two disagree by whatever the panel is currently sized to. The usual embedded-browser tell is `outerHeight == innerHeight`; this is louder than that, because the numbers are not merely equal but contradictory.

**The brands say Chromium while the UA string says Chrome.** `navigator.userAgentData.brands` is `Not/A)Brand` plus `Chromium`, with no Google Chrome entry, against a UA string of `Chrome/148.0.7778.218`. The two surfaces are internally consistent, which is what the client-hints work fixed, but they are consistent on the identity that bundled-Chromium automation ships with.

Two more are weak on their own and worth knowing about only because collectors record them: `navigator.languages` holds a single entry where Chrome normally carries a fallback as well, and `screen.colorDepth` reports 30 where 24 is near-universal.

## What is clean

Worth recording so the same ground is not re-covered. `navigator.webdriver` is `false` with no own descriptor, so the `AutomationControlled` blink feature is not in play and there is nothing to disable — we pass no `--enable-automation` and no `--remote-debugging-port`. The plugin and mime-type lists match a stock Chrome. Proprietary codecs are present, so we do not look like a vanilla Chromium build there. Permissions and `Notification.permission` agree. A Worker sees the same identity the page does. Every function on `Navigator.prototype` still serializes as `[native code]`, which is the payoff of having refused page-side property overrides.

## `Runtime.enable` is observable from the page

The finding above listed this as open and louder than any header. It is now measured rather than reasoned about: a four-line bait in page script — give a regex a `toString` that sets a flag, pass it to `console.debug` — trips in the guest. The debugger is attached for the guest's entire life (`ensureDebuggerAttached` runs at target creation), so this holds while the *user* browses the panel by hand, not only while the agent drives.

Caveat on that measurement: no no-CDP control was run, so what is established is that the bait trips with our stack as shipped, not the counterfactual.

Independent corroboration that this is the signal that matters most: Patchright, the undetected-automation Playwright fork, calls avoiding `Runtime.enable` "the biggest patch" it carries, and executes script in isolated execution contexts to sidestep it. It reports passing PerimeterX-class vendors with that in place. Our copy of the underlying CLI still calls `Runtime.enable` at three sites, ships as prebuilt per-platform binaries, and so cannot be patched locally.

## What the block actually correlates with

Volume, on the evidence available. In the session where the block was first reported, the sequence is unambiguous: a shell loop opened eight of the site's product pages back to back through the browser, each with a `networkidle` wait, and hit the tool timeout partway through. The agent then fetched the same eight URLs with a scripted HTTP client, and every one came back **HTTP 429 Too Many Requests** — a rate-limit code, not an identity refusal, and returned for all eight within three seconds, so the limit was already in force before that pass began. The next browser navigation after that was the interstitial.

The model diagnosed it correctly in the moment, and then made it worse. Its own note reads that the pages were rate-limiting the browser when opened repeatedly, and its response was to reach past the browser to the scripted client — which drops the cookies and session the earlier requests carried, presents an obviously non-browser client, and adds eight more requests to the count that caused the limit.

The shape is consistent elsewhere. A second reported session ran a burst of repeated navigations before its block. A deliberate reproduction here loaded one page cleanly, with real content returned, and was denied on the very next request.

So the proximate trigger is request pacing, not the fingerprint. What cannot be separated from outside is whether the threshold sits lower for a client the site already distrusts, and nothing here identifies a signal the vendor keys on. The anomalies above are worth what they are worth on their own terms; there is no evidence that fixing them clears this site, and a pacing change is both cheaper and better supported.

## Where the input path is still worth fixing

Separately from detection, and on firmer ground because it is a read of the code rather than an inference from a block: the CLI's `fill` focuses an element with a script call, sets `value` to empty, and dispatches a `new Event('input')` before inserting text. That event has `isTrusted` false, delivered onto the field. Printable characters then go through `Input.insertText` rather than key events, so no `keydown`, `keypress`, or `keyup` is produced at all.

The same mechanism has a plain correctness cost that has nothing to do with bots: setting `value` directly updates React's value tracker, so a controlled input swallows the change, re-renders its old value, and the inserted text lands appended rather than replacing. A search box filled twice submits the query twice over.

## What not to do

The reflex fix for every value above is a page-side property override, and the surveyed harnesses all take it — overriding `deviceMemory`, `screen`, `outerHeight`, and `window.chrome`, then patching `Function.prototype.toString` to hide the overrides. That escalation is the reason `[native code]` is still honest here, and it is worth keeping. Where a value can be corrected natively — through CDP's user-agent metadata, through a window's real bounds, through what Electron reports — that is a fix. Where it can only be corrected by lying in the page, the lie is a bigger signal than the value.
