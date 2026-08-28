# Wide tables widen the transcript

**Status:** Open, diagnosed and measured 2026-08-28; direction agreed the same day, nothing built. Not a one-line CSS patch — see the shape below.

A Markdown table whose columns need more room than the message column has spills past it and pushes the transcript's own scroller wider, so the whole conversation gains a horizontal scrollbar. It is no longer able to disturb the prompt input, but the transcript still scrolls sideways and the table's rightmost columns are clipped at the pane edge with no way to reach them.

## What is actually happening

Two things have to be true for a wide table to widen the transcript, and both are.

**We render a bare `<table>`.** [`markdown.tsx`](../../apps/studio/src/client/components/markdown.tsx) overrides `a`, `img`, `ol`, and `pre` and nothing else, so the table comes straight from Tailwind Typography with no wrapper around it. There is no element in the tree whose job is to clip or scroll the table, so an over-wide table simply overflows its parent, and every ancestor up to the scroller is `overflow: visible`.

**The transcript viewport scrolls horizontally by default.** The scroller is `size-full min-h-0 min-w-0 scrollbar-thin scrollbar-color overflow-y-auto overscroll-contain`. Setting `overflow-y: auto` with `overflow-x` left at `visible` computes `overflow-x` to `auto`, so the viewport is already a horizontal scroll container. Anything that overflows inside it lands there.

**`wrap-break-word` on the prose root does not help a table.** It is `overflow-wrap: break-word`, which changes how an already-sized box wraps its lines but leaves the element's **min-content** contribution alone. A table's used width is at least the sum of its columns' min-content widths, so a rule that does not move min-content cannot stop a table from overflowing. `overflow-wrap: anywhere` and `word-break: break-word` do move it. That distinction is the whole reason the current CSS looks like it should already cover this and does not.

## Measured

Reproduced in the browser harness (`pnpm --filter @instrument-org/studio dev:web`, `/debug/components/transcript`, scenario `awkward-shapes`) by injecting the seven-row, six-column comparison table from a real shopping session into the assistant message. Transcript column 460 px inside a 492 px viewport:

| | Result |
| --- | ---: |
| Table used width | 502 px |
| Prose column | 460 px |
| Viewport `clientWidth` | 492 px |
| Viewport `scrollWidth` | **518 px** |

The 26 px of viewport overflow is the horizontal scrollbar on the transcript.

Min-content width of that same table under each candidate cell rule, measured by setting `width: min-content` on the table:

| Cell rule | Table min-content |
| --- | ---: |
| none (today) | 502 px |
| `overflow-wrap: break-word` | 502 px |
| `word-break: break-all` | 177 px |
| `overflow-wrap: anywhere` | 148 px |
| `word-break: break-word` | 148 px |

And the layouts each candidate strategy produces for that table in a 460 px column:

| Strategy | Table width | Scrolls internally |
| --- | ---: | --- |
| `width: 100%` + `overflow-wrap: anywhere` on cells | 460 px | no |
| scroller + `width: max-content`, cells capped at 18ch | 846 px | yes |
| scroller + `width: max-content`, cells capped at 22ch | 974 px | yes |
| scroller + `width: max-content`, cells capped at 28ch | 1090 px | yes |
| scroller + `width: max-content`, no cap | 1246 px | yes |

Wrapping the table in an `overflow-x: auto` element takes the viewport's `scrollWidth` back to 492 px — equal to its `clientWidth` — in every scrolling row above. So the containment is settled by the wrapper; the cell cap is only a bound on the pathological table, the one whose cell holds a sentence. 22ch is a reasonable dial setting: about two screens of scroll in a 460 px measure, and a hard stop on a table that would otherwise be five.

The measure is capped independently of the window. `MessageScrollerContent` is `mx-auto w-full max-w-3xl gap-2 p-4 pb-8` ([chat.tsx:403](../../apps/studio/src/client/components/task/chat.tsx#L403)), which puts it at 736 px at its widest, pane closed and window maximized — while the pane itself leaves 960 px in a 1280 px window and more in a larger one. That gap is unused today and is where most of the fix comes from.

## What the reference apps do

All three wrap the table in a horizontal scroll container. None of them lets a table widen the conversation. Details, with bundle citations, are in the reference repos: `codex-app/docs/markdown-tables.md`, `claude-app/docs/markdown-tables.md`, and `cursor/docs/markdown-tables-streamdown.md`.

| | Codex (build 4559) | Claude Desktop `1.26832.0` | Cursor (Streamdown) |
| --- | --- | --- | --- |
| Scroll container | bleeds into both thread gutters via negative margin | `overflow-x-auto w-full px-2 mb-6` | `overflow-x-auto overscroll-y-auto` |
| Table width | `fit-content`, floored at the column width | `min-w-full` | `w-full` |
| Header cells | capped at 18/24 of the column, word-boundary wrap | wrap normally | `whitespace-nowrap` |
| Body cells | `overflow-wrap: anywhere` | wrap normally | wrap normally |
| Controls | "Copy table" on hover: Markdown + HTML | none | copy CSV/TSV, download CSV/Markdown |
| Print | — | `print:overflow-x-visible` | — |

Three things there are worth stealing regardless of which layout we pick.

**The gutter bleed.** Codex makes the scroller wider than the text column by both gutters and pulls it back with an equal negative margin, then re-applies the gutter to an inner wrapper. At rest the table lines up with the prose above it; while scrolling, content and scroll track run to the pane edges instead of stopping at the text margin. It costs two CSS rules and removes the "there is clearly more table hiding behind the padding" feeling.

**Two clipboard flavors on one write.** Both Codex and Cursor put `text/plain` and `text/html` into a single `ClipboardItem`. Pasting into a terminal gives text; pasting into Numbers, Notion, or a doc gives a real table. Codex's `text/plain` is the table's original Markdown source rather than a re-serialization of the DOM, so a paste back into an editor round-trips exactly what the model wrote — we have the same source available at render time.

**Headers set the floor.** Cursor's `whitespace-nowrap` on `th` and Codex's 18/24 cap on `th` are the same idea from opposite directions: the header is what makes a column legible, so it should decide the column's width rather than be squeezed by the body. Neither app lets a header stack into a two-word column.

## The shape we settled on

**Widen before scrolling.** A table is not held to the text measure. Its block grows into whatever the pane leaves either side of the measure, prose stays where it is, and columns keep the width that makes them legible. Only what still does not fit scrolls, inside the block.

This is the one decision that does real work, because the measure is much narrower than the pane most of the time. With the browser pane closed in a 1280px window: measure 736 px, pane leaves 960. A six-column comparison table usually lands between those two numbers, so widening alone finishes the job and there is nothing to discover. With the pane open there is little to take, and the same table falls back to scrolling. Neither case ever compresses a column.

Squeezing to fit is the rejected alternative: `overflow-wrap: anywhere` makes any table fit any measure, and at 460 px that gives six columns about 70 px each and stacks every value. Nothing is hidden and nothing is readable.

The rest, in the order they matter:

| Piece | What it is |
| --- | --- |
| Fade and its own scrollbar | The cue that a table continues, on the block rather than the transcript. Only when there is still overflow after widening. |
| Pinned first column | While scrolled, the first column stays under a hairline. Without it a scrolled row is five values belonging to nothing. |
| Block toolbar | Copy and expand, in the `group/block-toolbar` vocabulary [`mermaid-diagram.tsx`](../../apps/studio/src/client/components/mermaid-diagram.tsx) already uses: 12 px icons, revealed on hover and on `focus-within`. |
| Copy menu | Three destinations, not three file formats. See below. |
| Copy one row | One click on a row's own control, no menu. The ask behind most table copying is one line, not the comparison. |
| Expand | The grid we already have. See below. |

### Copy says where it goes, not what the file extension is

[`table-clipboard.ts`](../../apps/studio/src/client/components/document-viewers/table-clipboard.ts) already exists and already decides most of this. `tableClipboardItem` writes `text/html` and tab-separated `text/plain` in one `ClipboardItem`, so a spreadsheet pastes real cells and everything else falls back to readable text. It also records the constraint that bounds the menu: Chromium's async clipboard **rejects the entire write** when handed a type outside its permitted set, so there is no adding `text/markdown` as a third flavor alongside those two.

So TSV is not a menu item — it is the invisible fallback inside the first one. The menu is:

| Label | What it says under it |
| --- | --- |
| Table | Pastes as a real table into Numbers, Notion, or a doc |
| Markdown | The pipe table the model wrote, for an editor |
| CSV | Comma-separated text, for a spreadsheet or a script |

Markdown is the only one needing its own payload, and it is worth having: it round-trips exactly what the model wrote. Codex reached the same conclusion from the other end — its single "Copy table" writes the table's original Markdown source as `text/plain` with HTML alongside.

### Expand is the grid we already have

[`data-grid.tsx`](../../apps/studio/src/client/components/document-viewers/data-grid.tsx) is what the task pane shows for a `.csv` or an `.xlsx`: 28 px rows, sortable headers, resizable and hideable columns, a filter, virtualization, and cell-selection copy through the same `tableClipboardItem`. It takes `columns` and `rows` directly, so a Markdown table is already the shape it wants.

The seam is the entry point, not the renderer. `openFileViewerAtom` takes a `TaskFileViewerFile` — `filename`, `filePath`, `taskId`, `url` — and a table in a message is none of those. Two ways through:

- **Blob-backed CSV.** Serialize to CSV, hand over a blob URL with `filename: "table.csv"`, and `CsvViewer` fetches and parses it into the same grid with no new code. Cheap, but the viewer chrome then says `table.csv` and offers file actions (Save as, Reveal) for a file that does not exist.
- **A virtual document in the viewer.** Let the viewer surface accept rows directly rather than a file. More work, correct chrome.

## Related

- [The transcript column jumps while a turn runs](transcript-column-jumps-while-a-turn-runs.md) — the other way the transcript's width misbehaves.
- [CSS zoom: rect px vs layout px](css-zoom-rect-vs-layout-px.md) — any scroll affordance built on measured widths has to read the right unit.
