import { APP_PROTOCOL } from "@instrument-org/shared";
import { lazy } from "react";

// The renderer is served from `file://` in production, where `fetch()` of a
// bundled asset is blocked. Engine binaries and the tables they load are copied
// into `resources/vendor/` at build time and served from the privileged app
// protocol instead.
const vendorUrl = (assetPath: string) =>
  `${APP_PROTOCOL}://vendor/${assetPath}`;

export const PDFIUM_WASM_URL = vendorUrl("pdfium.wasm");
export const SQLITE_WASM_URL = vendorUrl("sqlite3.wasm");

// Every host that mounts a viewer goes through these handles, so a viewer can
// never reach its parser with the library's default wasm source: that one
// resolves against `import.meta.url` and is loaded through a dynamic `import()`
// of a `file:` URL, which the renderer's CSP rejects.
//
// Each viewer library is reached through a dynamic import so that it stays in
// its own chunk; a static import here would pull all of them into the entry
// chunk, since this module is loaded during renderer startup. The libraries
// read the configured source when they first parse a document, so setting it
// any time before the viewer mounts is enough.
export const LazyDocxViewer = lazy(async () => {
  await configureDocxWasmSource();
  const module = await import(
    "@/client/components/document-viewers/docx-viewer"
  );
  return { default: module.DocxViewer };
});

// The PDF engine takes its wasm URL as an argument rather than through global
// configuration, so the viewer passes `PDFIUM_WASM_URL` when it builds it.
export const LazyPdfViewer = lazy(async () => {
  const module = await import("@/client/components/document-viewers/pdf-viewer");
  return { default: module.PdfViewer };
});

export const LazyPptxViewer = lazy(async () => {
  await configurePptxWasmSource();
  const module = await import(
    "@/client/components/document-viewers/pptx-viewer"
  );
  return { default: module.PptxViewer };
});

export const LazyXlsxViewer = lazy(async () => {
  await configureXlsxWasmSource();
  const module = await import(
    "@/client/components/document-viewers/xlsx-viewer"
  );
  return { default: module.XlsxViewer };
});

// Neither of these needs a wasm source configured: zip.js is plain JavaScript.
// They stay lazy so the archive reader loads only when a container is opened.
export const LazyArchiveViewer = lazy(async () => {
  const module = await import(
    "@/client/components/document-viewers/archive-viewer"
  );
  return { default: module.ArchiveViewer };
});

export const LazyIWorkViewer = lazy(async () => {
  const module = await import(
    "@/client/components/document-viewers/iwork-viewer"
  );
  return { default: module.IWorkViewer };
});

// CSV parses in-process with no wasm, but stays lazy so papaparse and the grid
// only load when a delimited file is actually opened.
export const LazyCsvViewer = lazy(async () => {
  const module = await import("@/client/components/document-viewers/csv-viewer");
  return { default: module.CsvViewer };
});

// SQLite fetches its wasm through the Emscripten `locateFile` hook rather than
// a module-level setter, so the viewer passes `SQLITE_WASM_URL` itself.
export const LazySqliteViewer = lazy(async () => {
  const module = await import(
    "@/client/components/document-viewers/sqlite-viewer"
  );
  return { default: module.SqliteViewer };
});

async function configureDocxWasmSource() {
  const { setWasmSource } = await import("@extend-ai/react-docx");
  setWasmSource(vendorUrl("docx.wasm"));
}

async function configurePptxWasmSource() {
  const { setWasmSource } = await import("@extend-ai/react-pptx");
  setWasmSource(vendorUrl("pptx.wasm"));
}

async function configureXlsxWasmSource() {
  const { setWasmSource } = await import("@extend-ai/react-xlsx");
  setWasmSource(vendorUrl("xlsx.wasm"));
}
