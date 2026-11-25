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

The row that sets no cookie rules cookies out; the closed-connections row rules out a warm socket; `--disable-quic` names what is left. `nextHopProtocol` reads `h3` on every accepted page and `h2` on every refused one with QUIC off. What carries over between requests is Chromium's memory of the `Alt-Svc` header Google answers with, which a preconnect never receives, since it sends no request.

Why Google scores the two differently was not established; only the outcome was.

## What the app does

`contactSearchEngine` (`apps/studio/src/electron-main/browser-view/search-engine.ts`) asks google.com for an empty answer when the browser's session opens, with no cookies and no words. Suggestions go out through the same session, also without cookies. Nothing about the browser's identity changes.

## What it does not settle

A network that blocks UDP has no HTTP/3, so a search there goes over HTTP/2 whatever came first and is expected to be refused. One network and one operating system were measured. Google iterates on this check, so re-run the table before trusting it.
