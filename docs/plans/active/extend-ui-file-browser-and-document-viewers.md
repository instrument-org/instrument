# Extend UI file browser and document viewers

Replace the task Files tab with a Finder-style file browser and add first-class
PDF, DOCX, XLSX, and PPTX viewing, by vendoring the [Extend UI](https://ui.extend.ai)
components (MIT) into Studio.

## Scope

- Vendor `file-system`, `pdf-viewer`, `docx-viewer`, `xlsx-viewer`,
  `pptx-viewer` and their support files.
- Replace `components/task/task-files.tsx` (the entire current Files panel).
- Route file opens into the existing artifact panel, which gains the new
  viewers in place of the `<iframe>` PDF preview and the "preview unavailable"
  fallback for Office formats.

## Key constraints discovered up front

### Base UI vs Radix

The Extend UI components are built on `@base-ui/react`; Studio's shadcn layer is
Radix. The viewers use Base-UI-only APIs (`Button render={}`, `DialogPanel`,
`ScrollArea viewportProps/scrollFade/scrollbarOverflowOnly`), so rewriting ~18k
lines onto Radix is not viable. Instead the Base UI primitives are vendored into
their own namespace at `src/client/components/ui/extend/`. Studio's own Radix
primitives are untouched, and re-syncing with upstream Extend UI stays a copy.

### Renderer origin is `file://` in production

`studioURL()` loads the renderer from `file://` in packaged builds, so
`fetch()` of a bundled asset is blocked and the four WASM binaries cannot be
loaded from the Vite output directory. They are copied into `resources/wasm/`
at build time and served from the already-privileged `instrument:` protocol
(`corsEnabled: true, standard: true, secure: true, supportFetchAPI: true`).
The renderer's own origin is never that scheme, so every WASM fetch is
cross-origin; Chromium rejects those for custom schemes unless the scheme
itself opts in, independent of the response's CORS headers. Every library
exposes `setWasmSource()`, so no bundler aliasing is needed.

Module workers do still work from `file://`: the
`grantFileProtocolExtraPrivileges` fuse is on by default and this app never
flips it, so `allow-file-access-from-files` stays enabled. All four viewers run
their parsers off the main thread, verified in a packaged build.

### Parser workers and the dev dependency optimizer

`@extend-ai/react-{docx,pptx,xlsx}` each spawn their parser with
`new Worker(new URL("./x.js", import.meta.url), { type: "module" })`. Vite's dev
pre-bundler rewrites `import.meta.url` to the dependency cache
(`node_modules/.vite/deps/`), where the sibling worker file does not exist, so
the dev server answers with the SPA fallback HTML and the worker dies on load
with an empty `error` event. The renderer therefore lists all three in
`optimizeDeps.exclude`, plus their CommonJS-only imports (`utif`, `regl`,
`react-dom/server`) in `optimizeDeps.include` so those still get ESM interop.
Production builds are unaffected: Rollup emits a real worker chunk per entry.

`@embedpdf/engines/pdfium-worker-engine` builds its worker from a
`URL.createObjectURL(new Blob([...]))` instead, which needs `blob:` in
`worker-src`.

### WASM binaries to vendor

| Source                                                | Served as                       |
| ----------------------------------------------------- | ------------------------------- |
| `@embedpdf/pdfium/dist/pdfium.wasm`                   | `instrument://wasm/pdfium.wasm` |
| `@extend-ai/react-docx/dist/docx_wasm_bg.wasm`        | `instrument://wasm/docx.wasm`   |
| `@extend-ai/react-pptx/dist/pptx_wasm_bg.wasm`        | `instrument://wasm/pptx.wasm`   |
| `@extend-ai/react-xlsx/dist/duke_sheets_wasm_bg.wasm` | `instrument://wasm/xlsx.wasm`   |

The reference implementation fetches pdfium from jsDelivr at runtime; that is
replaced.

### CSP

`src/index.html` needs `'wasm-unsafe-eval'` in `script-src` (WebAssembly
compilation), `instrument:` in `connect-src` (fetching the binaries), `blob:` in
`img-src` (the viewers rasterize pages to a canvas and hand the resulting object
URL to an `<img>`), and `worker-src 'self' blob:` (the PDF engine's worker is a
blob URL, and `worker-src` otherwise falls back to `script-src`).

### Theme

Studio disables Tailwind's default palette (`--color-*: initial`), so the three
raw palette classes in `file-system.tsx` are replaced with semantic tokens. The
vendored primitives also expect tokens Studio lacks (`--color-surface`,
`--color-info`, scalar `--color-success`/`--color-warning`,
`--color-destructive-foreground`, `--radius-2xl`+); those are added.

`DocxViewerPreview` and `XlsxViewerPreview` take `isDark` as a required
controlled prop, wired to Studio's `ThemeProvider`.

### App zoom

Studio scales the window with CSS `zoom` and each Radix primitive self-applies
`useAppZoomStyle()` to its portalled content. The vendored Base UI dialog,
popover, dropdown, select and tooltip need the same treatment.

### Upstream patch

`@extend-ai/react-docx@0.8.1` unmounts a React root synchronously from an effect
when tearing down detached thumbnail surfaces. Switching documents with the
thumbnail sidebar open reproduces React 19's "Attempted to synchronously unmount
a root while React was already rendering" error. The upstream repo carries a
patch deferring the unmount to a macrotask; it is mirrored in `patches/`.

### Renderer build

Making the viewers reachable takes the renderer from ~5.3k to ~13k modules,
which breaks the production build in two ways:

- The parser worker entries code-split, which the default `iife` worker format
  cannot express. The renderer config sets `worker.format: "es"`.
- Rendering the chunks with sourcemaps exceeds Node's default ~4GB heap (it
  fails at 5GB and passes at 6.5GB). `apps/studio`'s three `electron-vite build`
  scripts invoke the bin through `node --max-old-space-size=8192` rather than a
  `NODE_OPTIONS` prefix, which would not survive the Windows release runner.

Nothing loaded during renderer startup may statically import a viewer library.
Each ships as a single side-effectful entry point, so importing one symbol
pulls the whole package in: configuring all three WASM sources from `main.tsx`
put 5.6MB of library source into the entry chunk. `document-wasm.ts` therefore
reaches each library through a dynamic import, awaited alongside the viewer's
own `lazy()` import in `file-viewer.tsx`.

## Data model

`workspace.task.files.live.list` returns a flat
`{ filename, filePath, mimeType, modifiedAt, size }[]`. `FileSystem` infers the
folder hierarchy from paths, so no new RPC and no `loadChildren` is needed.
Asset URLs come from the existing local HTTP server
(`http://assets.<taskId>.<host>/<path>?version=<mtime>`), which already supports
Range requests and CORS.

## Integration shape

- Sidebar `files` mode renders `<TaskFileBrowser>` (the vendored `FileSystem`).
- `onFileOpen` writes the `artifactPanel` search param, matching the existing
  select-to-preview flow, instead of `FileSystem`'s built-in dialog. It also
  owns the unsupported-file fallback: `FileSystem` only reaches
  `onUnsupportedFileOpen` when no `onFileOpen` is supplied, and Studio previews
  more formats (markdown, code, audio, video) than the browser's own viewers,
  so the routing decision has to be made in one place.
- `file-viewer.tsx` gains `pdf` / `docx` / `xlsx` / `pptx` branches, all lazy.
- `get-file-type.ts` gains `docx` / `xlsx` / `pptx` types.

## Removed

- `components/task/task-files.tsx`
- `lib/task-file-groups.ts`

`components/folder-attachment-row.tsx` stays: `project-folders.tsx` uses it, and
the browser keeps the attached-folders list below the file tree.
