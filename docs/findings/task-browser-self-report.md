# What the task browser reports about itself

**Status:** current. Measured 2026-09-01 on Electron 42.3.3 (Chromium 148.0.7778.218), macOS 26.6.2 arm64, against a live `<webview>` guest. Everything below is a reading, not a fix; nothing here has been changed. The block that prompted it turned out to be a rate limit — see [what the block actually correlates with](#what-the-block-actually-correlates-with).

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

**The brands say Chromium while the UA string says Chrome.** `navigator.userAgentData.brands` is `Not/A)Brand` plus `Chromium`, with no Google Chrome entry, against a UA string of `Chrome/148.0.7778.218`. The two surfaces are internally consistent, which is what the client-hints work fixed, but they describe a build the app is not.

Two more are weak on their own: `navigator.languages` holds a single entry where Chrome normally carries a fallback as well, and `screen.colorDepth` reports 30 where 24 is near-universal.

## What is accurate

Worth recording so the same ground is not re-covered. `navigator.webdriver` is `false` with no own descriptor, so the `AutomationControlled` blink feature is not in play and there is nothing to disable — we pass no `--enable-automation` and no `--remote-debugging-port`. The plugin and mime-type lists match a stock Chrome. Proprietary codecs are present. Permissions and `Notification.permission` agree. A Worker sees the same identity the page does. Every function on `Navigator.prototype` still serializes as `[native code]`, which is the payoff of having declined to overwrite these values from page script.

## `Runtime.enable` is observable from the page

The finding above listed this as open. It is now measured rather than reasoned about: a four-line probe in page script — give a regex a `toString` that sets a flag, pass it to `console.debug` — trips in the guest. The debugger is attached for the guest's entire life (`ensureDebuggerAttached` runs at target creation), so a page can tell it is being instrumented while the *user* browses the panel by hand, not only while the agent drives. That is worth knowing on its own terms: the user's ordinary browsing carries a marker they did not ask for.

Caveat on the measurement: no no-CDP control was run, so what is established is that the probe trips with our stack as shipped, not the counterfactual.

A hardened fork of a mainstream browser-automation library, maintained specifically so its instrumentation does not alter the page, treats removing this as the single largest change it carries, and executes script in isolated execution contexts instead. Our copy of the underlying CLI still calls `Runtime.enable` at three sites, ships as prebuilt per-platform binaries, and so cannot be changed locally.

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
