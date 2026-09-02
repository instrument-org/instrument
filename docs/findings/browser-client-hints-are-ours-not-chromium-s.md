# Browser identity: the client hints are ours, not Chromium's

**Status:** current. The brand mismatch is fixed; the remaining gaps below are open. Measured 2026-08-31 on Electron 42.3.3 (Chromium 148.0.7778.218), macOS 26.6.2 arm64.

## What was measured

A throwaway Electron main process loaded a page through a session with and without `applyStandardUserAgent`, recording both the headers a local server received and what `navigator` reported in the page. The same comparison now lives in `apps/studio/src/electron-main/lib/user-agent.e2e.test.ts`, which asserts header and page identity are equal; run it with `USER_AGENT_E2E=1`.

Two results matter.

**Electron emits no UA client-hint headers at all.** Not on plain HTTP, not on HTTPS, not after an `Accept-CH` response, not with a trusted certificate. `ElectronBrowserContext::GetClientHintsControllerDelegate()` returns `nullptr`, so the browser process has nothing to attach hints from. `navigator.userAgentData` is unaffected because it is served on the Blink side from `embedder_support::GetUserAgentMetadata()`. So every `sec-ch-ua*` header the task browser sends is one we wrote, and deleting the injection does not fall back to a native value. It falls back to silence, which pairs a Chrome-shaped UA string with the header set of a pre-2021 browser.

**The brands disagreed across surfaces.** The header claimed a browser the page denied:

| Surface | Value |
| --- | --- |
| `sec-ch-ua` header | `"Chromium";v="148", "Google Chrome";v="148", "Not=A?Brand";v="24"` |
| `navigator.userAgentData.brands` | `"Not/A)Brand";v="99", "Chromium";v="148"` |

Three separate contradictions: a Google Chrome brand with no page-side counterpart, a GREASE entry with different punctuation and version, and the reverse list order. Any of the three is a one-line comparison for a site that reads both.

## Why the fix generates the list instead of writing one

Chromium derives the whole brand list from the major version: the GREASE brand's two punctuation characters cycle through an eleven-character pool at `major` and `major + 1`, its version cycles through `8, 99, 24`, and the list order flips with the major's parity. Reproducing that derivation is what keeps the header equal to the page across an Electron upgrade, where a fixed string would drift the moment Chromium's major moved.

The generation is checked three ways: against the live browser in the e2e test, against this Electron's `navigator.userAgentData` in a pinned unit snapshot, and against the published headers of Chrome 120, 128, and 131 for the GREASE cycle. The list order is the weakest of these. It is confirmed at one major only, and a wrong parity rule would put the right brands in the wrong order on some future Chromium. The e2e test is what catches that.

Which requests get hints at all is the same question asked about the transport. Chromium restricts client hints to potentially trustworthy origins, so hinting a plain `http://` request is a header no real Chrome sends, which is the brand mismatch pointed the other way. The injection is gated on the request URL for that reason. Loopback stays hinted, because Chromium treats the whole `127.0.0.0/8` range and every `.localhost` name as trustworthy regardless of scheme.

## What is still not coherent

**High-entropy hints are absent rather than wrong.** A site that negotiates `Accept-CH: sec-ch-ua-full-version-list` gets nothing back, where a real Chrome answers. Supplying them means tracking `Accept-CH` per origin, because sending high-entropy hints unprompted is itself unusual. Absence is a weaker signal than contradiction, so this was left alone.

**The compatibility case for the Google Chrome brand was never captured.** The comment in `user-agent.ts` cites avatar and asset rate limiting and inconsistent sign-in handling as the reason the session is normalized at all, but that motivation belongs to the UA string, which is unchanged. Whether any site keyed on the brand specifically is unknown. If one turns up, capture the response difference here before adding the brand back, because adding it back reopens the mismatch this finding is about.

**`Runtime.enable` is unrelated, and turned out not to matter.** `agent-browser` enables the CDP `Runtime` domain on every attached page and child target, which this finding once called a louder signal than any header. Measured since, the published detection for it does not fire on Chromium 148, with the domain demonstrably enabled and delivering events. Do not spend on it without re-measuring first. That reading, and the one check that does fail, are in [task-browser-self-report](task-browser-self-report.md).

## What not to do

Do not respond to a future mismatch by overriding `navigator.userAgentData` in the page. A property override leaves non-native descriptors and function sources behind, which is a stronger signal than the value it hides. The header is the surface we can change honestly, because we are the ones writing it.
