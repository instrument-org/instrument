import type { Protocol } from "devtools-protocol";

import type { BrowserEntry } from "./entry";

import { log } from "./log";

// Electron's debugger protocol does not expose Page.printToPDF. Use the
// native webContents.printToPDF() API and return a CDP-compatible response.
export async function handlePrintToPDF(
  entry: BrowserEntry,
  params: unknown,
): Promise<Protocol.Page.PrintToPDFResponse> {
  const p = (params ?? {}) as Protocol.Page.PrintToPDFRequest;
  try {
    const data = await entry.view.webContents?.printToPDF({
      landscape: p.landscape === true,
      preferCSSPageSize: p.preferCSSPageSize === true,
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
