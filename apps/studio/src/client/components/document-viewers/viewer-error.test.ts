import { PdfErrorCode } from "@embedpdf/models";
import { describe, expect, it } from "vitest";

import {
  describeViewerError,
  PdfOpenError,
  viewerErrorReport,
} from "./viewer-error";

const pdfError = (
  code: PdfErrorCode | undefined,
  reason: PdfOpenError["reason"],
) => new PdfOpenError({ code, details: "from pdfium", reason });

describe("viewer errors", () => {
  it.each([
    {
      description: "This PDF is password protected",
      error: pdfError(PdfErrorCode.Password, "password"),
      name: "password",
      report: null,
    },
    {
      description: "Preview unavailable in Instrument",
      error: pdfError(PdfErrorCode.WrongFormat, "format"),
      name: "not a PDF",
      report: null,
    },
    {
      description: "Preview unavailable in Instrument",
      error: pdfError(PdfErrorCode.Security, "other"),
      name: "any other PDFium failure",
      report: { pdfErrorCode: PdfErrorCode.Security },
    },
    {
      description: "Preview unavailable in Instrument",
      error: new Error("chunk failed to load"),
      name: "an error from another viewer",
      report: {},
    },
  ])("$name", ({ description, error, report }) => {
    expect(describeViewerError(error)).toBe(description);
    expect(viewerErrorReport(error)).toEqual(report);
  });

  it("carries the code and details on the thrown error", () => {
    const error = pdfError(PdfErrorCode.Password, "password");
    expect({
      code: error.code,
      details: error.details,
      message: error.message,
    }).toMatchInlineSnapshot(`
      {
        "code": 4,
        "details": "from pdfium",
        "message": "This PDF could not be opened.",
      }
    `);
  });
});
