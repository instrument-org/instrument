import { APP_PROTOCOL } from "@instrument-org/shared";
import { lazy } from "react";

// The renderer is served from `file://` in production, where `fetch()` of a
// bundled asset is blocked. The binaries are copied into `resources/wasm/` at
// build time and served from the privileged app protocol instead.
const wasmUrl = (filename: string) => `${APP_PROTOCOL}://wasm/${filename}`;

export const PDFIUM_WASM_URL = wasmUrl("pdfium.wasm");

// Every host that mounts a viewer goes through these handles, so a viewer can
// never reach its parser with the library's default wasm source: that one
// resolves against `import.meta.url` and is loaded through dynamic `import()`
// of a `file:` URL, which the renderer's CSP rejects.
//
// Each viewer library is reached through a dynamic import so that it stays in
// its own chunk; a static import here would pull all of them into the entry
// chunk, since this module is loaded during renderer startup. The libraries
// read the configured source when they first parse a document, so setting it
// any time before the viewer mounts is enough.
export const LazyDocxViewerPreview = lazy(async () => {
  const [, module] = await Promise.all([
    configureDocxWasmSource(),
    import("@/client/components/document-viewers/docx-viewer"),
  ]);
  return { default: module.DocxViewerPreview };
});

// The PDF engine takes its wasm URL as an argument rather than through global
// configuration, so `pdf-thumbnail-utils` passes `PDFIUM_WASM_URL` directly.
export const LazyPDFViewer = lazy(async () => {
  const module =
    await import("@/client/components/document-viewers/pdf-viewer");
  return { default: module.PDFViewer };
});

export const LazyPptxViewerPreview = lazy(async () => {
  const [, module] = await Promise.all([
    configurePptxWasmSource(),
    import("@/client/components/document-viewers/pptx-viewer"),
  ]);
  return { default: module.PptxViewerPreview };
});

export const LazyXlsxViewerPreview = lazy(async () => {
  const [, module] = await Promise.all([
    configureXlsxWasmSource(),
    import("@/client/components/document-viewers/xlsx-viewer"),
  ]);
  return { default: module.XlsxViewerPreview };
});

async function configureDocxWasmSource() {
  const { setWasmSource } = await import("@extend-ai/react-docx");
  setWasmSource(wasmUrl("docx.wasm"));
}

async function configurePptxWasmSource() {
  const { setWasmSource } = await import("@extend-ai/react-pptx");
  setWasmSource(wasmUrl("pptx.wasm"));
}

async function configureXlsxWasmSource() {
  const { setWasmSource } = await import("@extend-ai/react-xlsx");
  setWasmSource(wasmUrl("xlsx.wasm"));
}
