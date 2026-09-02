# A 429 that is not a rate limit

**Status:** fixed. `web_fetch` now reads a failed response's body and says what a refusal without a `Retry-After` most likely is. The durable parts are the measurement, which overturned the obvious diagnosis, and the reconciliation with [what the task browser reports about itself](task-browser-self-report.md), which reads the same site from the browser path and finds a different trigger. Measured 2026-09-02.

A large retail site returns **HTTP 429 to a single cold request** from any scripted HTTP client. No prior traffic, nothing to rate-limit, no `Retry-After`. `web_fetch` cancelled the body and reported `Request failed with status 429 Too Many Requests.`, so the model read a rate limit, did what a rate limit calls for, and could not succeed.

## What happened

A shopping task fired six parallel `web_fetch` calls at one retail host to verify product details. All six returned 429. The agent's next words were that it had "a workable first pass", and it wrote the deliverable from unverified search excerpts without mentioning that nothing had been opened.

Told later that the product images were placeholders, it tried the same host through the browser (tool timeout at 124s), then through a scripted Python client (eight more 429s), then the browser again, which reported `Access to this page has been denied`. The user had to volunteer that a hold-to-confirm human check was waiting on screen.

The first diagnosis — six parallel fetches tripped a rate limiter, so add a throttle — was wrong, and a day of throttle work would have been built on it.

## The measurement

Single cold requests, three to four seconds apart, from one machine. "Ours" is the header set `web_fetch` sends; "Chrome-complete" adds `Accept-Encoding`, the four `Sec-Fetch-*` headers, the three `sec-ch-ua*` hints, and `Upgrade-Insecure-Requests`; "honest bot" is a self-identifying agent UA.

| Request | Ours | Chrome-complete | Honest bot |
| --- | --- | --- | --- |
| The retail host, product page | 429 | 429 | 429 |
| The retail host, homepage | 429 | — | — |
| The retail host, `robots.txt` | 200 | — | — |
| Two other large retailers | 200 | 200 | 200 |

**It is not a rate limit.** No `Retry-After`, `robots.txt` serving while every HTML page refuses, and one request being enough. Nothing about pacing is being measured on this path.

**Header realism does not change the verdict.** The "our requests look synthetic" hypothesis is not supported here, which is worth recording because it is the obvious next thing to try.

**Header realism only chooses which refusal you get.** Isolating one variable at a time: the `Sec-Fetch-*` and `sec-ch-ua*` headers make no difference at all, and the `Accept` header alone decides the body.

| `Accept` | Content type | Body |
| --- | --- | --- |
| `text/markdown;q=1.0, ...` (ours) | `application/json` | `{"message":"Too Many Requests (CDN PX)"}` |
| `text/html,application/xhtml+xml,...` | `text/html` | 6,033 bytes rendering to `Access to this page has been denied` |

Both name the block, and the 40-byte one names the vendor doing it. So there was never a header change worth making: the body was always informative, and we were throwing it away. An earlier draft of this finding recommended reordering `Accept` for legibility, which would also have cost the markdown-first negotiation that doc sites benefit from. The isolation run retired the recommendation.

## What changed

`fetchTextual` now reads a bounded slice of a failed response instead of cancelling it, flattens it to one line through the markdown converter, and includes it. A `Retry-After` is passed on when the site sends one. A 403 or 429 that sends none is described as more likely a block than a limit, pointed at the browser, and asked to be disclosed:

> There is no Retry-After header, so this is more likely a block on automated requests than a limit that lifts: fetching this host again, later or through a script, will probably be refused the same way. Open the URL in the browser instead, and if it shows a human check, ask the user to complete it there. If you carry on without this page, say so in your reply rather than leaving the gap unmentioned.

That last sentence is doing separate work. Every disclosure in the originating session came from the user noticing first — the failed verification, the placeholder images, and the block itself all went unmentioned — and the failure site is the one place a reminder is cheap and lands at the moment it applies.

The body cap is 64 KB read and 400 characters kept, well under the success path, so a site that answers a refusal with a full marketing shell cannot spend a fetch's budget on it.

## Reconciling with the browser-path reading

[task-browser-self-report.md](task-browser-self-report.md) concludes that the block correlates with volume, on browser-path evidence: a loop of eight navigations, then the interstitial, and a deliberate reproduction that loaded one page cleanly before being refused on the next.

Both readings hold, because they describe different clients:

- **Through the task browser** — real Chromium, real cookies, a session that accumulates — a first page loads and volume trips the refusal.
- **Through any scripted HTTP client** — `web_fetch`, `urllib`, `node:fetch` — the first request is refused, cold, whatever the headers.

The guidance splits with them. On the browser path, pacing is a lever and the interstitial is clearable by the user. On the HTTP path there is no lever: the site will not serve this class of client at all, and every retry, delay, and header change is spent for nothing. Same status code, different meaning, and the tool now says which one it is looking at.

## What was deliberately not built

**A throttle.** It was the first thing that looked obvious. One cold request 429s, so no pacing would have changed this session. A small per-host concurrency cap is still defensible as politeness and for hosts that really do rate-limit, but it has to be argued for on those grounds rather than on this one.

**Anything that makes the site serve us.** That part is not fixable and is not ours to fix. What was fixable was the agent being told the wrong thing about it.

## What to take from it

- **A status code is not a diagnosis.** 429 without `Retry-After`, with a body naming a bot vendor, is a block. Say which, and say that waiting will not help, because waiting is what the code invites.
- **The body is where the reason lives.** Cancelling it to release the connection saved nothing and cost the only evidence in the response.
- **Check the cheap counter-hypothesis first.** One request against `robots.txt` and one against a page took a minute and overturned the diagnosis the fix would have been built on.

## Unrelated, found in the same file

`guardedFetch` validates a hop's hostname with `isPrivateHostname` and then calls `fetch(currentUrl)`, which resolves the name again. The check and the connection can see different answers, which is the DNS-rebinding window the manual redirect loop exists to close. The DeepSeek harness closes it by resolving once, validating the whole answer set, and pinning those addresses into the connection through a custom lookup callback so the transport cannot re-resolve. Not fixed here; worth its own change.
