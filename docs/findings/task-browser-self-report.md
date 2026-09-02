# What the task browser reports about itself

**Status:** current. Measured 2026-09-01 on Electron 42.3.3 (Chromium 148.0.7778.218), macOS 26.6.2 arm64, against a live `<webview>` guest. The identity and language mismatches it found are corrected in the guest; the rest is a reading rather than a fix. Three earlier readings in this file were wrong and are corrected in place, each with the reason: every one of them came of skipping a control, which is the failure mode this subject invites.

A user reported that a large retail site refused the task browser, serving a hold-to-confirm human check from an iframe that, once it fired, covered the whole origin rather than the page that tripped it. Running that down meant establishing what the guest actually says about itself, and comparing every answer against a real Chrome on the same machine rather than against what a specification says it should be. This records where the two differ, what each difference is worth, and which of them turned out not to be differences at all. The header and client-hint half of the same question is [browser-client-hints-are-ours-not-chromium-s](browser-client-hints-are-ours-not-chromium-s.md).

## How to take the reading again

`scripts/self-report-probe.mjs` in the [studio-chrome-devtools skill](../../.agents/skills/studio-chrome-devtools/SKILL.md) reaches into a guest through the host page's `<webview>` handle and reports the surface below. Open a page in the guest first, because an `about:blank` guest reports almost nothing.

```bash
node .agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs run \
  .agents/skills/studio-chrome-devtools/scripts/self-report-probe.mjs --args '{"taskId":"<task-id>"}'
```

Public conformance suites are the other half of the reading, since they exercise the same surface from page script and print a per-check result. Pointing the guest at one is an ordinary navigation, and the result is a page you can read back.

## Where the guest differs from a real Chrome

Every claim here is a diff against a real Google Chrome run on the same machine, because the alternative is asserting from the specification and being wrong. Of the four entries this section first carried, one was retracted outright and two have since been fixed, leaving the three below.

**`window.chrome` is a hollow object, and absent entirely inside an iframe.** It exists, so a shallow `"chrome" in window` passes, but it has no keys at all. Real Chrome carries `loadTimes`, `csi`, and `app`; the guest carries none of them, and where real Chrome reports `object` for a child frame's `chrome`, the guest reports `undefined`. These are installed by Chrome-only renderer code that Electron does not ship, so there is no native lever and no override we are willing to write. This one is a genuine, unfixable-in-place difference.

**`screen.colorDepth` reports 30 where a real Chrome on the same display reports 24.** Chrome appears to report 24 regardless of the panel; Electron passes the display's real depth through. No CDP command or Electron API covers it. Small, and left alone.

**Window geometry is contradictory.** The guest reports `outerWidth` 1202 against `innerWidth` 1280 -- an outer window narrower than the viewport inside it. The guest reports the host Studio window's bounds while its own layout viewport follows the guest element, so the two disagree by whatever the panel is sized to. Not verified against a headed Chrome, because a headless one reports zeros and is not a fair comparison, but the pair is impossible on its own terms.

### Retracted

**`navigator.deviceMemory` reporting 32 is not a defect.** This section previously called it a value no real Chrome emits, citing the specification's clamp at 8, and used the machine's true RAM showing through as a privacy argument. A real Chrome on the same machine reports 32 as well. The specification claim was never measured, and the entry was wrong.

### Fixed

**The brands, and the language list.** Both were real, both are corrected below, and both were fixed by making the reported value true rather than by concealing it.

## What is accurate

Worth recording so the same ground is not re-covered. `navigator.webdriver` is `false` with no own descriptor, so the `AutomationControlled` blink feature is not in play and there is nothing to disable -- we pass no `--enable-automation` and no `--remote-debugging-port`. The plugin count and mime-type list match a real Chrome exactly, as does `navigator.deviceMemory`. Proprietary codecs are present. Permissions and `Notification.permission` agree with each other. A Worker sees the same identity the page does. Every function on `Navigator.prototype` still serializes as `[native code]`, which is the payoff of having declined to overwrite any of this from page script.

## `Runtime.enable` is not observable, on this Chromium

The finding above carried this as the loudest open item, on the reasoning that the CLI enables the CDP `Runtime` domain on every attached page and child target. Measured, it does not show up.

The published technique for detecting it puts a non-configurable `stack` getter on an `Error`, passes the error to `console.debug`, and counts getter accesses on a later tick -- the client serializes the object out of band to build the console payload, and that read is the tell. Run against a throwaway Electron main process across four conditions, the getter is never touched: no debugger attached, `Runtime.enable` sent, `Runtime.disable` sent after it, and with a listener actively consuming events. That last run recorded four `Runtime.consoleAPICalled` events, so the domain was genuinely enabled and delivering while the getter stayed untouched.

A hosted conformance suite pointed at a real task browser guest agrees, reporting no leak for that check. Treat it as closed in Chromium 148 rather than as something we carry.

An earlier reading here claimed the opposite. It used a regex with an overridden `toString` instead of an error's `stack` getter, and `console.debug` invokes `toString` on a regex whether or not any client is attached, so it reported a positive in every condition including the control. The lesson is cheap to restate: a detection probe is worth nothing until its negative control has been run.

## Correcting the identity

The one red a conformance suite returned was the identity pair: `navigator.userAgentData` carried `Chromium` and no Google Chrome brand, which it flags directly as the signature of a non-branded build. The header had already been made to agree with the page by the client-hints work, so both surfaces were coherent and both were describing a build the app is not.

Correcting it needs both halves to move together, and the page half is the one that looked impossible. It is not: CDP's `Emulation.setUserAgentOverride` takes a `userAgentMetadata`, and Blink then serves `navigator.userAgentData` from it. The properties stay native, no descriptor or function source is disturbed, and nothing is written into the page. Guests get it at debugger attach; the app's own session does not, because no debugger is attached there and a header claiming what its page denies is the mismatch this is all about.

Two details decided the shape of the change.

**The brand order is derived, not chosen.** Chromium builds the list in a fixed order and scatters it with `shuffled[order[i]] = list[i]`, picking the permutation by `major % count`. Getting that wrong puts the right brands in an order no real build produces, which is the same contradiction pointed sideways. The permutation table is reproduced from the engine's own source and pinned in a test against a real Google Chrome: major 152 takes `{1, 0, 2}` and reports Chromium, GREASE, Google Chrome, which is exactly what the generator produces.

**Every high-entropy field has to be sent.** An omitted field comes back empty from `getHighEntropyValues()` rather than falling back to what Blink would have said, so a partial override trades one inconsistency for a louder one. All of them are derivable in the main process without asking the page: `process.getSystemVersion()` equals the `platformVersion` Blink reports, and `process.arch` gives the architecture and bitness.

The override lives on the page target for as long as the debugger stays attached, so one call per guest is enough. It does not reach out-of-process subframes, which keep reporting the engine's own brands.

## The language list, and why the first attempt was wrong

The same comparison showed `navigator.languages` holding one entry where a real Chrome on the same machine holds two: a system set to `en-US` gives Chrome `["en-US", "en"]` and an `Accept-Language` of `en-US,en;q=0.9`. A lone region tag is a shape no ordinary install produces.

The first fix expanded the list where the header is built, which moved the header and nothing else: Electron's `session.setUserAgent` takes an accept-language argument, but it reaches the header and stops there. That turned one oddity into a genuine contradiction -- a page listing languages its own requests did not ask for. It is only a fix once `Emulation.setUserAgentOverride` carries the list too, which is the same override the brands already ride on.

That override wants the list unweighted. CDP splits the string on commas and hands the pieces to `navigator.languages` verbatim, so passing the header's own value puts the literal tag `en;q=0.9` in the page. Chrome makes the same distinction and so do we now: weights on the header, bare tags in the page.

Verified end to end against an echo service: the page reports `["en-US", "en"]`, the request carries `Accept-Language: en-US,en;q=0.9`, and `sec-ch-ua` names the same three brands in the same order the page does.

## Are we as close as Electron allows

Yes, on everything measured, with three known exceptions and one deliberate choice. This is the standing answer to "can we do better", so it should be re-run rather than trusted after an Electron upgrade.

The leak suite returns green on every check. The stricter fingerprinting suite returns `0% headless` and `0% stealth`; the second matters more than it looks, because a browser carrying the usual page-side patches scores high there and we score zero. That is the same property stated three ways: nothing here is a disguise, so nothing reads as one.

Its soft "38% like headless" heuristic is six of sixteen checks, and it is worth reading only so nobody re-opens it:

| Contributor | Ours to fix |
| --- | --- |
| `noWebShare`, `noContentIndex`, `noContactsManager`, `noDownlinkMax` | No -- web platform APIs Electron does not ship |
| `hasKnownBgColor` | No |
| `notificationIsDenied` | Yes, and deliberately not fixed |

The last is our own doing: the guest denies every permission request, because there is no browser chrome in which to show a prompt, so `Notification.permission` reads `denied` where an untouched Chrome reads `default`. Granting permissions to look ordinary would be trading a real safety property for a cosmetic one. It stays.

Of the differences that remain, `window.chrome` and `screen.colorDepth` have no native lever and would need page-side writing we will not do. The window geometry is the one that is ours rather than Electron's, and no lever has been found for it yet -- that is the place to look next if this question is reopened.

## What the 429 actually meant

Not volume, and not the headers either, though this section has said each of those in turn. The corrections are kept because the route to both wrong readings is the same one every other error in this file took.

In the session where the block was first reported, a shell loop opened eight of the site's product pages back to back, the agent then fetched the same eight URLs with a scripted HTTP client, and all eight returned **HTTP 429 Too Many Requests**. Reading 429 as its name and the burst as its cause is the obvious inference and it is wrong.

Measured directly, one request at a time. The first pass looked like headers were the whole story, and that reading was too shallow. Taken at one moment, from one address, same URL, byte-identical browser headers wherever a full header set is named:

| Client | Headers | Result |
| --- | --- | --- |
| Python `urllib` | `User-Agent: Mozilla/5.0` only | **429** |
| Python `urllib` | full browser set | **200**, 1.5 MB |
| `curl`, HTTP/2 | full browser set | **429** |
| `curl`, HTTP/1.1 | full browser set | **429** |
| Node `undici` | full browser set | **429** |

Two gates, not one. The refusal happens below the headers first: `curl` and Node are turned away carrying exactly the headers that get Python through, on either HTTP version, so what is being read is the shape of the connection itself rather than anything in the request. Only for a client that clears that gate do the headers decide anything, which is the Python pair.

This is why one A/B is not enough here, and why the first version of this table was mislabelled. It compared two header sets inside a single client stack and generalized the result to scripted clients as a class. A parallel investigation reached the opposite conclusion from `curl` and Node alone, where no header set ever produced a 200. Both readings are correct inside their own stack and wrong as a general claim.

The address's own state also moves over hours, so pairs taken far apart are not comparable at all. Every row above was taken within one run, alternating, with the order reversed between trials.

What survives all of it: a scripted HTTP client is refused on shape, the shape that matters is deeper than its headers, and the status code is the refusal the vendor had to hand rather than a statement about a count. What the agent's escalation did was not exhaust a budget; it presented a client shape that is refused on sight, from an address the browser was also using.

This says nothing about what happened to the browser itself, which is a separate refusal served as an interstitial. A deliberate reproduction loaded one page cleanly and was refused on the very next request, which no reading here explains.

Two things follow for the agent's own guidance. Reaching past the browser to a scripted client when a site pushes back is worse than useless, because the scripted client is exactly the shape being refused -- that rule is now better supported than when it was written on the volume theory. Pacing a run of same-origin pages remains ordinary courtesy, but it should not be sold as the fix for a block, because here it was not the cause.

## Where the input path is still worth fixing

On firmer ground than any of this, because it is a read of the code rather than an inference: the CLI's `fill` focuses an element with a script call, sets `value` to empty, and dispatches a `new Event('input')` before inserting text. That event carries `isTrusted` false, so a page is told a user typed when none did. Printable characters then go through `Input.insertText` rather than key events, so no `keydown`, `keypress`, or `keyup` is produced at all.

The same mechanism has a plain correctness cost: setting `value` directly updates React's value tracker, so a controlled input swallows the change, re-renders its old value, and the inserted text lands appended rather than replacing. A field filled twice submits its contents twice over.

## What not to do

The reflex fix for every value above is to overwrite it from page script, and the harnesses surveyed all take it -- rewriting `deviceMemory`, `screen`, `outerHeight`, and `window.chrome`, then patching `Function.prototype.toString` to conceal the rewrites. Declining that is why `[native code]` is still true here, and it is worth keeping: a browser that lies about its own internals is not a better representative of the user than one that reports an odd number honestly. Where a value can be corrected at the source -- through CDP's user-agent metadata, through a window's real bounds, through what Electron reports -- correcting it makes the report true, and that is a fix worth making. Where the only available change is a page-side fiction, leave it.
