import { type PdfErrorCode } from "@embedpdf/models";
import { createContext } from "react";

/**
 * A PDF that PDFium refused to open, with what it said about why.
 *
 * `reason` is decided by the viewer, which already loads `@embedpdf/models`,
 * so this module needs only its types and stays out of the eager bundle's way.
 * A password or a file that is not a PDF is the file's state rather than a
 * fault in the viewer, so neither is reported.
 */
export class PdfOpenError extends Error {
  readonly code: PdfErrorCode | undefined;
  readonly details: unknown;
  readonly reason: "format" | "other" | "password";

  constructor({
    code,
    details,
    reason,
  }: {
    code: PdfErrorCode | undefined;
    details: unknown;
    reason: PdfOpenError["reason"];
  }) {
    super("This PDF could not be opened.");
    this.name = "PdfOpenError";
    this.code = code;
    this.details = details;
    this.reason = reason;
  }
}

/**
 * The error a `ViewerSurface` caught, for the fallback card it draws. The card
 * is built by the caller before anything fails, so this is how it learns why.
 */
export const ViewerErrorContext = createContext<unknown>(undefined);

/** The line the fallback card shows under the filename. */
export function describeViewerError(error: unknown) {
  if (error instanceof PdfOpenError && error.reason === "password") {
    return "This PDF is password protected";
  }
  return "Preview unavailable in Instrument";
}

/**
 * What to send to telemetry for a viewer that threw, or `null` for a failure
 * the file itself explains.
 */
export function viewerErrorReport(error: unknown) {
  if (!(error instanceof PdfOpenError)) {
    return {};
  }
  if (error.reason !== "other") {
    return null;
  }
  return { pdfErrorCode: error.code };
}
