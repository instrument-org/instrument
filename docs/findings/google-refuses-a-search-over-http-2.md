# Google refuses a search over HTTP/2

**Status:** fixed where the network carries QUIC, open where it does not, checked 2026-11-25. Measured on Electron 45.2.3 (Chromium 156), macOS 27 arm64, one home network.

Google answered the in-app browser's first address-field search with its `/sorry/` bot interstitial, which is why searches once went to another engine. A profile someone had used for a while was not refused, and a search typed into Google's own page never was, which made it look like a matter of cookies or of deep links. It is neither. Google serves `/search` to this browser over HTTP/3 and refuses it over HTTP/2, and a profile that has never heard from google.com asks over HTTP/2.

## What was measured

A throwaway Electron main process, a fresh in-memory session per row, loading `https://www.google.com/search?q=…` in a window off screen with a different ordinary query each time, cold rows alternating with the rest in the same run.

| Before the search | Result |
| --- | --- |
| Nothing | refused, every time, under the app's UA and under stock Electron's, bare Chrome's, with no debugger, and with every high-entropy hint Google asks for |
| Three seconds' wait | refused |
| A request to another host (`example.com`, `gstatic.com`) | refused |
| `session.preconnect` to google.com | passed once, refused twice |
| google.com loaded as a page | passes |
| `google.com/generate_204`, which sets no cookie, credentials omitted | passes, every time |
| The same, then every connection closed | passes |
| A suggestion request, with or without cookies | passes |
| `generate_204` with `--disable-quic` | refused |
| Nothing, with DNS over HTTPS set to `dns.google` | passes, three of three |

The row that sets no cookie rules cookies out; the closed-connections row rules out a warm socket; `--disable-quic` names what is left.

A network log of cold and warmed searches shows the results page requested twice in one navigation: a first answer that runs in the page, then the same address again. The refused searches sent both over HTTP/2. The accepted ones sent the second over HTTP/3, and most of them sent the first over HTTP/2. `nextHopProtocol` cannot tell them apart, since on a refused search it describes the `/sorry/` page, which comes over HTTP/3.

Chromium learns a host speaks HTTP/3 from the `Alt-Svc` header of an earlier answer, which a preconnect never receives since it sends no request, or from the host's DNS `HTTPS` record. Google publishes that record (`alpn=h2,h3`), and Chromium read it over DNS over HTTPS here and not through this network's plain DNS, although `enableAdditionalDnsQueryTypes` is on by default.

HTTP/3 is necessary here and not sufficient: a second harness, with a stock user agent and a hidden window that did not paint, was refused in every row, warmed or not, once with every request over HTTP/3. Which of its differences did it was not isolated.

Why Google scores the two differently was not established; only the outcome was.

## What the app does

`contactGoogle` (`apps/studio/src/electron-main/browser-view/search-engine.ts`) asks google.com for an empty answer when the browser's session opens while Google is the chosen engine, with no cookies and no words. Suggestions go out through the same session, also without cookies. Nothing about the browser's identity changes.

## What other browsers do

Chrome connects to the default search engine's origin about five seconds after launch and every minute while it is in front (`chrome/browser/navigation_predictor/search_engine_preconnector.cc`). Brave has had this refusal open since 2025 for the first search of a new profile or private window (brave/brave-browser#50100); people there report that opening google.com first clears it, and it has no settled fix. Ardia moved its suggestion requests onto the browser's own network stack for it (ardia-browser/ardia#1281), which the suggestions here already use.

Setting DNS over HTTPS for the app would clear it with no contact, and is not done: it overrides the DNS the person's network or VPN chose, and sends every host they visit to one resolver.

## What it does not settle

A network that blocks UDP has no HTTP/3, so a search there goes over HTTP/2 whatever came first and is expected to be refused. One network and one operating system were measured. Google iterates on this check, so re-run the table before trusting it.
