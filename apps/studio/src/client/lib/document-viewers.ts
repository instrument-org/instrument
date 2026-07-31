import { APP_PROTOCOL } from "@instrument-org/shared";
import { lazy } from "react";

// The renderer is served from `file://` in production, where `fetch()` of a
// bundled asset is blocked. Engine binaries and the tables they load are copied
// into `resources/vendor/` at build time and served from the privileged app
// protocol instead.
const vendorUrl = (assetPath: string) =>
  `${APP_PROTOCOL}://vendor/${assetPath}`;

export const PDFIUM_WASM_URL = vendorUrl("pdfium.wasm");

// pdf.js resolves these itself while parsing, so each is a directory prefix
// with the trailing slash it documents rather than a single file.
export const PDFJS_ASSET_URLS = {
  cMapUrl: vendorUrl("pdfjs/cmaps/"),
  iccUrl: vendorUrl("pdfjs/iccs/"),
  standardFontDataUrl: vendorUrl("pdfjs/standard_fonts/"),
  wasmUrl: vendorUrl("pdfjs/wasm/"),
  workerUrl: vendorUrl("pdfjs/pdf.worker.mjs"),
};

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

// The second PDF renderer, reachable through the `pdfjs_viewer` feature flag.
// It is a whole second engine, so it stays out of the default chunk graph
// entirely until someone turns it on.
export const LazyPdfJsViewer = lazy(async () => {
  const module = await import(
    "@/client/components/document-viewers/pdfjs-viewer"
  );
  return { default: module.PdfJsViewer };
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

// CSV parses in-process with no wasm, but stays lazy so papaparse and the grid
// only load when a delimited file is actually opened.
export const LazyCsvViewer = lazy(async () => {
  const module = await import("@/client/components/document-viewers/csv-viewer");
  return { default: module.CsvViewer };
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
