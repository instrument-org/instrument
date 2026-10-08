import type { Protocol } from "devtools-protocol";

import type { BrowserEntry } from "./entry";

import { log } from "./log";

// Electron's debugger protocol does not expose Page.printToPDF. Use the
// native webContents.printToPDF() API and return a CDP-compatible response.
//
// The page decides its own paper: agent-browser's CLI sends
// `preferCSSPageSize: false` on every print, which would shrink a page that
// sets `@page { size: A4 }` onto Letter, and a page with no `@page` size
// prints on Letter either way. Every PDF is also tagged, so a screen reader
// can read it, and carries bookmarks built from its headings.
export async function handlePrintToPDF(
  entry: BrowserEntry,
  params: unknown,
): Promise<Protocol.Page.PrintToPDFResponse> {
  const p = (params ?? {}) as Protocol.Page.PrintToPDFRequest;
  try {
    const data = await entry.webContents?.printToPDF({
      generateDocumentOutline: true,
      generateTaggedPDF: true,
      landscape: p.landscape === true,
      preferCSSPageSize: true,
      printBackground: p.printBackground !== false,
    });
    if (!data) {
      throw new Error("webContents unavailable");
    }
    return { data: data.toString("base64") };
  } catch (error) {
    log.error(
      `printToPDF error targetId=${entry.targetId} error=${String(error)}`,
    );
    throw error;
  }
}
