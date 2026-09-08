# Markdown that is mostly tables

**Status:** fixed for the two quadratic costs. Parsing a 2 MB, 12,454-row markdown file took 22.9 s; the whole open now takes about 2.7 s of a dev build, nearly all of it React. Both causes were the same shape — a pass that walks the whole document once per item it finds — and neither was in our code. Measured 2026-09-08 on an M1 Max, against a downloads inventory the agent wrote: 1.97 MB, 89 tables, 12,454 rows, 24,552 backticks, no fences and no images.

## The two costs

Everything below is the parse. React's own work — 51,600 DOM elements — was never the problem, and is what is left.

| Stage, on the 1.97 MB file | Before | After |
| --- | --- | --- |
| `remark-parse` alone, no GFM | 276 ms | 276 ms |
| `remark-gfm` on top | 22,872 ms | 559 ms |
| `remend` (only reached on some documents) | 50 ms — 13,900 ms | 0 ms |
| mdast → hast | 140 ms | 140 ms |

### `micromark-extension-gfm-table` is quadratic in table cells

`EditMap.add` walked the whole list of edits recorded so far looking for one at the same index, and the resolver calls it once per cell. A document with _n_ cells therefore did _n²/2_ comparisons — 4 s at 500 KB, 22.9 s at 2 MB, doubling to roughly four times the cost each step. Nothing about it is per-table: 12,000 rows cost the same whether they sit in one table or a thousand.

The fix is an index. `patches/micromark-extension-gfm-table@2.1.1.patch` keeps a `Map` from index to change beside the array, so `add` is a lookup rather than a scan. Order is unchanged — the map is still sorted by index in `consume`, and there is one entry per index either way — and parsing the file, plus nine hand-written cases covering alignment, escaped pipes, ragged rows, blockquotes and lists, produces a byte-identical tree. 2 MB goes from 22,727 ms to 436 ms and the curve is linear again.

### `remend` runs on documents that have already arrived

`remend` closes constructs a streaming message stops in the middle of: an unterminated fence, a bold with only its opening `**`. It was called on every document, and several of its dozen passes scan from the start of the string for each occurrence they find — `isWithinMathBlock` is called once per `_` and is itself O(offset), so `node_modules` in twelve thousand paths is quadratic. A 0.93 MB synthetic file spent 13.9 s there.

That the real file spent only 50 ms is worse rather than better. It contains a single stray `[`, which the links handler turns into `…](streamdown:incomplete-link)` and returns early on — so the document was cheap only because it was being corrupted before any later pass could be slow. `Markdown` now calls `remend` when `isStreaming` and not otherwise, which is both the only case it is for and the only reading under which a file someone opened is shown as they wrote it.

## What is left, and what would move it

Opening the file is now about 2.7 s, essentially all of it React building 51,600 elements — the parse is 0.7 s of it. A production build is faster than the dev build these numbers come from, but the shape does not change: the cost is proportional to the DOM, so only rendering less of it would move it.

Resizing the window costs about 80 ms per width change with the file open. Roughly 25 ms of that is the browser sizing 89 tables: `.markdown-table-frame > table` is `width: max-content` held between a floor and a cap, so every cell is walked to find the intrinsic width, and again on every change of the width it is measured against. The rest is the observers and the frame. `MarkdownTable` no longer adds to it — its measurements were interleaved reads and writes, one forced layout per table, and they now run through a queue that measures the whole batch before writing any of it.

**`content-visibility: auto` on the scroll frame was tried and rejected.** It halves the open (1,387 ms against 2,690 ms, measured over four fresh opens each), because most tables are never laid out. It costs two things. Resizing gets worse rather than better — 114 ms a step against 82 ms, and one run measured 342 ms — and the scroll height is a lie until the document has been read through: the frames stand at a placeholder height, so a 735,632 px document reports 39,540 px and grows as it is scrolled. Sizing the placeholder from the row count (countable without laying anything out) narrows that to 527,090 px, which is a smaller lie rather than none. It also cannot go on `.markdown-table-row`: the paint containment that comes with it clips to the box, and the frame, the toolbar and the row control all deliberately stand outside the text column.

Real windowing is the honest version of that idea, and it is a different piece of work: find-in-page, anchors, and selecting the whole document all currently work across the file and would each need answering.

## Reading this back

The numbers above come from three harnesses, in order of what they can see:

- Node, against the real file, through the same plugin list `Markdown` builds. Isolates the parse and nothing else, and is where both quadratics were found.
- A throwaway Vitest browser test rendering `SessionMarkdown` over generated markdown of the same shape. Splits react-markdown's cost from the components' and from the stylesheet's, and separates a resize's layout from what the observers do about it. Not kept: a timing assertion in CI is a flake.
- The app, driven over CDP against a seeded workspace with the file copied into the task. The only one that measures what a person experiences, and the only one that disagreed with the other two about `content-visibility`.
