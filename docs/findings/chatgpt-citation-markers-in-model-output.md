# OpenAI models cite our search results in ChatGPT's private-use encoding, and the fix costs more than the bug

**Status:** known, deliberately not fixed. A working implementation is parked on the `spike/citation-marker-strip` branch. Revisit if the rate climbs or OpenRouter declines to normalize it.

## What shows up

An assistant reply ends a sentence with unrenderable characters and a run of visible junk:

```
Apple documents launchd as the preferred way to run timed background jobs. citeturn1search1turn2search0
```

The raw text is a private-use span, written here as escapes because editors and shell heredocs silently drop the characters themselves:

```
\u{E200}cite\u{E202}turn1search1\u{E202}turn2search0\u{E201}
```

`U+E200` opens a reference span, `U+E202` separates the type from each reference, `U+E201` closes it. `U+E203` and `U+E204` wrap content meant to stay hidden. ChatGPT's own renderer swaps these spans for source chips. Nothing else resolves them, so the delimiters land as missing glyphs and the payload reads as prose.

Only `U+E200` through `U+E20F` belongs to this encoding. The rest of the private-use area carries real content that has to survive, including `U+F8FF`, the Apple logo, which arrives legitimately in text quoted from an Apple support page.

## Where it comes from

Post-training on ChatGPT's search stack, not from anything in our prompt or our gateway. The convention is baked in deeply enough that an OpenAI-family model reaches for it against *any* search tool. In the observed case the model was using our own `web_search` tool, whose results carry no such identifiers, and system-prompt rules are widely reported not to suppress it.

The references are not noise. `turn<n>` is the ordinal of the search call within the session and `search<m>` is the zero-indexed result within it, and every reference in the observed reply resolved to the correct URL from our own result list. The model's citation intent is right; only the output encoding is wrong.

Corroboration that this is upstream and not ours:

- [Streamed web_search citations leaking citation markers into text output](https://community.openai.com/t/streamed-web-search-citations-leaking-citation-markers-into-text-output/1390157)
- [Unexpected citation markers appearing in text output when using File Search](https://community.openai.com/t/unexpected-citation-markers-appearing-in-text-output-when-using-file-search/1362380)
- [Links to sources when using Web Search + GPT-5](https://github.com/danny-avila/LibreChat/discussions/9127), the same artifact against a custom (non-OpenAI) search tool
- [Private unicode control characters in OpenAI conversations](https://github.com/sanand0/openai-conversations/blob/main/private-unicode-control-characters.md), which documents the full character set

## How often it happens

Measured across every local task database, counting only tasks that actually invoked `web_search` rather than merely carrying the tool in their system context:

| Scope | Tasks that ran a search | Carried markers |
|---|---|---|
| All time | 40 | 1 |

One occurrence. Related variants exist in the wild that we have never seen here: `filecite`, `navlist`, `videoturn`, and the bracketed form.

Anyone re-measuring this should write the scan to a file using `\u` escapes rather than pasting the characters into a shell heredoc, and assert that the character class still matches a real marker before trusting the count. Two attempts at this measurement silently reported hyphen matches instead, because the heredoc stripped the private-use characters and left the character class reading as a literal `-`.

## Why nothing shipped

The encoding is unambiguous, so stripping it is easy to get right in isolation. The problem is where the code has to live. A citation span is around thirty characters and the provider splits deltas wherever it likes, so a span routinely straddles a delta boundary and a per-delta strip matches nothing. Catching it means buffering text mid-stream, which puts code in front of every streamed character of every response from every model, to clean up an artifact seen on one turn in forty.

That trade is bad on its own, and the first implementation demonstrated why. To catch a stream cut mid-reference, its residue pattern matched `turn` followed by digits without requiring a type prefix, and the non-streaming path ran that over every model's output. It deleted reference-shaped tokens from ordinary content:

```
"The state machine has turn0 and turn1 states."  ->  "The state machine has and states."
"for (const turn0 of turns) { rename turn2 }"    ->  "for (const of turns) { rename }"
```

Silently eating a real token out of a user's prose or code is worse than the cosmetic artifact being fixed. The parked branch requires the `cite` prefix so `citeturn0` matches and a bare `turn0` never does, and carries regression tests for the cases above. The residual cost is that a reference arriving bare on both ends survives, which is the correct trade.

## What is on the branch

`spike/citation-marker-strip` holds a `wrapLanguageModel` middleware shaped after the xAI Grok HTML-entity workaround that this repo carried from 2026-04-29 to 2026-05-28, with two departures worth keeping if it is revived:

- **Not gated on author or model id.** The Grok version gated on `author === "x-ai"`. That shape cannot work here, because the route where this bites is `instrument/auto`, whose author is our own and whose real model is chosen server-side. It can afford to be ungated because `U+E200` through `U+E20F` has no other use.
- **Buffered across deltas.** Text from the first marker character is held until the span closes, with a length cap so a stray marker cannot stall a stream. With no marker present the filter is one regex test per delta and holds nothing.

## What would change the decision

- The rate climbing above roughly one turn in ten among searching tasks.
- OpenRouter declining to normalize it. They fixed the analogous Grok HTML-entity issue about a month after it was reported, and that precedent is why waiting is reasonable. Note the case is weaker here: Grok's was a serialization bug on their side, while this is model behavior referencing tool results OpenRouter never sees, and a blanket strip at their layer would break anyone consuming these properly through annotations.
- Any variant appearing that carries semantic content rather than a citation, particularly the `U+E203`/`U+E204` hidden-content span, where passing the delimiters through while keeping the contents would surface text meant to stay hidden.

## Related

Resolving the references into real Markdown links, rather than deleting them, was considered and rejected at the same time. It is strictly better output, since a stripped reply leaves the claim with no source at all, but it cannot happen in the gateway middleware, which sees the stream and not the tool-result history. It belongs in the workspace agent loop, and one turn in forty does not justify it.
