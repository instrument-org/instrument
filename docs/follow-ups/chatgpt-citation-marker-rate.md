# Whether ChatGPT citation markers have become common enough to strip

**Status:** open · **Check after:** 2026-11-21 · **Last checked:** 2026-10-24

## What we're waiting to learn

OpenAI models sometimes leave private-use citation markers in replies, which show up as stray characters. [`chatgpt-citation-markers-in-model-output.md`](../findings/chatgpt-citation-markers-in-model-output.md) decided not to strip them yet, with a working filter parked, and named what would change that: the rate climbing above about one turn in ten among chats that searched, or a hidden-content span appearing.

## The signal

Characters U+E200 to U+E20F in assistant text parts, counted over sessions that searched the web (sessions with `source-url` parts or a web search call). Separately, U+E203 or U+E204, the hidden-content span. Write the scan with `\u` escapes, and check that it matches a real marker before trusting a zero.

## Where to look

The primary Mac's workspace records (`.instrument/chats/*/*.jsonl`), read-only.

## What each answer means

- **More than one turn in ten among searching sessions:** revive the parked filter.
- **Any U+E203/U+E204 span:** revive it whatever the rate, since hidden content could reach the reader.
- **Rare, as before:** move the date out. Close it if OpenRouter is seen normalizing the markers.

## Result so far

2026-10-24: one text part in 2,624 carried a marker, and none had a hidden span. Only 4 sessions in the converted records searched, too few for a rate.
