# The search backend returns more per result than we forwarded

**Status:** fixed for what was fixable. `image` and `favicon` are forwarded and rendered, the false freshness claim is gone from the excerpt preamble, and lines three results share are charged for once. What remains is a set of measured trade-offs and one thing that is simply true about the backend, all recorded below so nobody re-derives them. Measured 2026-09-02 against the live backend.

Every search result carries a lead image and a site icon on the source's own CDN. The platform API's response schema picked five fields and dropped both, so an agent that needed a picture of a search result had to open the page — and the pages most worth illustrating are the ones most likely to refuse.

## What was dropped, and what it cost

The backend returns `id`, `title`, `url`, `text`, `publishedDate`, `author`, `image`, `favicon`, and, on request, `extras`. We forwarded the middle five.

In a shopping task the agent wanted product photos, could not fetch the product pages (see [a 429 that is not a rate limit](a-429-that-is-not-a-rate-limit.md)), drew abstract CSS shapes in their place, and did not say it had. The photos were in the first search response the whole time. For one result:

```
title : Wade Logan® Laguna Square 4 - Person 43" Long Dining Set
url   : .../beachcrest-home-essie-square-4-person-43-long-dining-set...
image : .../Essie+4-Person+Plastic+Outdoor+Dining+Set+with+Square+Table.jpg
```

Three brands in one record, and worth noting which field is wrong: the **title** is stale, while the image and the URL agree with each other and with the page. The deliverable shipped the title's brand attached to the URL's slug, because the model had the one field we forwarded and neither of the two that would have contradicted it.

Both now travel through to the excerpt as `Lead image:` and `Site icon:`, beside `Published or updated:` and `Author:`.

## What is a trade rather than a gap

**`extras.imageLinks` is not requested.** It returns the whole gallery, including the variant matching the `piid` in the URL's query string — which is exactly what the agent was trying to scrape. It also multiplies image payload per result, for a need one hero image usually covers. Left off deliberately; turn it on if a task class appears that needs more than one image per source.

**`maxAgeHours` is not sent.** It is a real parameter, correctly placed in the request the platform API builds, and no caller sets it. Isolated on the `/contents` endpoint:

| URL | `maxAgeHours` | `statuses[].source` | Date in the returned text |
| --- | --- | --- | --- |
| A daily-updated news site | unset | `cached` | September 1 |
| A daily-updated news site | 1 | `crawled` | September 2 |
| The blocked retail product page | unset | `cached` | "Get it by Mon, Jul 6" |
| The blocked retail product page | 1 | `cached` | "Get it by Mon, Jul 6" |

So it works, and it costs: a search that triggers a recrawl went from 1.6s to 11s in these runs. On the sites where staleness hurts most it also does nothing, because the backend's own crawler is refused there and it falls back to cache without saying so. Paying seven seconds on every search to fix freshness on the subset of queries where it matters, except the ones where it cannot, is the wrong default. A conditional version needs a signal about the query that we do not have.

**The cached-versus-crawled flag is not free.** `statuses[]`, carrying `source: "cached" | "crawled"` per result, is returned by `/contents` and **not** by `/search`, which is the endpoint we call. A per-result freshness flag costs a second request per search.

## What is simply true about the backend

**Unknown request fields return 200.** Sending `totallyBogusFieldXyz: 5` inside `contents` produces a normal result set. A typo and a working parameter are indistinguishable from the status code, so anything added here needs a controlled before-and-after against a site known to change, not a green response. That is how the `maxAgeHours` table above was produced, and it is the only way to produce one.

**`contents.text.excludeSections` exists and is validated**, unlike the fields above — a single accepted value returns 200 and a guessed list returns 400. It could cut page furniture at the source rather than after. Its accepted vocabulary has not been established, so it is an experiment, not a change.

## The preamble claimed a freshness we never had

It asserted that results were "retrieved now". They are served from the backend's index. In the session above the excerpts carried `Get it by Mon, Jul 6` and `Valid through 7/7/2026` on August 31, none of the retail results carried a `publishedDate`, and the agent wrote "Price snapshot from Wayfair search on August 31, 2026" over four package totals.

The preamble now says the excerpt comes from the index rather than a fresh fetch, that it can be days or months out of date, that a date inside it says when the page was captured, and that prices, versions, and stock in particular want the source opened. Nothing else in the wrapper was pointing at the dates that were right there.

## Repeated text, measured properly

An earlier count put duplication at 36.7%, taken across a whole session. That number cannot be acted on: deduplication can only compare results **within one response**. Measured that way, over the same session's eleven searches:

| Threshold | Recovered |
| --- | --- |
| A line in 2 or more of a search's results | 13.4% |
| 3 or more | 9.9% |
| 4 or more | 6.9% |

It is concentrated rather than spread: the `site:`-scoped searches give up 37% at a threshold of three, and the diverse ones under 1% at any threshold. Six renderings of one template arrive with the same nav items, buttons and cross-sell blocks six times, and are charged for six times inside a budget that then cuts the substance.

Three sources is where the rule stops needing judgment. Two pages sharing a line is ordinary — a quoted price, a shared headline, a spec both list — and dropping one of those loses evidence to save a tenth of a percent. Three independent pages carrying a byte-identical line is a template. The dedupe runs before the fair-share budget, so what it reclaims is redistributed to the text that survives rather than being cut later.

## What to take from it

- **Read the whole response before designing around what you forward.** The fields that closed this failure were present, free, and had been arriving for as long as the endpoint has existed.
- **A response schema is a policy decision.** A `looseObject` picking five fields silently defines what every downstream agent can do, and nothing about it reads as a restriction at the call site.
- **When a wrapper makes a claim about the content it wraps, that claim has to be true.** "Retrieved now" cost more than saying nothing, because it told the model not to look at the dates in front of it.
- **Measure at the scope the fix can act on.** A duplication figure gathered across a session is not the figure a within-response dedupe can recover, and the difference here was almost four times.
