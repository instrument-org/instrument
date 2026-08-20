# Every tool-output budget counts characters, and moving them to tokens buys less than it looks like

**Status:** open question, nothing planned. Raised while reviewing the tool-result context budgets work, which named "character budgets are only token approximations" as a risk and left it there.

## What we count today

Every limit on what a tool puts in front of the model is a size in characters or bytes. None of them is a token count.

| Limit | Value | Unit | Where |
|---|---|---|---|
| `bash` head + tail | 10 KB + 10 KB, 2000 lines | bytes | [truncate-buffer.ts](../../packages/workspace/src/lib/truncate-buffer.ts) |
| `web_fetch` page text | 50,000 | UTF-16 code units | [web-fetch.ts](../../packages/workspace/src/tools/web-fetch.ts) |
| `read_file` text | 50 KB, 2000 lines, 2000 per line | bytes and code units | [read-file.ts](../../packages/workspace/src/tools/read-file.ts) |
| Inlined skill body | 40,000 | UTF-16 code units | [skills.ts](../../packages/workspace/src/lib/skills.ts) |
| Skill catalog | 8,000 | UTF-16 code units | [skill-catalog.ts](../../packages/workspace/src/lib/skill-catalog.ts) |
| Project instructions | 20,000 | UTF-16 code units | [constants.ts](../../packages/workspace/src/constants.ts) |

Two of the six already disagree on the unit: `bash` and `read_file` cap bytes, the rest cap `String.length`. Both existing comments justify the choice the same way, that no tokenizer is right for every provider we run against and roughly four characters to the token is close enough to size a budget by. The skill catalog comment goes further and says to switch to a token budget once model metadata carries a context length.

## How wrong the proxy actually is

Measured with a real BPE tokenizer (`o200k_base`, cross-checked against `cl100k_base`) over content of the kinds these tools return: real fetched page markdown, repo prose and TypeScript, `git log --stat` and `ls -laR` output, JSON, YAML, and Japanese prose.

| Content | chars/token |
|---|---|
| Japanese prose | 1.49 |
| `ls -laR` output | 2.32 |
| YAML config | 2.89 |
| `package.json` | 2.92 |
| Pretty-printed JSON | 3.24 |
| Web page as markdown | 3.58 |
| `git log --stat` | 3.77 |
| TypeScript source | 4.33 to 4.48 |
| Repo prose markdown | 4.72 |

Read against the nominal four characters per token, a fixed character budget delivers between 0.85x and 1.71x the tokens it implies for anything Latin-script, and about 2.7x for CJK. Concretely, 16,000 characters is 3,372 tokens of prose and 6,834 tokens of directory listing.

These counts come from OpenAI tokenizers, so they are an upper bound on characters per token. Anthropic's tokenizer counts the same text roughly 15 to 20% higher on prose and more on code, which pushes every ratio above further down.

## Why moving to tokens does not remove the variance

**There is no offline tokenizer that is right for the model the next request goes to.** We route across families through OpenRouter. Anthropic's exact count is a network round trip to `POST /v1/messages/count_tokens` and is model-specific. Using OpenAI's tokenizer for a Claude request is documented as wrong by 15 to 20% on prose and worse on code. So in practice "token budget" means "estimated token budget."

**Tokenizers move within a family.** Opus 4.7 introduced a tokenizer that counts the same text at roughly 1x to 1.35x its predecessor. Sonnet 5 counts about 30% more tokens than Sonnet 4.6 for identical input at unchanged per-token pricing. A token constant therefore needs re-baselining per model release. A character constant does not, because it never claimed to be a token count.

**The budget runs on the hot path of every request.** `toModelOutput` and [prepare-model-messages.ts](../../packages/workspace/src/lib/prepare-model-messages.ts) run on every turn and on every replay of an existing session. A per-call network round trip is not available there. An estimator is the only shape that fits.

**The estimator we already ship halves the error rather than removing it.** `tokenx`'s `estimateTokenCount` is a dependency of `@instrument-org/workspace` today, used in [validate-skill.ts](../../packages/workspace/src/lib/validate-skill.ts) for author-facing stats, never for control flow. Measured against the real tokenizer on the same corpus: within 5% on source and JSON, +18.5% on repo prose, and -22.7% on the dense directory listing, which is exactly the content class where characters over-count worst. It converts a 2x content-driven spread into roughly a plus or minus 20% band.

**A model-specific budget breaks a property we currently have.** Character budgets are pure integer math over message content, so a session serializes to identical bytes every turn regardless of which model runs next. Sizing the budget per model means the same recorded session clips differently depending on the model in use, which rewrites the cached prefix on a model switch and makes cross-model replay non-identical. An estimator keeps determinism only as long as it stays model-independent, at which point it is a better constant rather than a token count.

**Cutting on a token boundary is a different operation.** `truncateWithoutSplitting` exists to guarantee no lone surrogate survives a cut. An estimator returns a number, not a boundary, so the slice would still happen by character index. What a token budget would actually change is the number in the constant, not how the cut is made.

## Where token counting does belong

The context-fit path, where the comparison is against the model's real window rather than against a constant we chose. [Context compaction](../plans/active/context-compaction.md) already answers it and answers it without an estimator: read the last assistant message's reported `metadata.usage` and compare against a `contextLength` carried through the model schema. Reported usage is exact, free, per-model, and already persisted. The accurate-token problem is solved by measuring after the fact, not by estimating before it.

## Assessment

Not worth changing for the per-call caps. The caps sit well above ordinary usage, so the proxy error rarely decides anything, and every candidate replacement adds a network dependency, per-model drift, or its own 20% error. Two cheaper moves if it ever matters:

- **CJK is the one class where the proxy is genuinely wrong**, at 1.49 characters per token against 4.72 for prose. A budget sized for English prose gives CJK retrieval roughly a third of the tokens it implies. `tokenx` corrects most of that specific gap; a character constant cannot.
- **Make the constants honest rather than accurate.** Naming the implied token cost per content class next to each constant costs nothing and stops the next reader from treating 16,000 as a token figure.

## Related

- [Context compaction](../plans/active/context-compaction.md) owns the window-relative budget and the reported-usage path.
- [Tool result context budgets](../plans/completed/tool-result-context-budgets.md) is where the question was raised and deferred.
