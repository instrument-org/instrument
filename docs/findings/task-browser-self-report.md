# What the task browser reports about itself

**Status:** current. Measured 2026-09-01 on Electron 42.3.3 (Chromium 148.0.7778.218), macOS 26.6.2 arm64, against a live `<webview>` guest. The identity mismatch it found has since been corrected in the guest; everything else below is a reading rather than a fix. One earlier reading in this file was wrong and is corrected in place, with the reason it was wrong. The block that prompted it turned out to be a rate limit — see [what the block actually correlates with](#what-the-block-actually-correlates-with).

A user reported that a large retail site refused the task browser, serving a hold-to-confirm human check from an iframe that, once it fired, covered the whole origin rather than the page that tripped it. Running that down meant establishing what the guest actually says about itself, because several of those statements turn out to be false — not shaded, but values a browser cannot truthfully report. This records which ones, and what each is worth. The header and client-hint half of the same question is [browser-client-hints-are-ours-not-chromium-s](browser-client-hints-are-ours-not-chromium-s.md).

## How to take the reading again

`scripts/self-report-probe.mjs` in the [studio-chrome-devtools skill](../../.agents/skills/studio-chrome-devtools/SKILL.md) reaches into a guest through the host page's `<webview>` handle and reports the surface below. Open a page in the guest first, because an `about:blank` guest reports almost nothing.

```bash
node .agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs run \
  .agents/skills/studio-chrome-devtools/scripts/self-report-probe.mjs --args '{"taskId":"<task-id>"}'
```

Public conformance suites are the other half of the reading, since they exercise the same surface from page script and print a per-check result. Pointing the guest at one is an ordinary navigation, and the result is a page you can read back.

## Where the guest misreports itself

Four values are ones a real Chrome does not produce. Two of them are not merely unusual: they are arithmetically impossible, and a page reading them learns something untrue about the machine it is running on. They are ordered by how cheaply a page can notice.

**`window.chrome` is a hollow object, and absent entirely inside an iframe.** It exists, so a shallow `"chrome" in window` passes, but it has no keys at all: `runtime`, `app`, `csi`, `loadTimes`, `webstore`, `connect`, and `sendMessage` are all undefined. Inside a same-origin iframe, `window.chrome` is `undefined` outright. This is the only outright failure the guest records on a public suite, and iframes are where embedded third-party script usually runs.

**`navigator.deviceMemory` reports 32.** The Device Memory specification rounds to a power of two and clamps the upper bound at 8, and Chrome implements that clamp, so 32 is a number no real Chrome emits on any hardware. The value is also the machine's true RAM, which is precisely what the clamp exists to withhold — so this is a privacy leak before it is anything else. Reproduced independently by a second Electron app on the same machine, so it is Electron-wide rather than anything Studio does.

**Window geometry is impossible.** The guest reports `outerWidth` 1202 against `innerWidth` 1280 — an outer window narrower than the viewport inside it, which cannot happen. The guest reports the host Studio window's bounds while its own layout viewport follows the guest element, so the two disagree by whatever the panel is currently sized to. Any page doing responsive layout arithmetic off those two numbers is working from a contradiction.

**The brands said Chromium while the UA string said Chrome.** This was the only entry in the list a conformance suite actually flagged, and it is now [corrected](#correcting-the-identity), so a guest reports Google Chrome on both surfaces. The rest of this section still stands.

Two more are weak on their own: `navigator.languages` holds a single entry where Chrome normally carries a fallback as well, and `screen.colorDepth` reports 30 where 24 is near-universal.

## What is accurate

Worth recording so the same ground is not re-covered. `navigator.webdriver` is `false` with no own descriptor, so the `AutomationControlled` blink feature is not in play and there is nothing to disable — we pass no `--enable-automation` and no `--remote-debugging-port`. The plugin and mime-type lists match a stock Chrome. Proprietary codecs are present. Permissions and `Notification.permission` agree. A Worker sees the same identity the page does. Every function on `Navigator.prototype` still serializes as `[native code]`, which is the payoff of having declined to overwrite these values from page script.

## `Runtime.enable` is not observable, on this Chromium

The finding above carried this as the loudest open item, on the reasoning that the CLI enables the CDP `Runtime` domain on every attached page and child target. Measured, it does not show up.

The published technique for detecting it puts a non-configurable `stack` getter on an `Error`, passes the error to `console.debug`, and counts getter accesses on a later tick — the client serializes the object out of band to build the console payload, and that read is the tell. Run against a throwaway Electron main process across four conditions, the getter is never touched: no debugger attached, `Runtime.enable` sent, `Runtime.disable` sent after it, and with a listener actively consuming events. That last run recorded four `Runtime.consoleAPICalled` events, so the domain was genuinely enabled and delivering while the getter stayed untouched.

A hosted conformance suite pointed at a real task browser guest agrees, reporting no leak for that check. Treat it as closed in Chromium 148 rather than as something we carry.

An earlier reading here claimed the opposite. It used a regex with an overridden `toString` instead of an error's `stack` getter, and `console.debug` invokes `toString` on a regex whether or not any client is attached, so it reported a positive in every condition including the control. The lesson is cheap to restate: a detection probe is worth nothing until its negative control has been run.

## Correcting the identity

The one red a conformance suite returned was the identity pair: `navigator.userAgentData` carried `Chromium` and no Google Chrome brand, which it flags directly as the signature of a non-branded build. The header had already been made to agree with the page by the client-hints work, so both surfaces were coherent and both were describing a build the app is not.

Correcting it needs both halves to move together, and the page half is the one that looked impossible. It is not: CDP's `Emulation.setUserAgentOverride` takes a `userAgentMetadata`, and Blink then serves `navigator.userAgentData` from it. The properties stay native, no descriptor or function source is disturbed, and nothing is written into the page. Guests get it at debugger attach; the app's own session does not, because no debugger is attached there and a header claiming what its page denies is the mismatch this is all about.

Two details decided the shape of the change.

**The brand order is derived, not chosen.** Chromium builds the list in a fixed order and scatters it with `shuffled[order[i]] = list[i]`, picking the permutation by `major % count`. Getting that wrong puts the right brands in an order no real build produces, which is the same contradiction pointed sideways. The permutation table is reproduced from the engine's own source and pinned in a test against a real Google Chrome: major 152 takes `{1, 0, 2}` and reports Chromium, GREASE, Google Chrome, which is exactly what the generator produces.

**Every high-entropy field has to be sent.** An omitted field comes back empty from `getHighEntropyValues()` rather than falling back to what Blink would have said, so a partial override trades one inconsistency for a louder one. All of them are derivable in the main process without asking the page: `process.getSystemVersion()` equals the `platformVersion` Blink reports, and `process.arch` gives the architecture and bitness.

The override lives on the page target for as long as the debugger stays attached, so one call per guest is enough. It does not reach out-of-process subframes, which keep reporting the engine's own brands.

## What the suites say now

Every check on the leak suite is green, including the identity one. On the stricter fingerprinting suite the two verdicts that matter are `0% headless` and `0% stealth` — the second being the direct payoff of having refused page-side overwriting, since a browser carrying the usual stealth patches scores high there.

That suite also gives a soft "38% like headless" heuristic, which is worth reading only because it is easy to over-react to. It is six of sixteen checks, and four of them are web platform APIs Electron does not ship at all. A fifth is our own doing: the guest denies every permission request, because there is no browser chrome in which to show a prompt, so `Notification.permission` reads `denied` where an untouched Chrome reads `default`. That is a deliberate safety decision and it should stay; it is recorded here so the next reading does not treat it as a defect to chase.

## What the block actually correlates with

Volume, on the evidence available, and not any of the above. In the session where the block was first reported, the sequence is unambiguous: a shell loop opened eight of the site's product pages back to back through the browser, each with a `networkidle` wait, and hit the tool timeout partway through. The agent then fetched the same eight URLs with a scripted HTTP client, and every one came back **HTTP 429 Too Many Requests** — a rate-limit code, not a refusal of identity, and returned for all eight within three seconds, so the limit was already in force before that pass began. The next browser navigation after that was the interstitial.

The model diagnosed it correctly in the moment and then made it worse. Its own note reads that the pages were rate-limiting the browser when opened repeatedly, and its response was to reach past the browser to a scripted client — which drops the cookies and session the earlier requests carried, presents an obviously non-browser client, and adds eight more requests to the count that caused the limit.

The shape is consistent elsewhere. A second reported session ran a burst of repeated navigations before its block. A deliberate reproduction loaded one page cleanly, with real content returned, and was refused on the very next request.

So the proximate trigger is request pacing. Whether a site's threshold sits lower for a client whose self-report is inconsistent cannot be established from outside, and nothing here identifies what any particular site weighs. The misreports above are worth correcting because they are wrong, not because correcting them is known to unblock anything.

## Where the input path is still worth fixing

On firmer ground than any of this, because it is a read of the code rather than an inference: the CLI's `fill` focuses an element with a script call, sets `value` to empty, and dispatches a `new Event('input')` before inserting text. That event carries `isTrusted` false, so a page is told a user typed when none did. Printable characters then go through `Input.insertText` rather than key events, so no `keydown`, `keypress`, or `keyup` is produced at all.

The same mechanism has a plain correctness cost: setting `value` directly updates React's value tracker, so a controlled input swallows the change, re-renders its old value, and the inserted text lands appended rather than replacing. A field filled twice submits its contents twice over.

## What not to do

The reflex fix for every value above is to overwrite it from page script, and the harnesses surveyed all take it — rewriting `deviceMemory`, `screen`, `outerHeight`, and `window.chrome`, then patching `Function.prototype.toString` to conceal the rewrites. Declining that is why `[native code]` is still true here, and it is worth keeping: a browser that lies about its own internals is not a better representative of the user than one that reports an odd number honestly. Where a value can be corrected at the source — through CDP's user-agent metadata, through a window's real bounds, through what Electron reports — correcting it makes the report true, and that is a fix worth making. Where the only available change is a page-side fiction, leave it.
