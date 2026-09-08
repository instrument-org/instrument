# Plan: parse markdown a block at a time

Status: built on `spike/block-split-markdown`, for review before it lands. The splitting, the block rendering and the streaming scope are done and measured; progressive first paint (the last phase) is not started and is separable. The design changed while it was being built, in the direction that removes most of the risk: **splitting happens only while the text is still arriving**, so a settled message and every document in the file viewer parse exactly as they always did. That is what made the heading-id phase unnecessary — see "Phases, and what changed". Buying it instead was spiked against streamdown 2.6.0 rather than argued about, and is written up in "The alternative: migrate to Streamdown instead". Does not replace `patches/micromark-extension-gfm-table@2.1.1.patch` — the two cover different halves of the same cost, and the reason is in "What this does not fix".

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
>
> That is the blunt answer, and reading Streamdown's splitter for a better one found that it does exactly the same thing: a footnote anywhere in the document and the whole of it comes back as a single block. There is no cleverer answer in the field to borrow.

## Phases, and what changed

**1. The splitter.** `client/lib/split-markdown-blocks.ts`. It lexes and never parses; the table in that file records why, and a comment in it carries the rule. A footnote or a link reference definition anywhere in the document returns the whole of it as one block. A run of raw HTML is held together until its tags balance — counted per unclosed opening rather than per run, which is a bug in the implementation it was learned from: a block opening `<div><div>` and closing neither ends at the first `</div>`, and everything after it falls out of the outer element. Tested from both ends, which is what caught that: the blocks rejoin into the source byte for byte, and each block rendered alone builds the same tree as the whole document over sixteen documents, with the HTML parser both on and off.

**2. Heading ids at document scope — dropped, not needed.** The original plan was to derive them once for the whole document, because `rehype-slug` builds a fresh slugger per parse and would stop deduplicating. Splitting only while the text is arriving removes the problem instead: a settled message is one parse again, so its ids are what they always were, and nobody is following an anchor into a message that is still being written. Streamdown, which does not stop splitting, has this defect — six `## Setup` headings all take `id="setup"` there.

**3. Block rendering.** `Markdown` maps its blocks onto a memoized `MarkdownBlock`. Every prop it takes has to stay referentially stable for that to hold, which is what the `useMemo`s around the components map and the plugin lists are for; the component's own comments say so, since a later edit that inlines one of them silently turns the whole thing off.

**4. Streaming scope.** `remend` runs on the last block alone, since it repairs what the text stops in the middle of and only the last block can be stopped in the middle of anything. The word fade deliberately did **not** move to the last block: a block that lost its spans as the next one opened would drop whatever words were mid-fade to full opacity, and a memoized block pays for the plugin once either way.

**5. Progressive first paint — not started.** Mount the first screenful of a large document and fill the rest in on idle. This is the phase that would address the file viewer's 2.7 s open, which is React building 51,600 elements rather than parsing. Separable from everything above, and worth doing only if that open still reads as slow.

## What this does not fix

**A single enormous table.** One table is one block, so a 12,000-row table is parsed in one run and the edit map inside it grows exactly as before. That is the case the micromark patch covers, and it is why both exist: splitting bounds the cost *across* a document's blocks, the patch bounds it *within* one. A document of 89 tables is fixed by either; a document that is one huge table is fixed only by the patch.

**The file viewer's open time**, until phase 5. Splitting a static 2 MB file costs about what parsing it whole costs now that the patch is in, because nothing is memoized on a first render. The streaming path is where phases 1-4 pay.

## The alternative: migrate to Streamdown instead

Everything in the five phases above already exists, built and maintained, in [Streamdown](https://github.com/vercel/streamdown) — Vercel's React markdown renderer for model output, Apache-2.0, 110 KB unpacked, React 18/19 peer, v2.6.0 published three weeks before this was written and pushed the day before. Block splitting, per-block memoization, `remend` wired to the tail alone, the word-fade animation, a `static` / `streaming` mode, and handling for a code fence or an HTML tag that has not finished arriving. It is also not a stranger: `remend` is one of its packages, so we are already on part of its stack.

Its prop type is a superset of react-markdown's, reimplemented locally rather than imported but the same shape — `components`, `remarkPlugins`, `rehypePlugins`, `urlTransform`, `allowElement`, `allowedElements`, `skipHtml`. Caller components merge shallowly over its own (`{...defaultComponents, ...userComponents}`), so every override in [markdown.tsx](../../../apps/studio/src/client/components/markdown.tsx) transfers rather than being fought. It even exposes `parseMarkdownIntoBlocksFn`, so the split itself stays swappable. On the API alone this is a plausible afternoon.

**The mismatch is not the API, it is what the library is for.** Its own migration guide tells you to delete your custom components, delete your code block and mermaid components, strip your `prose` classes, and remove your memo wrappers, because all of that is prestyled and built in. That instruction is right for most callers and inverted for us: the components it wants to give us are the ones we have spent the most on and would immediately turn off.

- `MarkdownTable` — the transcript-spanning bleed, the lead spacer, the scroll fades, copy / copy-row / expand, the expand modal, and the wrap-at-cap rule. Streamdown has its own table with `tableMaxHeight` and `controls`.
- `MarkdownCodeBlock`, which highlights through a main-process RPC, against `@streamdown/code`'s Shiki in the renderer.
- `InlineLink`'s origin disclosure and `shell.openExternal`, against `linkSafety`'s confirmation modal, which is on by default and is a different answer to the same question.
- The image policy, the task-file chips and their drag and context menu, the `files` fence, and the mermaid prefetch, none of which it has an equivalent for.

### What a spike found

Measured against streamdown 2.6.0 by rendering through `renderToStaticMarkup`, which exercises the split and the render but not the client-side animation.

**The plumbing transfers.** Custom components receive `node`, with `children` carrying `tagName`, so `markdownPre`'s fence reader, `markdownParagraph`'s section-label check and `markdownOrderedList`'s item count all work unchanged. Overrides for `pre`, `p`, `ol`, `a`, `code` and `table` replace the built-ins rather than wrapping them. `img` reaches ours too, but only once we pass our own rehype plugins; under their defaults an image is intercepted before the component map and rendered as their blocked-image chip.

**Every element we do not override arrives pre-styled**, with Tailwind utilities inline: `<h2 class="mt-6 mb-2 font-semibold text-2xl" data-streamdown="heading-2">`, `<li class="py-1">`, and a wrapper carrying `space-y-4 whitespace-normal`. Not a stylesheet we can decline to import — it is in the markup. Living with `prose-custom` means overriding the rest of the element set too, which is the prestyling turned back off one tag at a time.

**Supplying rehype plugins does not merely hand sanitization back to us, it turns off the escaping as well.** Rendering markdown carrying an event handler, an `onerror` image, an iframe and a `javascript:` link:

| rehypePlugins | `onclick` | `onerror` | `<iframe>` | `javascript:` |
| --- | --- | --- | --- | --- |
| none — their defaults | stripped | stripped | stripped | stripped |
| `[rehypeSlug]` | **renders** | **renders** | stripped | **renders** |
| `[rehypeRaw, rehypeSanitize, rehypeSlug]` | stripped | stripped | stripped | stripped |

`rehype-slug` is the minimum we need, so the middle row is the configuration a migration lands on by default. The failure is silent and it is not the one the docs imply: raw HTML is not escaped either, so a model-authored `<span onclick>` executes. Our current pipeline loads `rehype-raw` only for documents whose HTML we detect, on the reasoning that without it HTML is inert; under Streamdown that reasoning inverts and `rehype-raw` plus `rehype-sanitize` would have to run over every document, always — which is the one thing `markdown.tsx` deliberately avoids, since the HTML parser is the largest bundle it can pull in.

**And it has two of the same four breakages.** Rendering each case in `static` and `streaming` mode and diffing:

| | Streamdown streaming |
| --- | --- |
| Footnotes | resolves |
| HTML across a blank line | merges correctly |
| Link reference definitions | **breaks** — `See [the docs][d].` renders literally, where static resolves it |
| Heading id dedupe | **breaks** — six `## Setup` headings all get `id="setup"`, where static gives `setup`, `setup-1`, … |

The heading one is invisible until you ask for it: their headings carry no `id` at all by default, so nothing looks wrong until `rehype-slug` goes in, and then it is wrong only while streaming.

**Recommendation: build phases 1-4.** The reason is narrower than "not invented here". The work nobody wants to own — deduplicating heading ids across a split, and keeping link reference definitions resolvable — is work Streamdown has not done either. Adopting it would leave both of those to us anyway, in a codebase where the fix is a pull request rather than an edit, and would add the sanitization inversion and the prestyling to the pile. What it would genuinely save is the splitter and its merge rules, which is the smallest and most testable part of this plan.

The judgment to revisit: if we ever want the *whole* surface — their table, their code block, their link handling, their styling — the calculus flips, because then the overrides stop being the point and the library is doing the job it was built for. That is a product decision about how much of the chat's look we want to own, not a performance one. Their `lib/parse-blocks.tsx` and `lib/block-incomplete-context.ts` are worth reading either way: they are the accumulated answer to streaming edge cases we would otherwise meet one bug report at a time, and the license invites it. Borrow the reasoning; describe it in our own terms in the code.

## What it actually cost, measured

The parse-only projection at the top of this plan was optimistic about what would reach the reader, so here is the same question asked through the real component: a reply replayed in 240-byte chunks, counting the blocking main-thread work rather than wall clock — React's own render time from the profiler, plus the lex the split costs.

| Reply | Chunks | Whole document | Split | Per chunk |
| --- | --- | --- | --- | --- |
| 8 KB | 34 | 428 ms | 190 ms | 12.6 → 5.6 ms |
| 16 KB | 68 | 1,277 ms | 543 ms | 18.8 → 8.0 ms |
| 32 KB | 137 | 5,185 ms | 1,510 ms | 37.8 → 11.0 ms |

Read it as a change of constant rather than of shape. The whole-document column quadruples for every doubling; the split column roughly triples, so it is still superlinear — the lex reads the whole text on every chunk, and React still reconciles one child per block. What moved is the size: 37.8 ms of blocking work per chunk is more than two frames of jank and 11 ms is under one, and the advantage widens from 2.2x to 3.4x across that range and keeps going.

Wall clock does not move in that harness, and that is worth knowing before anyone re-runs it and concludes nothing happened. Re-rendering 137 times as fast as the loop can go leaves the browser laying out a DOM of tens of thousands of nodes with no frame budget, which dominates and is identical either way. In a turn, chunks arrive at network pace and what a reader feels is the work that blocks the frame in between.

Two things left on the table, both cheap and neither done: the lex could start from the last settled block boundary instead of the top, and the reconciliation could be bounded by rendering only the blocks near the viewport.

## How to tell whether it works

Correctness is a diff, not a timing. `split-markdown-blocks.test.ts` renders sixteen documents whole and per block and requires the same tree, with the HTML parser on and off, and separately requires the blocks to rejoin into the source byte for byte. The pair is what makes the whitespace normalization in it honest: one covers the bytes, the other covers the tree. `markdown.test.tsx` asks the same of the component — the same document drawn streaming and settled has to yield the same elements and the same text.

The measurement above is a throwaway harness rather than a test, deliberately: a timing assertion in CI is a flake. It is a `Profiler` around the component, a loop that re-renders with a growing slice, and a sum of `actualDuration`; rebuilding it takes ten minutes and the numbers to beat are in the table.

What no test covers, and wants a real turn in the app on a model that writes long replies with tables in them: whether the word fade still reads as one continuous stream across a block boundary, and whether a table's controls still place themselves while the table is the block still growing.
