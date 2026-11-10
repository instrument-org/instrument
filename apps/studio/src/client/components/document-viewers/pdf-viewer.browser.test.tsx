import pdfiumWasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { renderInBrowser } from "@/tests/render-browser";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { PdfViewer } from "./pdf-viewer";

// The app serves the engine from its own protocol, which only the main
// process answers; here it comes from the package.
vi.mock("@/client/lib/document-viewers", () => ({
  PDFIUM_WASM_URL: pdfiumWasmUrl,
}));
// The worker engine never answers under the test runner, so pdfium runs on the
// page instead; what is under test is the viewer around it.
vi.mock("@embedpdf/engines/pdfium-worker-engine", async () => ({
  createPdfiumEngine: (await import("@embedpdf/engines/pdfium-direct-engine"))
    .createPdfiumEngine,
}));

/** A PDF of `pages` letter-sized pages, each with one line of text. */
function pdfOf(pages: number): string {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let index = 0; index < pages; index++) {
    const content = `BT /F1 24 Tf 72 700 Td (Page ${index + 1}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return URL.createObjectURL(new Blob([body], { type: "application/pdf" }));
}

// A click on a page put the focus on a wrapper around the scrolling viewport,
// and the browser scrolls the focused element and its ancestors, never what
// is inside it: Space did nothing.
it("scrolls a page down on Space once a page is clicked", async () => {
  await renderInBrowser(
    <div className="relative flex flex-col" style={{ height: 400, width: 500 }}>
      <PdfViewer filename="long.pdf" url={pdfOf(4)} />
    </div>,
  );
  const viewport = await vi.waitFor(
    () => {
      const found = document.querySelector<HTMLElement>("[data-file-scroller]");
      if (!found || found.scrollHeight <= found.clientHeight) {
        throw new Error("the document has not laid out yet");
      }
      return found;
    },
    { timeout: 10_000 },
  );

  await userEvent.click(viewport);
  // Most of a screen at a time, the way Space scrolls a page.
  const screen = viewport.clientHeight / 2;
  await userEvent.keyboard(" ");
  await vi.waitFor(() => {
    expect(viewport.scrollTop).toBeGreaterThan(screen);
  });

  await userEvent.keyboard("{Shift>} {/Shift}");
  await vi.waitFor(() => {
    expect(viewport.scrollTop).toBeLessThan(screen);
  });
});
