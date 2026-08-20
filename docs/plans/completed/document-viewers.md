# Document viewers

Status: **completed**. The five document formats landed via PR #87; the data and container formats, the shared grid, and the range-read archive path via PR #88 (`9659bc76e`). Kept for the engine, format and dependency rationale below, none of which the code states. The follow-ons it names are still open: thumbnails split out into [document-thumbnails.md](../active/document-thumbnails.md), and a custom SQL box, CSV export of a selection, multi-column sort and `.eml` were all deliberately left undone.

Give the artifact panel real viewers for the document formats people open in a task — PDF, DOCX, PPTX, XLSX, CSV — replacing the `<iframe>` PDF preview and the "preview unavailable" card. Read-only, no editing.

The `<iframe>` does render PDFs; the problem is that it is an opaque cross-origin frame, so Studio has no control over zoom, page navigation, thumbnails, theme, or find, and cannot integrate any of it with the app's own chrome.

The viewers are Studio components built on Studio's own Radix primitives, driving four MIT wasm document engines. [Extend UI](https://ui.extend.ai) is a behavior reference for what good chrome over these engines looks like; none of its component code is carried.

## Why depend on the engines but not the components

The engines are the part nobody sensibly rebuilds:

| Format | Package | What it actually is |
| --- | --- | --- |
| PDF | `@embedpdf/*` | pdfium (Chromium's PDF engine) compiled to wasm, behind a plugin architecture. Independent project, ~39 packages, active release cadence. |
| DOCX | `@extend-ai/react-docx` | A Rust OOXML implementation (`docx-core` crate) compiled to wasm, plus a TypeScript layout engine and React renderer. |
| PPTX | `@extend-ai/react-pptx` | A Rust presentation parser compiled to wasm, plus a slide renderer with regl/d3 charts and an EMF/WMF metafile rasterizer. |
| XLSX | `@extend-ai/react-xlsx` | A canvas/regl grid over `@dukelib/sheets-wasm`, a third-party Rust spreadsheet engine with a formula calculator. |

All five packages are MIT with full public source. Reimplementing DOCX pagination or a spreadsheet formula engine is not a realistic alternative, and no better-maintained option exists for DOCX or PPTX in the browser at all.

What is worth owning is everything above them. Each library already exposes a controller (`useDocxEditor`, `usePptxViewer`, `useXlsxViewerController`, embedpdf's plugin hooks) and renders the document itself. The Extend UI viewer components — 1,300 to 2,900 lines each — are toolbars, page-number fields, zoom menus, thumbnail rails, and search popovers over those controllers, written against Base UI and a token set that is not ours. Carrying them means owning someone else's chrome under a UI kit Studio does not otherwise use, for code that is not where the difficulty lives.

So: depend on the engines, write the chrome.

### Why pdfium rather than pdf.js

The two credible PDF engines are pdfium (via `@embedpdf/*`) and pdf.js. This is Chrome's engine against Firefox's engine, not an industrial engine against an upstart — both are a major browser's default and both have rendered billions of documents. No public head-to-head fidelity benchmark exists; embedpdf's own docs argue for pdfium on general grounds and never claim to beat pdf.js.

The deciding factor is what this product has to open. Users bring arbitrary PDFs from their working lives — scanned contracts, government forms, old archives, CJK documents, whatever a generator produced a decade ago. The goal is robust compatibility with unknown input, and that is the axis where pdfium has the stronger claim: Foxit's commercial engine lineage, continuous large-scale fuzzing because it is an attack surface in Chrome, and exposure to a wider corpus of malformed real-world documents than any other engine. Agent-generated PDFs (the `pdf` skill's ReportLab and PyMuPDF output, `agent-browser`'s print-to-PDF) are the easy case that either engine handles; they are not what decides this.

What pdf.js buys is a real positioned text layer, so selection, copy, and find are native browser behavior. pdfium rasterizes to canvas, so selection has to be reconstructed above it. `@embedpdf/plugin-selection` ships `SelectionLayer` and `CopyToClipboard`, and those do cover *rendering* a highlight and performing a clipboard write — but not the interactions a browser gives text for free, which is where the cost of this trade actually landed.

Annotation, form filling, redaction, signature, and export ship as further plugins over the same engine, so PDF editing is closer to enabling a plugin and wiring a save path back into the task folder than to a project. Out of scope here; recorded because it is cheap to reach and the engine choice is what makes it cheap.

### What a reconstructed selection cannot do

The pdfium selection lives inside the engine. `document.getSelection()` is empty no matter how much of a page is highlighted, and everything the browser derives from a selection is therefore absent:

- **Right-click offers no Copy**, and no Look Up or Search either. Chromium builds that menu from `ContextMenuParams.selectionText`.
- **Cmd/Ctrl+C does nothing** unless the shortcut is intercepted, which then raises the question of which mounted viewer owns the keystroke — see `use-copy-shortcut.ts`.
- **A right-click clears the highlight.** The plugin's pointer handler calls `onClear` on any button, so reaching for a context menu wipes the thing being reached for. Stopping the right button in the capture phase before it descends is what keeps it.

Supplying our own context menu was tried and reverted. Our menu suppresses the native one, so a right-click over a selection loses Copy and Look Up and gains Open With and Save As: actions about the file, presented where the user just highlighted text. A sparse native menu beats a full menu about the wrong subject.

The formats whose content is real DOM — DOCX, PPTX, CSV — have none of these problems, and PPTX gets image copy out of slides for nothing. That contrast is what motivated building a second PDF engine to compare against.

That comparison happened, and pdfium won it. A full pdf.js viewer was built behind a feature flag, driven on real documents, and removed once the answer was clear: rendering favored pdfium by eye on the axis the choice turns on, and the interaction gap above turned out to be mostly closable. [The decision](../../decisions/2026-07-31-pdfium-is-the-pdf-engine.md) records what each engine cost and what would reopen it.

### Dependency risk, stated plainly

`@embedpdf/*` is a young project (created January 2025) whose commits are overwhelmingly from a single maintainer. The mitigation is that the durable asset is pdfium — a compiled artifact maintained by Google — and the single-maintainer part is the TypeScript and React layer wrapping it, which is the replaceable one. If the wrapper were abandoned, the engine remains and the wrapper is forkable or rewritable. It is MIT.

The three `@extend-ai/*` packages are likewise pre-1.0 (0.8.1, 0.1.2, 0.15.0) and published by one vendor for their own product. That is real risk, and the mitigation is that they are MIT with complete source (`extend-hq/react-docx`, `extend-hq/react-pptx`, `extend-hq/react-xlsx`) and forkable. Two consequences for how we consume them:

- Pin exact versions and exclude them from `minimumReleaseAge` floating, so a publish is a deliberate upgrade.
- Keep our own code on the libraries' documented public API. Reaching into internals is what makes a fork or a version bump expensive.

`@extend-ai/react-docx@0.8.1` needs a patch: it unmounts a React root synchronously from an effect when tearing down detached thumbnail surfaces, which trips React 19's "attempted to synchronously unmount a root while React was already rendering" when switching documents with the thumbnail rail open. Upstream carries the fix; mirror it in `patches/`.

## Where the wasm runs

Considered and rejected: parsing documents outside the renderer and shipping the parsed model over the wire, so the renderer needs no wasm.

The libraries split cleanly in two, and it is worth recording which is which:

| Format | What the wasm does | Could it move off the renderer? |
| --- | --- | --- |
| DOCX | **Parse only.** OOXML → `DocModel`. Layout and render are TypeScript; only the `docx-core` crate is Rust. | Yes. The parse already crosses a `postMessage` boundary, so the model is structured-cloneable by construction. |
| PPTX | **Parse only.** Same shape, via `native-parser-worker.ts`. | Yes, same reasoning. |
| XLSX | **Live session.** The worker holds `Workbook.fromBytes` alive and answers `getCellSnapshot` / `getRowsBatch` / `parseCharts` per virtualized scroll, plus formula recalculation. | No, not without proxying every scroll query over RPC. |
| PDF | **Live session.** pdfium rasterizes tiles at the current zoom and scroll position. | No, same reason. |

It works for two of four, and those two are where it buys the least. Because PDF and XLSX have to keep wasm in the renderer regardless, every item in [Runtime plumbing](#runtime-plumbing) survives either way: the app-protocol wasm serving, `corsEnabled`, `wasm-unsafe-eval`, `worker-src blob:`, `worker.format: "es"`, and the `optimizeDeps` exclusions. Moving DOCX and PPTX parsing out would add an RPC and a serialization path for a multi-MB model while eliminating zero constraints.

It would not shrink the renderer bundle either: both packages publish a single `.` export with no renderer-only subpath, so the renderer imports the same `dist/index.js` whether or not it does the parsing.

This becomes worth revisiting only if PDF and XLSX ever leave the renderer — which, given both need a live wasm session to answer scroll and zoom, is not foreseeable.

Converting everything to PDF with a bundled headless office suite and shipping only one viewer was also considered: several hundred MB of binary, per-platform signing, fidelity loss on every non-PDF format, and no live spreadsheet.

## Scope

Five read-only viewers, each with page/slide navigation and zoom, text selection and copy, find-in-document, and a page thumbnail rail where the format has pages.

| | PDF | DOCX | PPTX | XLSX | CSV/TSV |
| --- | --- | --- | --- | --- | --- |
| Nav + zoom | plugin-zoom, plugin-scroll | measured page + CSS zoom | `usePptxViewer` | controller zoom, sheet tabs | sort only, no zoom |
| Selection + copy | `SelectionLayer` + `CopyToClipboard` | DOM text, free | DOM text, free | controller cell selection | ours |
| Find | plugin-search | **not shipped** | `controller.search` | **not shipped** | ours |
| Thumbnail rail | plugin-thumbnail | `useDocxViewerThumbnails` | `controller.renderThumbnail` | n/a, sheet tabs | n/a |

**Find is missing in DOCX and XLSX.** Neither library exposes a search API, and both virtualize, so the browser's own find cannot see off-screen content either. For DOCX the approach would be to walk the parsed `DocModel` text, map matches to a page index, and drive the existing page-scroll path; for XLSX it means walking cells over the live wasm session. Both are their own follow-up rather than part of this change.

PDF selection needed far less than expected: `@embedpdf/plugin-selection` ships `SelectionLayer` and `CopyToClipboard`, so the ~150 lines of scaffolding budgeted for it were not required. That was the item flagged as the known-hard part, and it was not.

It did need three things the plugin does not do, and without any one of them the page reads as a picture of a document rather than a document:

- **Nothing binds a copy shortcut.** `CopyToClipboard` only subscribes to a `copyToClipboard` event; the plugin never emits one on its own, so a selection could be made and never taken anywhere. The viewer binds Cmd/Ctrl+C itself, guarded on the document actually holding selection rects — an unguarded call emits the empty string, which would wipe the clipboard on any copy elsewhere in the app.
- **The page bitmaps were draggable.** `RenderLayer` and `TilingLayer` both render an `<img>`, and an `<img>` is a drag source by default. A press that landed a few pixels off a glyph tore the page bitmap out as a drag image instead of starting a selection, and a right-click offered Chromium's Save Image As on it. Both layers are `pointer-events: none` now, leaving hit-testing to the pointer provider that owns selection.
- **Right-click still has nothing to offer.** Chromium builds its menu from the DOM selection, which is empty however much of the page is highlighted, so the one action a user reaches for after selecting is the one the native menu cannot show. Replacing that menu was tried and reverted; see the context-menu note below. The keyboard binding is the copy path.

DOCX page navigation is the piece that did need hand-work. The editor controller's `currentPage` tracks the caret, which in read-only mode reports whatever the paginator touched last, so a freshly opened document showed its final page. The visible page is measured from scroll position against the rendered page wrappers instead.

Each engine counts zoom in its own units, and the toolbar's are factors where 1 is 100%. pdfium and the DOCX viewer agree; XLSX does not — its `setZoomScale` takes Excel's percentage, clamped to 10..400, so handing it a factor lands every document at the 10% floor. Its toolbar readout is also driven from `controller.zoomScale` rather than local state, so a trackpad pinch on the grid moves the number with it.

`readOnly` and `allowResizeInReadOnly` are both properties of the XLSX *controller*, not of the viewer component, and this is worth stating once because it caught us twice. The component reads its state from whichever controller it is handed and only builds one from its own props when none is supplied, so both props are inert on the component when a controller is passed. `readOnly` there alone leaves cell editing, paste and undo live; `allowResizeInReadOnly` there alone leaves columns stuck at their stored widths, because the controller is what resolves the pair into its own `canResizeReadOnly`.

Fit-width is a mode everywhere, not a one-shot. PDF gets that from pdfium's own `ZoomMode.FitWidth`; DOCX and PPTX get it from `use-fit-width.ts`, which recomputes the level from a `ResizeObserver` on the scroll container. A one-shot is wrong here because both things that change the available width — dragging the artifact panel's splitter and zooming the app — are continuous, so a level computed once is stale before the drag ends. DOCX opens fitted: a Word page is 8.5in of content, which overflows the panel at any usual width, so opening at 100% means opening on a horizontal scrollbar.

The recompute is coalesced to one per frame and applied only when the level moves by a whole percent. For DOCX every distinct scale is a re-layout of the document through wasm, so passing each sub-percent difference of a drag straight through is most of what makes the drag feel heavy. It is still not free, and a slow drag over a long document is visibly steppy.

PPTX fit needs the level computed here rather than `controller.setFitMode`. `zoom` is a controlled prop on `ReactPptxViewer`, so whatever the library resolves for a fit mode is overwritten on the next render by our number; the fit has to be our number. The slide's natural width comes from the deck's own `size.widthEmu`, EMUs being OOXML's unit, over 9525 per pixel.

CSV/TSV gets a viewer we own outright, on `@tanstack/react-virtual` — already a Studio dependency — plus `papaparse` for RFC 4180 parsing, which is the only new dependency in this row. Routing CSV through the XLSX stack is not available: that worker only accepts zipped workbook bytes via `Workbook.fromBytes`.

### Explicitly out

- The Finder-style file browser (`file-system.tsx`, 5,292 lines). The Files panel stays exactly as it is on `main`.
- Cover thumbnails for files in the grid and the sidebar, for the reasons below.
- Base UI. Nothing under `ui/extend/`, no `@base-ui/react`, no `@hugeicons/*`. With the file browser gone the viewers need only button, dropdown-menu, input, popover, select, separator, spinner, tabs, and tooltip — Studio's Radix layer has all of them. `command` and `dialog` were file-browser-only.
- Bounding-box / OCR / citation overlays, document splits, e-signature, and every editing path.
- `ScrollArea`. Studio has no scroll-area primitive and does not need one: our chrome uses plain scroll containers with refs.

Nothing is removed. `TaskFileViewerModal`, `atoms/task-file-viewer.ts`, `FilePreviewListItem`, and `FileViewer`'s `onExpand` all stay.

### Cover thumbnails are deferred

Cover images for files in the grid and the sidebar are their own piece of work, planned separately in [document-thumbnails.md](../active/document-thumbnails.md). The short version: the libraries' thumbnail hooks answer "draw page 7 of the document already open", not "draw a cover for this path", so a cover costs a full open — and doing that once per file, in the renderer that is drawing the transcript, is what makes it a subsystem rather than a component change.

## The expand modal takes the window, less the window's own chrome

`TaskFileViewerModal` stays, and gets the window. The 64px padding and the max-width/height caps go, so the document or image is as large as the window allows.

It stops short of the top edge, because the window's controls live there. On macOS the traffic lights are drawn by the OS over whatever the page puts underneath them, so a viewer running to the top edge puts its filename behind three buttons; on Windows the caption buttons land on the viewer's own close button. The top inset is `TOOLBAR_HEIGHT`, which clears the whole toolbar on both platforms at once, and the other three sides get a small gutter so the shell still reads as being there behind the viewer.

That inset is the plain constant, not one divided by the zoom. The dialog content carries the same zoom factor the app root does, so a length in its units scales exactly as the toolbar's own height does. `StudioToolbar`'s `calc(5rem / var(--app-zoom))` traffic-light gutter is the opposite case and stays that way: it reserves room for OS-drawn buttons, which are real pixels and do not scale.

The chrome is identical to the artifact panel's: one `FileViewer`, one document toolbar, the same controls in both hosts. The modal is a bigger window onto the same thing, not a different mode. Because the artifact panel can be narrow, the toolbar collapses its controls into an overflow menu below a width threshold — measured against the toolbar's own container, not the viewport, per `docs/architecture/responsive-layout.md`.

Layout: the filename/actions header and the document toolbar stay as solid rows at the top; prev/next stay as overlay buttons at the left and right edges; the multi-file thumbnail strip stays as a row at the bottom with its padding reduced. Audio keeps its intrinsic width centered inside the shell rather than stretching.

Having a gutter also keeps click-to-dismiss meaningful: the exposed border of the dialog content closes the viewer, alongside Escape and the close button.

### Zoom

The modal currently portals to `document.body` (outside `ZoomRoot`) and never applies `useAppZoomStyle`, so it renders at 1x while the rest of the app is zoomed. Fix that here: apply `useAppZoomStyle` to the dialog content like every other Studio dialog, so modal chrome matches app chrome at any zoom level. The document's own size stays under the viewer's zoom control, which is where a user looking for a bigger document will reach.

A viewport-filling box is the easier case under CSS `zoom`, which is worth stating so it is not re-derived later. `inset-0` is zero on all four sides, and zero is zero at any scale factor, so a self-zoomed `fixed inset-0` box still covers exactly the real viewport while its contents scale. Percentage sizing inside it resolves in the element's own zoomed units and needs no compensation. It is the current `h-[80vh]` / `max-w-4xl` sizing that is fragile — `vw`/`vh` are *not* rescaled by an element's own zoom and have to be divided by `--content-zoom` — and `inset-0` plus padding deletes it.

Which also collapses `fileViewerVariants`. Its `error` variant is already dead (`FileViewer` passes `error: false` literally), and once the modal passes `fullSize` like the artifact panel does, every `fileType` size variant is unreachable too. The whole `tv()` call becomes a single base class.

## Restructuring `file-viewer.tsx`

`FileViewer` is a 666-line component ending in a twelve-branch `?:` ladder over `fileType`. Five more formats, each with its own chrome and error behavior, does not fit that shape.

Replace the ladder with a registry keyed on `FileType`:

```ts
interface ViewerEntry {
  render: (context: ViewerContext) => ReactNode;
  scrolls: "container" | "self";
}

const VIEWERS = { ... } satisfies Record<FileType, ViewerEntry>;
```

`satisfies Record<FileType, ViewerEntry>` makes adding a `FileType` a compile error until it is routed. `scrolls` says which side owns the scroll container: `"container"` for content the surface scrolls, `"self"` for a viewer whose engine scrolls its own pages and would otherwise sit inside a second scroller.

`get-file-type.ts` gains `csv`, `docx`, `pptx`, and `xlsx` types alongside the existing `pdf`.

Each document viewer renders inside a shared surface that provides a `CatchBoundary` keyed on the file URL and a `Suspense` fallback, so a parser that throws on a malformed file degrades to the "preview unavailable" card and recovers when the user picks another file, instead of taking down the panel.

### Where the controls live

The viewers render a toolbar row beneath `FileViewer`'s existing filename/actions header, rather than injecting controls into it. The header is host chrome (open, copy, reveal, close); the toolbar is document chrome (pages, zoom, find, thumbnails). Keeping them separate means the lazy viewer boundary stays a plain component boundary with no slot plumbing across it, and each viewer owns its controls without the header knowing which format is mounted. A shared `viewer-toolbar.tsx` supplies the pieces so the five toolbars stay visually identical and collapse identically when narrow.

Two of those pieces are the app's, not the viewers'. Zoom is `ZoomStepperControl`, shared by the settings row, the browser guest's page zoom, and the viewers. Its readout is `ZoomLevelMenu` in all three: the same jump-straight-to-a-level menu, filtered to whatever range that zoom allows, because stepping a rung at a time is the wrong interaction for going from 100% to 400%. Only the viewers pass `onFit`, since nothing else has a width to fit to. Stepping runs through the same `steppedZoom` ladder everywhere, and the preset levels are a subset of that ladder so the two never disagree. Find is `FindRow`, extracted from the browser panel's find bar and used verbatim inside the viewers' find popover — same field, match readout, and previous/next/close. The viewers keep the popover rather than the browser's always-visible bar because the artifact panel can be too narrow to give a bar its own row.

Groups within the toolbar are spaced apart rather than ruled apart. The zoom stepper is already a bounded control with its own internal divisions, so vertical separators between groups stacked a second set of lines onto it.

### Layout

```text
apps/studio/src/client/components/document-viewers/
  csv-viewer.tsx
  docx-viewer.tsx
  pdf-viewer.tsx
  pptx-viewer.tsx
  xlsx-viewer.tsx
  viewer-toolbar.tsx      shared toolbar controls
  viewer-surface.tsx      error/suspense boundary + thumbnail rail frame
  use-copy-shortcut.ts    Cmd/Ctrl+C for engine-held selections
  use-fit-width.ts        fit-to-container zoom, shared by DOCX and PPTX
apps/studio/src/client/lib/
  document-viewers.ts     wasm sources + lazy handles
  zoom-levels.ts          shared zoom stops
```

CSV uses `@tanstack/react-virtual` alone. TanStack Table is already a Studio dependency and was considered, but a grid with no column definitions and one sort key earns nothing from it; the virtualizer is the part doing the work, and click-to-sort is a comparator plus a sorted copy of the row references.

CSV is also the one viewer with no zoom control. Its grid is plain DOM text that the window's own zoom already scales, so a second scale factor inside it would only be a way for the two to disagree.

XLSX keeps the library's grid but not its header: `showDefaultToolbar` covers the whole header including the sheet tabs, so those are supplied here, at the bottom where a spreadsheet's tabs belong.

PPTX needs `height="100%"` passed explicitly. The prop becomes the min *and* max height of the slide workspace, and its default is a `min(76vh, 780px)` clamp, so the viewer leaves the bottom of the panel empty however tall the panel is — and being a `vh` clamp, it is wrong again at any zoom other than 1x. A percentage resolves against the element `inset-0` has already sized.

## Runtime plumbing

This is where the real integration cost sits, and it is orthogonal to how much chrome we write. All of it was established on an earlier spike and carries over.

### Engine payloads cannot be fetched from the renderer bundle

`studioURL()` loads the renderer from `file://` in packaged builds, so `fetch()` of a bundled asset is blocked and nothing an engine loads at runtime can come from the Vite output directory.

Those payloads are copied into `resources/vendor/` at build time and served over the already-privileged app protocol, on a `vendor` host that answers any path below that directory whose shape and extension it recognizes. The renderer's own origin is never that scheme, so every such fetch is cross-origin, and Chromium rejects those for custom schemes unless the scheme opts in — independent of the response's CORS headers. `registerSchemesAsPrivileged` therefore needs `corsEnabled: true` alongside the existing `secure` / `standard` / `supportFetchAPI`. `APP_PROTOCOL` is `instrument-local` in dev and `instrument` when packaged, so both have to be allowed wherever the payloads are reached.

Every wasm library exposes `setWasmSource()`, so no bundler aliasing is needed.

| Source | Served as |
| --- | --- |
| `@embedpdf/pdfium/dist/pdfium.wasm` | `instrument://vendor/pdfium.wasm` |
| `@extend-ai/react-docx/dist/docx_wasm_bg.wasm` | `instrument://vendor/docx.wasm` |
| `@extend-ai/react-pptx/dist/pptx_wasm_bg.wasm` | `instrument://vendor/pptx.wasm` |
| `@extend-ai/react-xlsx/dist/duke_sheets_wasm_bg.wasm` | `instrument://vendor/xlsx.wasm` |

`@embedpdf/pdfium` is transitive through `@embedpdf/engines`, so under pnpm's isolated layout it only resolves from the engines package.

`@embedpdf/engines` builds its parser worker from a blob, which is why `worker-src blob:` is in the CSP; the spreadsheet and slide engines put their embedded images on blob URLs, which is why `img-src` needs it too.

The copy step runs on `buildStart` of the main build alone, and skips when the destination already holds the current bytes — `buildStart` fires on every watch rebuild and this is ~11MB. The mtime check has to be exact rather than newer: pnpm hard-links from its store, so a reinstall can drop in a same-size asset older than what was copied.

Module workers do still work from `file://`: the `grantFileProtocolExtraPrivileges` fuse is on by default and this app never flips it, so a worker script at a sibling `file://` path is same-origin. All the parsers run off the main thread.

### Parser workers and Vite's dev pre-bundler

`@extend-ai/react-{docx,pptx,xlsx}` each spawn their parser with `new Worker(new URL("./x.js", import.meta.url), { type: "module" })`. Dev pre-bundling rewrites `import.meta.url` to `node_modules/.vite/deps/`, where the sibling worker file does not exist, so the dev server answers with SPA fallback HTML and the worker dies on load with an empty `error` event. The renderer lists all three in `optimizeDeps.exclude`, plus their CommonJS-only imports (`utif`, `regl`, `react-dom/server`) in `optimizeDeps.include` so those still get ESM interop.

`@embedpdf/engines/pdfium-worker-engine` builds its worker from `URL.createObjectURL(new Blob([...]))` instead, which needs `blob:` in `worker-src`.

### CSP

`src/index.html` needs `'wasm-unsafe-eval'` in `script-src`, `instrument:` and `instrument-local:` in `connect-src`, `blob:` in `img-src` (viewers rasterize pages to canvas and hand the object URL to an `<img>`), and `worker-src 'self' blob:` — `worker-src` otherwise falls back to `script-src`, which does not allow `blob:`.

### Renderer build

The viewers take the renderer from ~5.3k to ~13k modules:

- Parser worker entries code-split, which the default `iife` worker format cannot express. Set `worker.format: "es"`.
- Rendering that many chunks with sourcemaps exceeds Node's default heap. The default is derived from the machine's memory, so a dev Mac builds fine while the macOS CI runner caps out around 2GB and dies mid-`transforming` with an allocation failure. The three `electron-vite build` scripts invoke the bin through `node --max-old-space-size=8192` rather than a `NODE_OPTIONS` prefix, which would not survive the Windows release runner. Do not take a green local build as evidence this is unnecessary.

Nothing loaded during renderer startup may statically import a viewer library. Each ships as a single side-effectful entry point, so importing one symbol pulls the whole package: configuring all three wasm sources from `main.tsx` put 5.6MB of library source in the entry chunk. `lib/document-viewers.ts` reaches each library through a dynamic import and owns the `lazy()` handles that pair wasm configuration with the viewer's own import, so no host can mount a viewer that would fall back to the library's default wasm source.

### `@embedpdf`'s preact peer

`@embedpdf/*` declares a `preact: ^10.26.4` peer alongside React, Svelte, and Vue. On the earlier spike, pnpm auto-installed one and picked up `@pierre/trees`' v11 prerelease, which does not satisfy `^10`; the fix was carrying `preact` as a devDependency. `@pierre/trees` was a file-browser dependency and is not in this branch, so the conflict may not reproduce — verify at install time and only add `preact` if it does.

## Data flow

Unchanged. Asset URLs come from the existing local HTTP server (`http://assets.<taskId>.<host>/<path>?version=<mtime>`), which already supports Range requests and CORS — embedpdf streams PDFs through range requests rather than fetching whole files. No new RPC.

Right-click is Chromium's, in every viewer. No document format wraps itself in the app's own context menu, and the reasoning is worth keeping because supplying one looks like an improvement right up until it is used.

Where the browser can see the content — DOCX, PPTX and CSV, all real DOM text — the native menu already offers Copy, Look Up, and Copy Image on a picture in a slide. Replacing it takes those away for nothing.

Where it cannot — a PDF page is a bitmap and the XLSX grid is a canvas, with their selections held by pdfium and the grid controller — our menu was tried and was worse than the sparse native one. Two things went wrong. Right-clicking clears the viewer's own selection for the duration of the gesture, so the highlight visibly disappears as the menu opens. And a menu offering Open With, Save As and Reveal reads as though those applied to the text just highlighted, when they are actions on the whole file. A menu that is wrong about what it acts on is worse than a menu with less in it.

So those two formats bind Cmd/Ctrl+C inside the viewer instead, guarded on that viewer actually holding a selection: an unguarded copy emits an empty string, which would wipe the clipboard on any copy elsewhere in the app, and both the artifact panel and the expand modal can have a viewer mounted at once. Which viewer owns the keystroke is settled by focus, since an engine-held selection is not cleared when focus moves away and would otherwise answer for a copy made anywhere in the app.

The PDF page area also needs `user-select: none`. Nothing in it is selectable text, so a drag starts a second, native selection over the layer elements beneath the one pdfium is tracking. That selection captures no text — `getSelection()` returns a lone newline — but the browser still paints a selection box over whichever page bitmap the range spans, and paints it grey rather than blue whenever the window is not frontmost. The result is an opaque grey rectangle over part of the page, aligned to a tile boundary, which looks like a rendering fault in the engine and is not one. It survives until something collapses the selection, so it disappears the moment anyone clicks to investigate.

### The spreadsheet builds its own clipboard payload

`@extend-ai/react-xlsx` ships two copy paths and neither can run here, for reasons that are independent and both invisible from the API surface.

`copySelectionToClipboard` writes an `application/x-react-xlsx-range+json` blob alongside the text and HTML. Chromium's async clipboard permits a small fixed set of types and rejects the entire write for anything else — measured, not inferred: *"Type application/x-react-xlsx-range+json not supported on write."* One unsupported entry and nothing lands, including the text that would have been fine. That type exists so the library can paste a range back into itself with formatting intact, which a read-only viewer never needs.

Underneath that, the payload is null anyway. Both copy paths build it from `getClipboardData()`, which reads the worksheet off the main thread — and with `useWorker` at its default, the cells live in the parse worker and the main-thread workbook is null. So the library's own `copy` handler on the grid also bails, and `controller.isWorkerBacked` is `true` for every file we open. Copy is effectively unimplemented upstream for worker-backed workbooks.

The viewer therefore reads cells itself through `getCellSnapshotAsync`, which is the worker-aware accessor, and writes `text/plain` (tab separated, what every spreadsheet expects) plus a `text/html` table. `getCellDisplayValue` is not a substitute: it answers from a cache the grid fills as it renders, so cells outside the rendered window come back empty and a copy of anything larger than the viewport would be silently short. Two details keep it correct: the range corners are ordered, because dragging up or left leaves them inverted, and the range is clamped to the sheet's used extent, so selecting whole columns copies the data rather than a million blank rows. The clipboard entry is handed the promise of each format rather than an awaited value, which is what keeps the write attached to the keystroke that asked for it.

There is no Select All anywhere. The PDF plugin has no select-all command, and one that worked in some viewers but not others is worse than none. Native Select All in the DOCX viewer selects the whole page rather than the document, which is ordinary browser behavior and would take an iframe to scope.

Theme: documents render in their own colors at every app theme, matching the PDF viewer. The DOCX and XLSX libraries both offer a night-reader mode that inverts content, and both were tried; the inverted body text reads washed out, and applying it would make those two the only formats whose pages change color with the app. A workbook's cell fills and conditional formatting are content, not chrome. The surrounding chrome still follows the app theme.

App zoom: the toolbar's dropdowns, popovers, selects, and tooltips get `useAppZoomStyle` for free by using Studio's primitives. Canvas-rendered document content needs checking at zoom levels other than 1x — the viewers do their own device-pixel-ratio math.

## Data and container formats

Five more viewers, added after the five above landed. They are grouped here because none of them renders a document the way the first five do: two read a container to show what is inside it, and three browse data that has no pages at all.

| | SQLite | Zip | iWork | Parquet | JSONL |
| --- | --- | --- | --- | --- | --- |
| Extensions | `.db`, `.sqlite`, `.sqlite3` | `.zip` | `.pages`, `.numbers`, `.key` | `.parquet` | `.jsonl`, `.ndjson` |
| Reader | `@sqlite.org/sqlite-wasm`, Apache-2.0 | `@zip.js/zip.js`, already a workspace dependency | the same zip reader | `hyparquet`, MIT | `JSON.parse` |
| Body | the shared `DataGrid` | its own virtualized listing | an image | the shared `DataGrid` | the shared `DataGrid` |
| New dependency | one wasm binary, 848KB | none | none | one pure-JS reader | none |

**The grid is now shared, and is where most of the work went.** `DataGrid` holds everything tabular; each viewer keeps only its parsing. Four formats feed it: delimited text, database tables, Parquet and line-delimited JSON.

It is built on `@tanstack/react-table` over `@tanstack/react-virtual`, both of which Studio already depended on, so the whole thing is assembly rather than a dependency decision. Table is headless and expects an external virtualizer, which is exactly the filter-sort-window pipeline the CSV viewer had by hand.

What it does, and why each is there rather than being a nicety:

- **Selection and copy.** The grid is divs, not a `<table>`, so the browser has no selection to copy and its own menu offers nothing. Click, shift-click and drag build a range; Cmd/Ctrl+C and a right-click menu write it. This was the gap that mattered most: the two formats where copying data is the obvious point were the two that could not do it, while PDF and XLSX could. Text selection is off across the grid, because a drag has to mean one thing: with it on, a drag builds the grid's range and the browser's own selection at once, and since the shortcut answers with the range, the highlight a reader can see is not what reaches their clipboard.
- **Keyboard navigation.** Arrows move the focused cell, shift extends the block, Home and End run to the ends of a row and with the platform modifier to the corners of the table. `role="grid"` commits to this, and without it a keyboard-only reader cannot build a selection and so cannot reach the copy shortcut at all.
- **Filtering rather than find-and-step.** Typing narrows the table and the count reads `1 of 4 rows`. For a table this is strictly more useful than stepping between highlights, and it is what `getFilteredRowModel` is for.
- **Column resize and show/hide**, because a forty-column export is unreadable otherwise.
- **Column virtualization.** Rows alone were not enough: `SELECT *` across a wide table renders every column of every visible row. A 120-column database now renders 15.
- **Type-aware cells.** Numbers right-align. `NULL` renders as a dimmed marker distinct from the empty string, which a plain-text grid had been quietly collapsing into the same blank.

Three things in it are easy to get wrong and worth naming. `useReactTable` needs `"use no memo"` under React Compiler, as [tasks-data-table](../../../apps/studio/src/client/components/tasks-data-table/index.tsx) already documents. The scroll element is held in state rather than a ref: an inline callback ref is a new function every render, so React detaches and reattaches it each time, and the virtualizers can read the null in between. And a resize has to call `columnVirtualizer.measure()`: the virtualizer caches each column's measurement, and handing it a new `estimateSize` closure does not invalidate that cache, so the cells change width while the offsets they sit at still describe the old ones.

Blanks sort last through TanStack's `sortUndefined` rather than through the comparator, which cannot arrange it: a descending sort negates whatever a comparator returns, so deliberate blanks-last becomes blanks-first. The accessor reports a blank as `undefined` for that reason, and the cell reads its display text off the row instead, which is what keeps `NULL` and the empty string distinguishable.

Deliberately not done: a custom SQL query box, CSV export of a selection, and multi-column sort. Sorting and filtering also operate on the loaded rows, so past a viewer's row cap they cover the loaded window rather than the whole table; moving sort into SQL would trade instant client-side sorting for correctness at a size users are unlikely to open.

**Pin-left was built and then removed.** It put a second icon in every header, revealed on hover, with a third for unpin, which is a lot of control for a header 30px tall in a pane whose job is to show a file. Two of the four bugs the first review found were in it, which is the argument in miniature: the surface that earned the least was the surface that cost the most. A reader who needs a column beside another one can hide what is between them.

**Why this is assembled rather than bought.** Cell-range selection with a clipboard is the line commercial grids monetize: it sits in AG Grid Enterprise and MUI X Premium, and the free tiers give row selection instead. The remaining options that do ship it render to canvas, which trades away real text and lands back in the device-pixel-ratio and CSS-zoom arithmetic the PDF and XLSX viewers already carry. So the headless table does the row model, sorting and filtering, and what is written by hand is the cell layer and the selection over it, which is the part nothing free supplies. That calculation flips if this ever stops being a reader: editing, grouping or export would be the point to buy a grid rather than extend this one.

**SQLite runs in wasm rather than through the main process's native SQLite,** which is worth stating because Studio already has the latter for `task.db`. These files are untrusted and frequently malformed, SQLite does not claim to be hardened against hostile database files, and a fault in main takes the window with it where a wasm trap takes only the viewer. The file is read into wasm memory and opened with `sqlite3_deserialize`, so the database on disk is never touched and a preview cannot lock or corrupt one another process is using. Rows are read to a bound: a database is the only format here with no ceiling on its own size, and the grid holds what it is given.

**Listing an archive decompresses nothing.** The central directory is a table of contents at the end of the file, so a listing costs the same for an ordinary zip and for a compression bomb; the bomb only exists on the inflate path. Only the single-member read inflates, and it bounds what it accepts by the bytes that actually arrive, not by the `uncompressedSize` the archive declares about itself — that field is the one an attacker controls.

**Nor does it fetch the archive.** zip.js reads through `HttpRangeReader`, so what crosses the wire is the extent asked for: a size probe, the end-of-central-directory record, and the directory itself. Measured on a 56KB zip, that is 2,622 bytes to list it, and the same three requests list a gigabyte. A member read adds its own extent and nothing else: a 136KB `.numbers` gives up its `preview.jpg` for 50KB. The alternative is a `BlobReader` over a downloaded file, which puts a copy of the whole archive in renderer memory to look at a fraction of it. This needs `Accept-Ranges` and `Content-Range` in the asset route's `Access-Control-Expose-Headers`, because the renderer reads them across origins and a response header it cannot see is one the reader concludes is absent.

Members are listed flat, by full path, rather than browsed as a tree. A zip is a flat list of paths to begin with, and keeping it flat makes the whole archive one findable surface. Nothing in the listing is clickable yet: previewing a member means a route for content that has no path on disk, which is the real design question and is its own change.

**zip.js inflates on the calling thread here.** Its worker pool starts from a blob URL that the renderer's CSP does not admit, and the failure is a hang rather than an error — `getData` waits on a worker that never reports for duty. `configure({ useWebWorkers: false })` in `archive.ts` is what makes the iWork path work at all. The listing path never reaches it.

**iWork is a preview image, and says so.** Pages, Numbers and Keynote wrap Apple's IWA payload, a protobuf stream with no published schema and no reader outside Apple's apps, so rendering the document is not available at any price. What each file does carry is a `preview.jpg` that the authoring app rendered at its last save. That is enough to tell one file from another, confirm the right version was attached, or read a one-page memo. The banner is load-bearing: a reader not told otherwise will take a one-page snapshot for the live document, and every way that is wrong matters — one page, no selectable text, and as old as the last save by an Apple app rather than as old as the file.

### Formats surveyed and not taken

- **HEIC**, and with it the whole macOS ImageIO route. `sips` decodes HEIC, PSD, TIFF and about twenty camera RAW formats, and would have covered all of them through one main-process path. HEIC is what justified that path, and HEIC is a format Chromium itself declines to ship because the licensing is expensive; PSD and RAW alone do not carry a decode path, a JPEG cache and a macOS-only asymmetry.
- **Jupyter notebooks.** Cheap to build on the markdown and syntax-highlighting already here, but a notebook is a programmer's artifact and this is not a programmer's product.
- **Email** (`postal-mime`). Real and contained, but with no demonstrated demand yet. It would drop into the registry the same way these did.
- **ODF, legacy `.doc`, `.rtf`, and full iWork rendering.** No JavaScript or wasm renderer reaches acceptable fidelity, and the honest alternative is a headless office converter measured in hundreds of megabytes. They keep their labeled download card.
- **The other archive containers** — 7z, rar, tar and the compressed tarballs — which are different formats this reader cannot open.

## Validation

Per `.agents/skills/validate-changes/SKILL.md`, none of this is observable from reading the code. Each format needs a real file opened in a running Studio:

- Dev, every format, in the artifact panel and the expand modal, both themes, app zoom at 1x and something else. SQLite, zip and iWork have each been opened in the panel in dev against real files, with their engine reads checked against the same file read outside the app. All five have been opened in the artifact panel in dev, DOCX and PDF in the expand modal, and PPTX at 1x and above; the light theme has not been exercised. Two host-collision failures have been checked and do not occur: page navigation moves the modal's viewer rather than the panel's copy, and a PDF open in both survives the modal closing even though each `PdfDocument` closes the documents it did not open.
- PDF text selection and copy, which is the part reconstructed above a bitmap rather than native browser selection. Selecting the title of a paper and pressing Cmd+C puts that title on the clipboard. Still worth checking by hand across a page boundary and at several zoom levels.
- Spreadsheet copy, which has no browser behavior to fall back on. Verified in dev by driving real input over CDP: clicking a cell and pressing Cmd+C puts that cell's value on the clipboard, and dragging a block puts tab-separated text and an HTML table there.
- Every payload the `vendor` host answers for, one request each. A path it rejects is a 404, and a 404 for an engine binary does not surface as one: `fetch` resolves, the error body is handed to the engine as if it were the module, and the failure appears somewhere else entirely.
- A packaged build, every format — the `file://` origin, the app protocol, and the copied `resources/vendor/` only exist there. This is the step that catches wasm and worker regressions, and the zip reader's worker behavior is exactly the kind of thing that differs there.
- A narrow artifact panel, to confirm the toolbar collapses rather than overflowing.
- A large file per format (a 500-page PDF, a workbook with many sheets) for the virtualization and memory paths.
- A DOCX whose sections change page size, portrait to landscape. `revealPage` estimates a distant jump from `layout.pageHeightPx`, which describes the first section alone, so a mixed-size document accumulates error with every page crossed. The correction after the jump only waits for the target to mount at that offset; it does not re-aim, so an estimate that lands outside the target's virtualized window gives up on the wrong page. Fixing it means re-estimating from the nearest mounted page until it converges, which wants such a document in hand to test against.
- A malformed file per format, to confirm the `CatchBoundary` degrades to the fallback card rather than taking down the panel.
- For PDF specifically, a corpus of awkward real-world documents rather than only generated ones: a scan, a filled government form, a CJK document, something from an old generator. Robust compatibility with whatever a user brings is why pdfium was chosen, so it is the thing to actually check, and the thing that would reopen the engine decision if it went badly.
- iWork files across the three apps and several versions. The preview member is whatever the authoring app last wrote, so the cases worth finding are a document saved by a version old enough to write none, one saved on iOS rather than macOS, and a password-protected document, whose preview may be encrypted along with the payload.
- An archive with thousands of members, one with paths deep enough to truncate in the listing, and one written on Windows, whose separators and filename encoding differ from the macOS-written archives to hand.
- A database with a few million rows in one table, to see where `MAX_ROWS` actually bites, and one whose tables are all empty. Also a `.db` that is not SQLite at all, which should reach the fallback card rather than an empty grid.
- Parquet written by something other than PyArrow, and one using a compression codec `hyparquet` does not carry. A JSONL file large enough that the key sample matters, and one whose records disagree about their shape.
- The grid's own interactions at app zoom levels other than 1x, particularly the resize handle, which is a few pixels wide and is the control most likely to be missed when the pointer and layout disagree.
- The artifact panel's own loading state, which is not a viewer concern but shows up as one. `TaskView` renders the "File not found" card whenever it has a path and no resolved file, so every file flashed that card on its way in — most visibly on a PDF, which takes longest to appear afterwards. It now waits for the lookup to actually answer, read off the query's update stamps: while the query is disabled, which it is on the render where the path arrives, it reports neither pending nor fetching while still holding no data, so neither of those flags can stand in for "we have not heard back yet".

  Every wait, in the panel and in all seven viewers, goes through one `FileLoading`: nothing for half a second, then a centered spinner. A skeleton filling the content area was tried first, on the reasoning that a placeholder occupying the space makes the swap a fill rather than a jump. In use it read as neither, because these waits are mostly shorter than the eye settles, so switching files strobed a grey block between two documents. The delay is what separates the two cases — under it there is nothing to see, over it there is something that looks like work rather than furniture — and it is measured per mount, so flipping through several files in a row stays still throughout.
