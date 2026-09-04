# A bare Chrome identity is what Google refuses

**Status:** fixed. Measured 2026-09-04 on Electron 42.3.3 (Chromium 148.0.7778.218), macOS 26.6.2 arm64, against `accounts.google.com`. The fix is in `apps/studio/src/electron-main/lib/user-agent.ts`.

A user opened YouTube Music in the task browser, entered their Google address, and got **"Couldn't sign you in — This browser or app may not be secure"** at `accounts.google.com/v3/signin/rejected`. The obvious reading is that Google detected an embedded browser and that our disguise was not good enough. It is the wrong way round: the disguise was the reason. A UA carrying no product token at all — the exact string [browser-client-hints-are-ours-not-chromium-s](browser-client-hints-are-ours-not-chromium-s.md) and [task-browser-self-report](task-browser-self-report.md) worked to make coherent — is what Google refuses. Any honest product token clears it.

## What was measured

A throwaway Electron main process reproducing the guest session's configuration: `session.setUserAgent`, the `sec-ch-ua*` injection, and `Emulation.setUserAgentOverride` over an attached debugger. It loads `accounts.google.com/v3/signin/identifier` on the `GlifWebSignIn` flow, fills the identifier field, submits, and reports whether the flow lands on `/v3/signin/rejected`.

Two properties make this cheap to run. The check fires **before account lookup**, so a nonexistent address reproduces it and no password is ever involved. And it is deterministic per configuration, unlike the host in [a-429-that-is-not-a-rate-limit](a-429-that-is-not-a-rate-limit.md) — every cell below repeated.

| User-Agent | `sec-ch-ua` | Page metadata | Result |
| --- | --- | --- | --- |
| `… Chrome/148.0.7778.218 Safari/537.36` | Chrome-branded | set | **rejected** |
| `… Chrome/148.0.0.0 Safari/537.36` | Chrome-branded | set | **rejected** |
| `… Chrome/148.0.7778.218 Safari/537.36` | engine's own | none | **rejected** |
| `… Chrome/148.0.7778.218 Safari/537.36` | Chrome-branded | none | **rejected** |
| `… Chrome/148.0.7778.218 Safari/537.36` | none | none | **rejected** |
| `… Chrome/148… Electron/42.3.3 Safari/537.36` | none | none | passes |
| `… Chrome/148… Electron/42.3.3 Safari/537.36` | Chrome-branded | set | passes |
| `… Instrument/1.6.14 Chrome/148… Safari/537.36` | engine's own | none | passes |
| `… Chrome/148… Instrument/1.6.14 Safari/537.36` | engine's own | none | passes |

Ten rejections without a product token, twelve passes with one, across three identifiers. The last four rows were run alternating with the first row inside one session, so elapsed time cannot carry the result — the control this subject has burned three previous mechanisms for skipping.

**The client hints and the page metadata do not move it.** Every combination of them is refused when the UA is bare Chrome and accepted when it is not. Neither does the Chrome version format: reducing `148.0.7778.218` to the `148.0.0.0` shape real Chrome sends changes nothing on its own. The product token is the whole variable.

**It applies to consumer accounts.** A Google Workspace identifier passed with the bare-Chrome UA on every attempt; two `@gmail.com` identifiers, one real and one nonexistent, were refused on every attempt.

## Why, as far as this goes

Not established, and worth stating as inference. The runtime fails checks a real Chrome passes — `window.chrome` is a hollow object here and absent inside an iframe, per [task-browser-self-report](task-browser-self-report.md) — so a UA claiming to be stock Chrome makes a claim the page can check and disprove. An honest product token makes no such claim, and Google evidently does not object to Chromium-derived desktop browsers as a class. That reading fits every cell above, but the mechanism was not observed; only the outcome was.

What does not survive is the folklore this code was written against: that stripping the `Electron` token is how you get past Google's embedded-browser block. Here it is what causes it.

## What changed

`normalizeUserAgent` keeps the app's own product token and drops only the framework one, and reduces the Chrome version to the `<major>.0.0.0` form Chromium has sent since the Chrome 110 UA reduction — a shape no other cell tested, adopted because it is what shipping browsers send rather than because it moved this result. The brand list follows the UA: the guest names the app beside Chromium, where it previously named Google Chrome.

That closes the open item in [browser-client-hints-are-ours-not-chromium-s](browser-client-hints-are-ours-not-chromium-s.md), which asked for a captured response difference before keeping the Google Chrome brand. This is that difference, and it points at removing it.

## What this does not settle

Whether a coherent product-branded identity fares better or worse against bot detection generally — Cloudflare, Akamai, DataDome, and the retail host in [a-429-that-is-not-a-rate-limit](a-429-that-is-not-a-rate-limit.md). The reasoning for expecting no regression is that the signals those weight hardest are the TLS and HTTP/2 fingerprints, which come from Chromium's own network stack and are unchanged by any of this, and that the previous string was already inconsistent with real Chrome in a machine-checkable way. That is reasoning, not measurement. The same harness A/B's it if the question is ever worth settling.

Google iterates on this check. Re-run before trusting the table.

## The passkey step is still a wall

Past the identifier step, a consumer account with a passkey lands on `signin/challenge/pk` and stops: Electron ships the WebAuthn transport (the caBLEv2 strings are in the framework binary) but none of Chrome's `chrome/browser/ui/views/webauthn` dialogs, so the cross-device QR sheet cannot be drawn and the platform authenticator is not serviced at all until `app.configureWebAuthn({ touchID })` is called, which we do not call. Calling it would enable a Touch ID authenticator whose credentials are device-bound and stored per session partition — enough to enroll a new passkey after signing in another way, not enough to use one that already lives on a phone. "Try another way" is the route through today.
