# Plan: parse markdown a block at a time

Status: proposed, not started. The measurements behind it are done and recorded below; the four things it breaks are known and each was reproduced rather than guessed. Depends on nothing, and does not replace `patches/micromark-extension-gfm-table@2.1.1.patch` — the two cover different halves of the same cost, and the reason is in "What this does not fix".

---

## Background / why

[`Markdown`](../../../apps/studio/src/client/components/markdown.tsx) hands react-markdown the whole message on every render, and react-markdown re-parses whatever it is handed. A streaming turn re-renders once per chunk, so a reply that arrives in five hundred chunks is parsed five hundred times, each time from the beginning. The cost of one parse grows with the message, and the number of parses grows with the message, so the turn's total parse cost grows with its square.

Measured on the real pipeline (`remark-parse` + `remark-gfm` + `remark-breaks` + `remark-rehype` + `rehype-slug`, with the table patch in place), replaying a reply of prose, lists, fences and small tables in 120-byte chunks:

| Reply | Chunks | Reparsed whole | Reparsed tail only |
| --- | --- | --- | --- |
| 8 KB | 68 | 330 ms | 37 ms |
| 16 KB | 138 | 1,139 ms | 73 ms |
| 32 KB | 273 | 7,137 ms | 243 ms |
| 64 KB | 547 | 20,431 ms | 925 ms |

The left column is what the app does now. It quadruples for every doubling of the reply, which is the signature of the square, and by 32 KB it is seven seconds of parsing spread across a turn that should feel continuous. The right column is what this plan does instead, and most of what is left in it is re-lexing the whole text on every chunk rather than parsing.

That is the same shape as the two costs in [markdown that is mostly tables](../../findings/markdown-that-is-mostly-tables.md), and this is the third instance of it: a pass over everything, repeated once per thing.

## Key insight

**A block is the unit that settles.** Markdown's block structure is decided by blank lines and openers, and once a block is closed nothing later in the document changes it. A paragraph three paragraphs back cannot be reinterpreted by the next token to arrive. So a message that has grown by 120 bytes has exactly one block that could have changed — the last one — and everything before it is already correct.

**Splitting is cheap, and by a different parser.** `marked`'s lexer takes 32 ms over the 1.97 MB file where the unified pipeline takes 676 ms, and it gives back tokens carrying their own `raw` source. It is not being asked to render anything or to agree with micromark about anything subtle; it is being asked where the blank lines are. Vercel's `streamdown` (v2.6.0) is built exactly this way — `marked` for the split, `unified` for everything after it — which is a useful signal that the seam holds up in production, since it is the renderer most of the AI-SDK ecosystem is standardizing on.

**Each block parses in its own pipeline run.** The whole-document costs collapse to per-block costs, and the memoized block components mean a settled block is neither reparsed nor rebuilt into React elements.

## What breaks, and what answers it

Four things, each reproduced against the real pipeline by parsing whole and per-block and diffing the HTML. Three are real; one is an artifact of testing with strings.

**Footnotes break completely.** `A claim.[^1]` with `[^1]: The source.` three blocks later renders as the literal text `A claim.[^1]`, and the definition block renders as nothing. The reference and its definition have to be in one parser run.

**Link reference definitions break completely.** `See [the docs][d].` with `[d]: https://example.test` at the bottom renders as literal `[the docs][d]`. Same cause.

> Both are answered the same way: a document containing a footnote or link-reference definition is parsed whole. Detecting one is a regex over the source, done once, next to the `containsMathSyntax` and `rawHtmlPattern` checks that already gate the optional plugins. These are rare in model output and rarer still in long model output, so the fallback costs the feature nothing in the case it exists for.

**Heading ids stop deduplicating.** Two `## Setup` headings in one document get `setup` and `setup-1` when parsed whole, and `setup` twice when parsed per block, because `rehype-slug` builds a fresh `github-slugger` per run. Every duplicate heading becomes a hash link that goes to the wrong place, and [`useHashLinkScroll`](../../../apps/studio/src/client/hooks/use-hash-link-scroll.ts) is what would take a reader there. Answered by deriving the ids once from the whole source — headings are cheap to find and the `marked` token stream already has them — and handing each block the ids its headings should carry, in place of `rehype-slug`'s own pass.

**HTML spanning blocks stops nesting.** A `<details>` opened in one block and closed three blocks later concatenates correctly as an HTML *string*, which is why a naive test says this case passes. It does not survive being rendered: each block is its own React subtree, so the `<details>` cannot wrap a paragraph that is a sibling of it. `streamdown` handles this by merging consecutive html tokens until the tags balance, and the same merge belongs here. Worth writing tests for before the merge rather than after.

## Phases

**1. The splitter, behind nothing.** A `splitBlocks(source)` in `client/lib/`, wrapping `marked`'s `Lexer.lex(source, {gfm: true})`, returning `string[]`. It merges unbalanced html tokens, and returns a single-element array for any document carrying a footnote or link-reference definition. Unit-testable in the node project with no React at all, which is where the merge rules and the fallback want to be pinned.

This adds `marked` to the renderer's bundle, which is the one cost of the plan rather than a saving. It is a renderer-only dependency and so a `devDependency` (see [AGENTS.md](../../../apps/studio/AGENTS.md)), and only its lexer is reached, so what actually lands is what the bundler keeps of it. Worth measuring rather than assuming, and worth knowing before phase 1 that the alternative — deriving block boundaries from micromark's own event stream — buys the bundle back at the cost of writing the one part of this that a maintained library already does correctly.

**2. Heading ids at document scope.** Replace `rehype-slug` with a pass fed the ids computed once for the whole source. Testable against the current renderer before any splitting happens: same document, same ids, including the duplicates.

**3. `Markdown` renders blocks.** A memoized `MarkdownBlock` per block, keyed by index. Index keys are right here rather than a compromise: only the tail block is unstable, so an index that shifts is an index whose content changed anyway. The plugin decision (`needsMath`, `needsRawHtml`) stays at document scope and every block gets the same list, so a document with one formula does not make 89 separate decisions.

**4. Only the tail streams.** `isStreaming` becomes a property of the last block rather than the message, which is what makes `remend` and `rehypeAnimateWords` stop running over settled text. Both are per-render passes over everything they are handed, and `remend` is itself quadratic, so this is the phase that collects most of the win. The behavior to watch: a block that settles drops its `data-stream-word` spans and re-renders, and words already faded in must not flicker.

**5. Progressive first paint, for the document viewer.** Once blocks are separate components, the viewer can mount the first screenful and fill the rest in on idle callbacks. This is the phase that addresses what is left of the 2.7 s open on a 2 MB file, which is React building 51,600 elements and not the parse. Separable from everything above, and worth doing only if the open still reads as slow once phases 1-4 have landed.

## What this does not fix

**A single enormous table.** One table is one block, so a 12,000-row table is parsed in one run and the edit map inside it grows exactly as before. That is the case the micromark patch covers, and it is why both exist: splitting bounds the cost *across* a document's blocks, the patch bounds it *within* one. A document of 89 tables is fixed by either; a document that is one huge table is fixed only by the patch.

**The file viewer's open time**, until phase 5. Splitting a static 2 MB file costs about what parsing it whole costs now that the patch is in, because nothing is memoized on a first render. The streaming path is where phases 1-4 pay.

## How to tell whether it works

The harness for the table above is the honest test and is worth keeping: replay a reply in chunks, count total parse time, assert it is linear in reply length rather than quadratic. It is a node test, needs no DOM, and would have caught the current behavior.

Correctness is the diff, not the timing: parse a corpus whole and per-block and require identical hast. Seed it with the nine cases already written for this — duplicate headings, footnote, link reference definition, html across a blank line, setext heading, list then paragraph, table, lazy continuation, indented code after a list — and add to it whenever a merge rule changes. The three that currently differ are the specification for phases 1 and 2: they must be identical when those phases are done.

Then a real turn in the app, on a model that writes long replies with tables in them, watching for the two things a diff cannot see: whether the word fade still reads as one continuous stream across a block boundary, and whether a table's controls still place themselves when the table is the tail block and still growing.
