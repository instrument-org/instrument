# Plan: parse markdown a block at a time

Status: proposed, not started. The measurements behind it are done and recorded below; the four things it breaks are known and each was reproduced rather than guessed. Buying it instead of building it was spiked against streamdown 2.6.0 rather than argued about, and is written up in "The alternative: migrate to Streamdown instead", which recommends against on the grounds that it has not solved the two parts nobody wants to own either. Depends on nothing, and does not replace `patches/micromark-extension-gfm-table@2.1.1.patch` — the two cover different halves of the same cost, and the reason is in "What this does not fix".

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
> That is the blunt answer, and there is a better one: Streamdown resolves footnotes while splitting, and only link reference definitions defeat it. Whatever it does there is worth reading before settling for the fallback, since a document that carries one footnote should not lose the split for the whole of its length.

**Heading ids stop deduplicating.** Two `## Setup` headings in one document get `setup` and `setup-1` when parsed whole, and `setup` twice when parsed per block, because `rehype-slug` builds a fresh `github-slugger` per run. Every duplicate heading becomes a hash link that goes to the wrong place, and [`useHashLinkScroll`](../../../apps/studio/src/client/hooks/use-hash-link-scroll.ts) is what would take a reader there. Answered by deriving the ids once from the whole source — headings are cheap to find and the `marked` token stream already has them — and handing each block the ids its headings should carry, in place of `rehype-slug`'s own pass.

**HTML spanning blocks stops nesting.** A `<details>` opened in one block and closed three blocks later concatenates correctly as an HTML *string*, which is why a naive test says this case passes. It does not survive being rendered: each block is its own React subtree, so the `<details>` cannot wrap a paragraph that is a sibling of it. `streamdown` handles this by merging consecutive html tokens until the tags balance, and the same merge belongs here. Worth writing tests for before the merge rather than after.

## Phases

**1. The splitter, behind nothing.** A `splitBlocks(source)` in `client/lib/`, wrapping `marked`'s `Lexer.lex(source, {gfm: true})`, returning `string[]`. It merges unbalanced html tokens, and returns a single-element array for any document carrying a footnote or link-reference definition. Unit-testable in the node project with no React at all, which is where the merge rules and the fallback want to be pinned.

**The splitter may lex and must never parse.** `marked` carries a quadratic of its own, in `Marked.prototype.walkTokens`, which accumulates with `concat` once per token and re-concats each recursive result into its parent's array. It runs whenever any extension registers a `walkTokens` hook, which the alert and footnote plugins both do, and it is not small: a *no-op* `walkTokens` takes the 1.97 MB file from 37 ms to 811 ms. Measured against the shape this plan actually uses:

| | 1.97 MB |
| --- | --- |
| `Lexer.lex`, GFM on | 32 ms |
| `marked.parse` → HTML | 37 ms |
| a `Marked` instance with a no-op `walkTokens`, `.parse` | 811 ms |
| the same instance, `.lexer` | 35 ms |
| `Lexer.lex` after a global `marked.use({walkTokens})` | 33 ms |

So lexing is untouched: the hook runs only in `parse`, and a global `marked.use` does not leak into the static lexer. The rule that follows is worth keeping even though nothing violates it today — the splitter calls `Lexer.lex` and nothing else, and the day someone reaches for `marked.parse` or registers an extension to get a feature out of it, the split becomes more expensive than the parse it was added to avoid. Found by the session working on `index-app`, which renders with `marked` and hit it head-on.

This adds `marked` to the renderer's bundle, which is the one cost of the plan rather than a saving. It is a renderer-only dependency and so a `devDependency` (see [AGENTS.md](../../../apps/studio/AGENTS.md)), and only its lexer is reached, so what actually lands is what the bundler keeps of it. Worth measuring rather than assuming, and worth knowing before phase 1 that the alternative — deriving block boundaries from micromark's own event stream — buys the bundle back at the cost of writing the one part of this that a maintained library already does correctly.

**2. Heading ids at document scope.** Replace `rehype-slug` with a pass fed the ids computed once for the whole source. Testable against the current renderer before any splitting happens: same document, same ids, including the duplicates.

**3. `Markdown` renders blocks.** A memoized `MarkdownBlock` per block, keyed by index. Index keys are right here rather than a compromise: only the tail block is unstable, so an index that shifts is an index whose content changed anyway. The plugin decision (`needsMath`, `needsRawHtml`) stays at document scope and every block gets the same list, so a document with one formula does not make 89 separate decisions.

**4. Only the tail streams.** `isStreaming` becomes a property of the last block rather than the message, which is what makes `remend` and `rehypeAnimateWords` stop running over settled text. Both are per-render passes over everything they are handed, and `remend` is itself quadratic, so this is the phase that collects most of the win. The behavior to watch: a block that settles drops its `data-stream-word` spans and re-renders, and words already faded in must not flicker.

**5. Progressive first paint, for the document viewer.** Once blocks are separate components, the viewer can mount the first screenful and fill the rest in on idle callbacks. This is the phase that addresses what is left of the 2.7 s open on a 2 MB file, which is React building 51,600 elements and not the parse. Separable from everything above, and worth doing only if the open still reads as slow once phases 1-4 have landed.

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

## How to tell whether it works

The harness for the table above is the honest test and is worth keeping: replay a reply in chunks, count total parse time, assert it is linear in reply length rather than quadratic. It is a node test, needs no DOM, and would have caught the current behavior.

Correctness is the diff, not the timing: parse a corpus whole and per-block and require identical hast. Seed it with the nine cases already written for this — duplicate headings, footnote, link reference definition, html across a blank line, setext heading, list then paragraph, table, lazy continuation, indented code after a list — and add to it whenever a merge rule changes. The three that currently differ are the specification for phases 1 and 2: they must be identical when those phases are done.

Then a real turn in the app, on a model that writes long replies with tables in them, watching for the two things a diff cannot see: whether the word fade still reads as one continuous stream across a block boundary, and whether a table's controls still place themselves when the table is the tail block and still growing.
