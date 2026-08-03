# pdfium is the PDF engine

## Context

Studio's artifact panel needed a real PDF viewer, and there are two credible engines: pdfium via `@embedpdf/*`, and pdf.js. Chrome's engine against Firefox's engine — both a major browser's default, both having rendered billions of documents, and no public head-to-head fidelity benchmark between them.

pdfium was picked first, on the grounds that this product opens whatever a user brings from their working life — scans, filled government forms, old archives, CJK documents, whatever some generator produced a decade ago — and robustness against unknown input is where pdfium has the stronger claim: Foxit's commercial engine lineage, continuous large-scale fuzzing because it is an attack surface in Chrome, and exposure to a wider corpus of malformed documents than any other engine.

That choice has one real cost. pdfium rasterizes to canvas and keeps the selection inside the engine, so `document.getSelection()` is empty no matter how much of a page is highlighted, and everything the browser derives from a selection is absent: right-click offers no Copy or Look Up, Cmd/Ctrl+C does nothing, and a right-click clears the highlight the user was reaching for. pdf.js lays a real positioned text layer over its canvas, so all of that is native browser behaviour for free.

That gap was large enough to justify building the second viewer rather than arguing about it, so both exist and the comparison could be made on real documents.

## Decision

pdfium is the engine. The pdf.js viewer was built, compared, and removed.

Two things decided it.

Rendering quality on real documents favoured pdfium, by eye, on the axis the original argument turned on. pdf.js renders footnotes and small type visibly softer on the same file at the same zoom. That was checked for the obvious mundane cause and is not one: the canvas backing store is 1756x2274 for an 878x1137 CSS box at `devicePixelRatio: 2`, so both engines rasterize at full density and the difference is genuinely in glyph rasterization.

The interaction gap that motivated the spike turned out to be mostly closable on pdfium. Cmd/Ctrl+C now copies, scoped by focus so the keystroke belongs to whichever viewer holds it. A right-click no longer clears the selection, because the selection plugin's pointer handler is stopped in the capture phase for the right button before it descends. And a drag no longer leaves a stray native selection over the page bitmaps, which the browser painted as an opaque grey rectangle that read as an engine rendering fault.

What remains genuinely impossible on pdfium is right-click Copy and Look Up. Chromium builds that menu from `ContextMenuParams.selectionText`, and there is nothing to put there. Supplying our own menu was tried and reverted: it suppresses the native one, so a right-click over a highlight loses Copy and Look Up and gains Open With and Save As — actions about the file, offered where the user just selected text. A sparse correct menu beats a full menu about the wrong subject.

## Consequences

- Right-click Copy and Look Up do not work over a PDF selection, and will not. Cmd/Ctrl+C is the copy path.
- Removing pdf.js takes 6.2MB out of what was an 18MB `resources/vendor` payload — character maps, colour profiles, standard fonts and codec wasm, all of which shipped whether the flag was on or not. The recursive build-time tree walk that copied them goes with it, and the `vendor` protocol host narrows to serving wasm alone.
- It also retires three overrides that fought pdf.js's defaults, each a maintenance liability across upgrades: `content-box` restored for its subtree against Tailwind's preflight, or find highlights drift up to 2% off their words; `AnnotationMode.ENABLE` instead of `ENABLE_FORMS`, or a viewer with no save path invites people to type into a form and lose it; and link borders suppressed with `!important`, since pdf.js writes the PDF's own border as an inline style.
- Editing, if it ever comes, is cheaper on pdfium: annotation, form filling, redaction, signature and export are further plugins over the same engine.
- The viewer is recoverable rather than gone. Its commits stay on the pull request that introduced it, viewable after a squash-merge and restorable from the branch ref, so revisiting means reading real code rather than rebuilding from this description.

## The option not taken

Reverting to the `<iframe>` this branch replaced was reconsidered at the end and rejected. It is not a fidelity question: Chrome's built-in PDF viewer *is* pdfium, the same engine, so rendering would be identical — and it would hand back native selection, right-click Copy, Look Up, find and print for nothing, in about ten lines, with no dependency at all.

What it costs is the reason the branch exists. PDF would become the only format with foreign chrome: no shared toolbar, no thumbnail rail, no zoom control matching the other four, and Chromium's own grey background instead of the app's theme — for the format people open most. An opaque frame also hands out no pixels, so it forecloses capturing a page for [thumbnails](../plans/active/document-thumbnails.md), and editing later stops being a plugin away.

That trade is closer than it looks, and it turns on whether integrated chrome is worth more than a native context menu. It is worth revisiting if the beta says otherwise.

## What would reopen this

The comparison that matters has not been made. Both engines were driven over generated documents and one paper; neither was run over a corpus of awkward real-world input — a scan, a filled government form, a CJK document, something from an old generator. That is on the viewers plan's validation list. Robust compatibility with whatever a user brings is the whole basis on which pdfium was picked, so it is also the evidence that would overturn this.

## Implementation

- [pdfium viewer](../../apps/studio/src/client/components/document-viewers/pdf-viewer.tsx)
- [Viewer registry](../../apps/studio/src/client/components/file-viewer.tsx)
- [Plan](../plans/completed/document-viewers.md)
