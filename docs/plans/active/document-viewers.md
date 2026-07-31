
# Document viewers

Status: active

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

What pdf.js would have bought is a real positioned text layer, so selection, copy, and find are native browser behavior. pdfium rasterizes to canvas, so selection has to be reconstructed above it. That looked like the expensive part of the trade — Extend's viewer spends roughly 150 lines on a text selection layer, a copy shortcut, and a selection release guard — but `@embedpdf/plugin-selection` ships `SelectionLayer` and `CopyToClipboard`, which cover it. Extend's scaffolding is around their own hand-rolled scroller, not a gap in the plugin.

Annotation, form filling, redaction, signature, and export ship as further plugins over the same engine, so PDF editing is closer to enabling a plugin and wiring a save path back into the task folder than to a project. Out of scope here; recorded because it is cheap to reach and the engine choice is what makes it cheap.

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
- **Right-click had nothing to offer.** Chromium builds its menu from the DOM selection, which is empty however much of the page is highlighted, so the one action a user reaches for after selecting is the one the native menu cannot show. The viewer publishes its selection to the surrounding context menu instead.

DOCX page navigation is the piece that did need hand-work. The editor controller's `currentPage` tracks the caret, which in read-only mode reports whatever the paginator touched last, so a freshly opened document showed its final page. The visible page is measured from scroll position against the rendered page wrappers instead.

Each engine counts zoom in its own units, and the toolbar's are factors where 1 is 100%. pdfium and the DOCX viewer agree; XLSX does not — its `setZoomScale` takes Excel's percentage, clamped to 10..400, so handing it a factor lands every document at the 10% floor. Its toolbar readout is also driven from `controller.zoomScale` rather than local state, so a trackpad pinch on the grid moves the number with it.

`readOnly` and `allowResizeInReadOnly` are both properties of the XLSX *controller*, not of the viewer component, and this is worth stating once because it caught us twice. The component reads its state from whichever controller it is handed and only builds one from its own props when none is supplied, so both props are inert on the component when a controller is passed. `readOnly` there alone leaves cell editing, paste and undo live; `allowResizeInReadOnly` there alone leaves columns stuck at their stored widths, because the controller is what resolves the pair into its own `canResizeReadOnly`.

Fit-width is a mode everywhere, not a one-shot. PDF gets that from pdfium's own `ZoomMode.FitWidth`; DOCX and PPTX get it from `use-fit-width.ts`, which recomputes the level from a `ResizeObserver` on the scroll container. A one-shot is wrong here because both things that change the available width — dragging the artifact panel's splitter and zooming the app — are continuous, so a level computed once is stale before the drag ends. DOCX opens fitted: a Word page is 8.5in of content, which overflows the panel at any usual width, so opening at 100% means opening on a horizontal scrollbar.

The recompute is coalesced to one per frame and applied only when the level moves by a whole percent. For DOCX every distinct scale is a re-layout of the document through wasm, so passing each sub-percent difference of a drag straight through is most of what makes the drag feel heavy. It is still not free, and a slow drag over a long document is visibly steppy.

PPTX fit needs the level computed here rather than `controller.setFitMode`. `zoom` is a controlled prop on `ReactPptxViewer`, so whatever the library resolves for a fit mode is overwritten on the next render by our number; the fit has to be our number. The slide's natural width comes from the deck's own `size.widthEmu`, EMUs being OOXML's unit, over 9525 per pixel.

CSV/TSV gets a viewer we own outright, on `@tanstack/react-virtual` — already a Studio dependency — plus `papaparse` for RFC 4180 parsing, which is the only new dependency in this row. Routing CSV through the XLSX stack is not available: that worker only accepts zipped workbook bytes via `Workbook.fromBytes`.

### Explicitly out

- The Finder-style file browser (`file-system.tsx`, 5,292 lines) and file-grid thumbnailing. The Files panel stays exactly as it is on `main`.
- Base UI. Nothing under `ui/extend/`, no `@base-ui/react`, no `@hugeicons/*`. With the file browser gone the viewers need only button, dropdown-menu, input, popover, select, separator, spinner, tabs, and tooltip — Studio's Radix layer has all of them. `command` and `dialog` were file-browser-only.
- Bounding-box / OCR / citation overlays, document splits, e-signature, and every editing path.
- `ScrollArea`. Studio has no scroll-area primitive and does not need one: our chrome uses plain scroll containers with refs.

Nothing is removed. `TaskFileViewerModal`, `atoms/task-file-viewer.ts`, `FilePreviewListItem`, and `FileViewer`'s `onExpand` all stay.

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
type ViewerEntry = {
  layout: "audio" | "default" | "document" | "text";
  render: (props: ViewerProps) => ReactNode;
};

const VIEWERS = { ... } satisfies Record<FileType, ViewerEntry>;
```

`satisfies Record<FileType, ViewerEntry>` makes adding a `FileType` a compile error until it is routed, which also backs `canPreviewFile()` — the predicate deciding whether a file opens in the panel or gets handed to the OS-associated app.

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
  zoom-levels.ts          shared zoom stops
apps/studio/src/client/lib/document-viewers.ts   wasm sources + lazy handles
```

CSV uses `@tanstack/react-virtual` alone. TanStack Table is already a Studio dependency and was considered, but a grid with no column definitions and one sort key earns nothing from it; the virtualizer is the part doing the work, and click-to-sort is a comparator plus a sorted copy of the row references.

CSV is also the one viewer with no zoom control. Its grid is plain DOM text that the window's own zoom already scales, so a second scale factor inside it would only be a way for the two to disagree.

XLSX keeps the library's grid but not its header: `showDefaultToolbar` covers the whole header including the sheet tabs, so those are supplied here, at the bottom where a spreadsheet's tabs belong.

PPTX needs `height="100%"` passed explicitly. The prop becomes the min *and* max height of the slide workspace, and its default is a `min(76vh, 780px)` clamp, so the viewer leaves the bottom of the panel empty however tall the panel is — and being a `vh` clamp, it is wrong again at any zoom other than 1x. A percentage resolves against the element `inset-0` has already sized.

## Runtime plumbing

This is where the real integration cost sits, and it is orthogonal to how much chrome we write. All of it was established on an earlier spike and carries over.

### WASM cannot be fetched from the renderer bundle

`studioURL()` loads the renderer from `file://` in packaged builds, so `fetch()` of a bundled asset is blocked and none of the four wasm binaries can load from the Vite output directory.

They are copied into `resources/wasm/` at build time and served over the already-privileged app protocol. The renderer's own origin is never that scheme, so every wasm fetch is cross-origin, and Chromium rejects those for custom schemes unless the scheme opts in — independent of the response's CORS headers. `registerSchemesAsPrivileged` therefore needs `corsEnabled: true` alongside the existing `secure` / `standard` / `supportFetchAPI`. `APP_PROTOCOL` is `instrument-local` in dev and `instrument` when packaged, so both have to be allowed wherever the binaries are reached.

Every library exposes `setWasmSource()`, so no bundler aliasing is needed.

| Source | Served as |
| --- | --- |
| `@embedpdf/pdfium/dist/pdfium.wasm` | `instrument://wasm/pdfium.wasm` |
| `@extend-ai/react-docx/dist/docx_wasm_bg.wasm` | `instrument://wasm/docx.wasm` |
| `@extend-ai/react-pptx/dist/pptx_wasm_bg.wasm` | `instrument://wasm/pptx.wasm` |
| `@extend-ai/react-xlsx/dist/duke_sheets_wasm_bg.wasm` | `instrument://wasm/xlsx.wasm` |

`@embedpdf/pdfium` is transitive through `@embedpdf/engines`, so under pnpm's isolated layout it only resolves from the engines package.

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
- Rendering the chunks with sourcemaps exceeds Node's default heap (fails at 5GB, passes at 6.5GB). The three `electron-vite build` scripts invoke the bin through `node --max-old-space-size=8192` rather than a `NODE_OPTIONS` prefix, which would not survive the Windows release runner.

Nothing loaded during renderer startup may statically import a viewer library. Each ships as a single side-effectful entry point, so importing one symbol pulls the whole package: configuring all three wasm sources from `main.tsx` put 5.6MB of library source in the entry chunk. `lib/document-viewers.ts` reaches each library through a dynamic import and owns the `lazy()` handles that pair wasm configuration with the viewer's own import, so no host can mount a viewer that would fall back to the library's default wasm source.

### `@embedpdf`'s preact peer

`@embedpdf/*` declares a `preact: ^10.26.4` peer alongside React, Svelte, and Vue. On the earlier spike, pnpm auto-installed one and picked up `@pierre/trees`' v11 prerelease, which does not satisfy `^10`; the fix was carrying `preact` as a devDependency. `@pierre/trees` was a file-browser dependency and is not in this branch, so the conflict may not reproduce — verify at install time and only add `preact` if it does.

## Data flow

Unchanged. Asset URLs come from the existing local HTTP server (`http://assets.<taskId>.<host>/<path>?version=<mtime>`), which already supports Range requests and CORS — embedpdf streams PDFs through range requests rather than fetching whole files. No new RPC.

Right-click splits on whether the browser can see the content, not on how the format is drawn. DOCX, PPTX and CSV render real DOM text, so Chromium's own menu already offers Copy, Look Up, and Copy Image on a picture in a slide; replacing it takes those away for nothing. PDF and XLSX paint to a bitmap and a canvas, and their selections live in pdfium and the grid controller, so the browser sees nothing selected and its menu has nothing worth offering. Those two get the file's own actions, plus a Copy that drives the viewer's own selection through `viewer-selection.ts`.

There is no Select All. The PDF plugin has no select-all command, and one that worked in some viewers but not others is worse than none. Native Select All in the DOCX viewer selects the whole page rather than the document, which is ordinary browser behaviour and would take an iframe to scope.

Whether to offer Copy is sampled on the right-click's `pointerdown`, in the capture phase, not when the menu opens. Both of these viewers drive their own selection from pointer events, and a press of any button starts a new one — pdfium clears the highlight on pointerdown and restores it when the gesture ends — so by the time the menu is open the selection reads as empty and Copy would render disabled over a highlight the user can still see.

Theme: documents render in their own colors at every app theme, matching the PDF viewer. The DOCX and XLSX libraries both offer a night-reader mode that inverts content, and both were tried; the inverted body text reads washed out, and applying it would make those two the only formats whose pages change color with the app. A workbook's cell fills and conditional formatting are content, not chrome. The surrounding chrome still follows the app theme.

App zoom: the toolbar's dropdowns, popovers, selects, and tooltips get `useAppZoomStyle` for free by using Studio's primitives. Canvas-rendered document content needs checking at zoom levels other than 1x — the viewers do their own device-pixel-ratio math.

## Validation

Per `.agents/skills/validate-changes/SKILL.md`, none of this is observable from reading the code. Each format needs a real file opened in a running Studio:

- Dev, all five formats, in the artifact panel and the expand modal, both themes, app zoom at 1x and something else. All five have been opened in the artifact panel in dev, DOCX and PDF in the expand modal, and PPTX at 1x and above; the light theme has not been exercised. Two host-collision failures have been checked and do not occur: page navigation moves the modal's viewer rather than the panel's copy, and a PDF open in both survives the modal closing even though each `PdfDocument` closes the documents it did not open.
- PDF text selection and copy, which is the part reconstructed above a bitmap rather than native browser selection. Selecting the title of a paper and pressing Cmd+C puts that title on the clipboard. Still worth checking by hand across a page boundary and at several zoom levels.
- A packaged build, all five formats — the `file://` origin, the app protocol, and the copied `resources/wasm/` only exist there. This is the step that catches wasm and worker regressions.
- A narrow artifact panel, to confirm the toolbar collapses rather than overflowing.
- A large file per format (a 500-page PDF, a workbook with many sheets) for the virtualization and memory paths.
- A malformed file per format, to confirm the `CatchBoundary` degrades to the fallback card rather than taking down the panel.
- For PDF specifically, a corpus of awkward real-world documents rather than only generated ones: a scan, a filled government form, a CJK document, something from an old generator. Robust compatibility with whatever a user brings is why pdfium was chosen, so it is the thing to actually check.
- `.numbers` files, which do not preview: `@dukelib/sheets-wasm` reads OOXML and legacy `.xls`, and Apple's format is neither. Supporting it means a separate parser for a proprietary, undocumented container, so those files keep falling through to the "open in the associated app" path.
- The artifact panel's own loading state, which is not a viewer concern but shows up as one. `TaskView` renders the "File not found" card whenever it has a path and no resolved file, so every file flashed that card on its way in — most visibly on a PDF, which takes longest to appear afterwards. It now waits for the lookup to actually answer, read off the query's update stamps: while the query is disabled, which it is on the render where the path arrives, it reports neither pending nor fetching while still holding no data, so neither of those flags can stand in for "we have not heard back yet".
