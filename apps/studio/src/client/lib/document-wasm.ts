import { APP_PROTOCOL } from "@instrument-org/shared";

// The renderer is served from `file://` in production, where `fetch()` of a
// bundled asset is blocked. The binaries are copied into `resources/wasm/` at
// build time and served from the privileged app protocol instead.
const wasmUrl = (filename: string) => `${APP_PROTOCOL}://wasm/${filename}`;

export const PDFIUM_WASM_URL = wasmUrl("pdfium.wasm");

// Each viewer library is reached through a dynamic import so that it stays in
// its own chunk; a static import here would pull all of them into the entry
// chunk, since this module is loaded during renderer startup. The libraries
// read the configured source when they first parse a document, so setting it
// any time before the viewer mounts is enough.
export async function configureDocxWasmSource() {
  const { setWasmSource } = await import("@extend-ai/react-docx");
  setWasmSource(wasmUrl("docx.wasm"));
}

export async function configurePptxWasmSource() {
  const { setWasmSource } = await import("@extend-ai/react-pptx");
  setWasmSource(wasmUrl("pptx.wasm"));
}

export async function configureXlsxWasmSource() {
  const { setWasmSource } = await import("@extend-ai/react-xlsx");
  setWasmSource(wasmUrl("xlsx.wasm"));
}
