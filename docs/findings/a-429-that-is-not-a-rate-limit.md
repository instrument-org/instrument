# A 429 that is not a rate limit

**Status:** fixed. `web_fetch` now reads a failed response's body and says what a refusal without a `Retry-After` most likely is. The durable part is the methodology: the host answers the same request differently seconds apart, so the single-sample comparisons two sessions each built a mechanism on were both unsound, and only the aggregate survives. Companion reading from the browser side is [what the task browser reports about itself](task-browser-self-report.md). Measured 2026-09-02.

A large retail site refuses most requests from any scripted HTTP client, including the first one, with **HTTP 429** and no `Retry-After`. No prior traffic, nothing to rate-limit. `web_fetch` cancelled the body and reported `Request failed with status 429 Too Many Requests.`, so the model read a rate limit, did what a rate limit calls for, and could not succeed.

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

**It is not a rate limit.** No `Retry-After` on any refusal across either session, a first request refused as readily as a later one, and a vendor string in the body that names bot detection rather than a quota. Nothing about pacing is being measured on this path. This is the one conclusion in the section that rests on the aggregate rather than on any cell of the table.

**Header realism does not reliably change the verdict.** Three samples a column cannot establish that, and the section below explains why. What the aggregate across both sessions supports is only the weaker claim: browser-shaped headers do not make a scripted client pass, and the "our requests look synthetic" fix is not one. Worth recording because it is the obvious thing to reach for.

### Read that table as samples, not as a verdict

Every cell above is one request, and the host does not answer the same request the same way twice. A parallel session, on the same machine and the same Python binary that had returned 429 for this one, fired two identical requests five seconds apart and got **200 with 1.5 MB, then 429**. Across both sessions the aggregate is roughly thirty-five single cold requests spanning `undici`, `curl` over HTTP/1.1 and HTTP/2, two Pythons against different TLS libraries, and a real browser; the great majority were refused, a handful were not, and no client or header set predicts which.

So the columns above are not really being compared. Three samples of a process that refuses most of the time will agree three times whatever the headers do, which is how a comparison that controlled the client, the URL, the path class and the moment still could not support the conclusion drawn from it. Both sessions investigating this reached a mechanism claim from single-sample A/B, and both claims were wrong: one that volume decided it, one that headers did.

What the aggregate does support: no scripted HTTP client gets through reliably, a real browser was refused too, and nothing here identifies which layer decides. That is weaker than either session first wrote and it is the part that has held. The [companion finding](task-browser-self-report.md) carries the same conclusion from the browser side.

**Header realism does decide the shape of the refusal**, and this is the one relation here that replicated. The `Sec-Fetch-*` and `sec-ch-ua*` headers make no difference; the `Accept` header alone selects the body, the same way in three runs spread over hours:

| `Accept` | Content type | Body |
| --- | --- | --- |
| A JSON-ish `Accept`, including our markdown-first one | `application/json` | small, structured, naming the bot vendor |
| A browser `Accept` | `text/html` | the multi-kilobyte deny page |

The relation is what replicated; the bodies themselves are not constants. This session saw the JSON variant at 40 bytes reading `{"message":"Too Many Requests (CDN PX)"}`; a second session on a different client stack saw it at 677 bytes carrying a vendor bootstrap payload (`appId`, `jsClientSrc`) and no message at all. Same negotiation, different contents, which is why the sizes and the exact strings are kept out of the claim. Naming one of them as *the* body would be the same over-reading that killed the four mechanisms above, just in a much narrower place.

Why this survives when three mechanism claims did not: it repeated on every run rather than once, it reproduced from a second session on a different client stack hours later, and it is ordinary content negotiation rather than a scoring decision -- a server choosing a representation by `Accept` is deterministic in a way a bot verdict is not. Note also what it is *not* a claim about. It says nothing about whether a request is refused, only about what the refusal is written in, which is why it survives a host that answers the same request two different ways.

So there was never a header change worth making: the body was always informative, and we were throwing it away. That the JSON variant's contents vary between observations is an argument for surfacing the body rather than summarizing it, since there is nothing stable enough to summarize in advance. An earlier draft of this finding recommended reordering `Accept` for legibility, which would also have cost the markdown-first negotiation that doc sites benefit from. The isolation run retired the recommendation.

## What changed

`fetchTextual` now reads a bounded slice of a failed response instead of cancelling it, flattens it to one line through the markdown converter, and includes it. A `Retry-After` is passed on when the site sends one. A 403 or 429 that sends none is described as more likely a block than a limit, given a retry budget, and asked to be disclosed:

> There is no Retry-After header, so this is more likely a block on automated requests than a limit that lifts. Such a host refuses the great majority of requests whatever the client or the headers, and answers inconsistently rather than predictably: one more attempt is reasonable, a third is not, and changing HTTP client or copying a browser's headers does not help. The browser is the better bet and not a guarantee, since these sites refuse a real browser too: open the page there, and ask the user to clear any human check it shows. If that is also refused there is nothing further to try, so tell the user the site is refusing rather than working down a list of clients. Either way, if you carry on without this page, say so in your reply rather than leaving the gap unmentioned.

The retry budget is deliberate and was not in the first version, which said a retry would probably be refused the same way. Once the host was measured answering identically-shaped requests differently seconds apart, forbidding the retry outright became a claim the evidence does not carry -- while a loop is still the failure this message exists to stop, so the sentence bounds it at one rather than blessing it.

That last sentence is doing separate work. Every disclosure in the originating session came from the user noticing first — the failed verification, the placeholder images, and the block itself all went unmentioned — and the failure site is the one place a reminder is cheap and lands at the moment it applies.

The body cap is 64 KB read and 400 characters kept, well under the success path, so a site that answers a refusal with a full marketing shell cannot spend a fetch's budget on it.

## Three mechanism claims, none of which survived

Worth keeping as a list, because the subject produced a wrong answer from two independent investigations and the answers were confidently different each time.

1. **Volume.** Read from the originating session, where a burst of navigations preceded eight 429s. Retracted: a single cold request with nothing before it is refused too.
2. **Header shape.** Read from a browser-headers-versus-bare-UA pair inside one client stack. Retracted: `curl` and `undici` are refused carrying byte-identical browser headers.
3. **Client stack, two gates.** Read from Python succeeding where `curl` and `undici` failed. Retracted: the same Python binary, same headers, five seconds apart, returned 200 then 429.

Each was a real comparison, carefully controlled on every variable its author thought of, and each fell to the one nobody controlled -- that a single sample of this host is a coin weighted against you rather than a reading.

What is left is a statement about frequency rather than mechanism, and it is enough for the guidance either path needs. No scripted HTTP client gets through reliably. A real browser is also refused, separately, with an interstitial the user can clear. Reaching past the browser to a scripted client is not an escape, because that client is refused more often than the browser is, and pacing is courtesy rather than a cure.

## What a page cache does and does not cover

A five-minute page cache landed alongside this, on the separate observation that the same URL gets requested more than once for reasons unrelated to the page changing — overlapping parallel calls, a retry, returning to a source, or two tasks researching the same thing. This session made six overlapping requests inside 1.3 seconds and came back to the same URLs about two and four minutes later.

It does nothing for a block. **Only successful bodies are held**, deliberately: a refusal can be cleared by the user completing a challenge, and a cached one would outlast the fix and keep reporting a wall that is no longer there. The cache is a cost and latency measure, not a mitigation for anything in this finding.

## What was deliberately not built

**A throttle.** It was the first thing that looked obvious. One cold request 429s, so no pacing would have changed this session. A small per-host concurrency cap is still defensible as politeness and for hosts that really do rate-limit, but it has to be argued for on those grounds rather than on this one.

**Anything that makes the site serve us.** That part is not fixable and is not ours to fix. What was fixable was the agent being told the wrong thing about it.

## What to take from it

- **A status code is not a diagnosis.** 429 without `Retry-After`, with a body naming a bot vendor, is a block. Say which, and say that waiting will not help, because waiting is what the code invites.
- **The body is where the reason lives.** Cancelling it to release the connection saved nothing and cost the only evidence in the response.
- **Check the cheap counter-hypothesis first.** One request against `robots.txt` and one against a page took a minute and overturned the diagnosis the fix would have been built on.
- **Establish that the measurement repeats before comparing anything with it.** Two sessions each ran a controlled A/B here, each drew a mechanism from it, and each was wrong, because neither had checked that one arm returns the same answer twice. Repeat one cell before building a table out of it: against a defended host it costs two requests and it is the difference between a finding and a coin flip.

## Unrelated, found in the same file

`guardedFetch` validates a hop's hostname with `isPrivateHostname` and then calls `fetch(currentUrl)`, which resolves the name again. The check and the connection can see different answers, which is the DNS-rebinding window the manual redirect loop exists to close. The DeepSeek harness closes it by resolving once, validating the whole answer set, and pinning those addresses into the connection through a custom lookup callback so the transport cannot re-resolve. Not fixed here; worth its own change.
