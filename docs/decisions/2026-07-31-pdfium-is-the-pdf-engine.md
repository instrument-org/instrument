# pdfium is the PDF engine, with pdf.js kept as a flagged escape hatch

## Context

Studio's artifact panel needed a real PDF viewer, and there are two credible engines: pdfium via `@embedpdf/*`, and pdf.js. Chrome's engine against Firefox's engine — both a major browser's default, both having rendered billions of documents, and no public head-to-head fidelity benchmark between them.

pdfium was picked first, on the grounds that this product opens whatever a user brings from their working life — scans, filled government forms, old archives, CJK documents, whatever some generator produced a decade ago — and robustness against unknown input is where pdfium has the stronger claim: Foxit's commercial engine lineage, continuous large-scale fuzzing because it is an attack surface in Chrome, and exposure to a wider corpus of malformed documents than any other engine.

That choice has one real cost. pdfium rasterizes to canvas and keeps the selection inside the engine, so `document.getSelection()` is empty no matter how much of a page is highlighted, and everything the browser derives from a selection is absent: right-click offers no Copy or Look Up, Cmd/Ctrl+C does nothing, and a right-click clears the highlight the user was reaching for. pdf.js lays a real positioned text layer over its canvas, so all of that is native browser behaviour for free.

That gap was large enough to justify building the second viewer rather than arguing about it, so both exist and the comparison could be made on real documents.

## Decision

pdfium is the engine. pdf.js stays behind the `pdfjs_viewer` flag, off by default, and is removed once the corpus comparison below is done.

Two things decided it.

Rendering quality on real documents favoured pdfium, by eye, on the axis the original argument turned on. pdf.js renders footnotes and small type visibly softer on the same file at the same zoom. That was checked for the obvious mundane cause and is not one: the canvas backing store is 1756x2274 for an 878x1137 CSS box at `devicePixelRatio: 2`, so both engines rasterize at full density and the difference is genuinely in glyph rasterization.

The interaction gap that motivated the spike turned out to be mostly closable on pdfium. Cmd/Ctrl+C now copies, scoped by focus so the keystroke belongs to whichever viewer holds it. A right-click no longer clears the selection, because the selection plugin's pointer handler is stopped in the capture phase for the right button before it descends. And a drag no longer leaves a stray native selection over the page bitmaps, which the browser painted as an opaque grey rectangle that read as an engine rendering fault.

What remains genuinely impossible on pdfium is right-click Copy and Look Up. Chromium builds that menu from `ContextMenuParams.selectionText`, and there is nothing to put there. Supplying our own menu was tried and reverted: it suppresses the native one, so a right-click over a highlight loses Copy and Look Up and gains Open With and Save As — actions about the file, offered where the user just selected text. A sparse correct menu beats a full menu about the wrong subject.

## Consequences

- Right-click Copy and Look Up do not work over a PDF selection, and will not. Cmd/Ctrl+C is the copy path, and the pdf.js flag is the answer for anyone who needs the native menu.
- The flag is an escape hatch during the beta rather than a permanent fork. If a beta user hits a document pdfium renders wrong, it can be turned on without a code change or a release, which is worth more than the code it costs while real-world coverage is still thin.
- Keeping it is not free: `pdfjs-dist` contributes 6.2MB of the 18MB `resources/vendor` payload — cmaps, colour profiles, standard fonts, codec wasm — and those ship whether the flag is on or not. The renderer chunk is lazy and never loads while the flag is off.
- pdf.js also needs three overrides that fight its defaults, and each is a maintenance liability across upgrades: `content-box` restored for its subtree against Tailwind's preflight, or find highlights drift up to 2% off their words; `AnnotationMode.ENABLE` instead of `ENABLE_FORMS`, or a viewer with no save path invites people to type into a form and lose it; and link borders suppressed with `!important`, since it writes the PDF's own border as an inline style.
- Editing, if it ever comes, is cheaper on pdfium: annotation, form filling, redaction, signature and export are further plugins over the same engine.

## What would reopen this

The comparison that matters has not been made. Both engines have been driven over generated documents and one paper; neither has been run over a corpus of awkward real-world input — a scan, a filled government form, a CJK document, something from an old generator. That is on the viewers plan's validation list, and it is the evidence that either removes pdf.js or overturns this.

## Implementation

- [pdfium viewer](../../apps/studio/src/client/components/document-viewers/pdf-viewer.tsx)
- [pdf.js viewer](../../apps/studio/src/client/components/document-viewers/pdfjs-viewer.tsx)
- [Engine selection](../../apps/studio/src/client/components/file-viewer.tsx)
- [Plan](../plans/active/document-viewers.md)
