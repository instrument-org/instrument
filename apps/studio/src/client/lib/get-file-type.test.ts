import { describe, expect, it } from "vitest";

import { getFileType } from "./get-file-type";

describe("getFileType", () => {
  it.each([
    // Office formats route by extension, including the macro-enabled variants
    // that are the same container underneath.
    ["report.docx", "docx"],
    ["report.docm", "docx"],
    ["deck.pptx", "pptx"],
    ["deck.pptm", "pptx"],
    ["model.xlsx", "xlsx"],
    ["model.xlsm", "xlsx"],
    // Legacy binary formats the pptx/xlsx engines decode on a reduced path.
    ["deck.ppt", "pptx"],
    ["model.xls", "xlsx"],
    // react-docx reads OOXML only, so legacy Word stays unpreviewable rather
    // than routing to a viewer that would fail on it.
    ["report.doc", "unknown"],
    ["data.csv", "csv"],
    ["data.tsv", "csv"],
    ["scan.pdf", "pdf"],
  ] as const)("maps %s to %s", (filename, expected) => {
    expect(getFileType({ filename })).toBe(expected);
  });

  it("routes delimited files to the grid rather than the text highlighter", () => {
    // text/csv satisfies isTextMimeType, so without the extension check first
    // this would fall through to "code".
    expect(getFileType({ filename: "data.csv", mimeType: "text/csv" })).toBe(
      "csv",
    );
  });

  it("prefers the document extension over a generic mime type", () => {
    expect(
      getFileType({
        filename: "report.docx",
        mimeType: "application/octet-stream",
      }),
    ).toBe("docx");
  });

  it("is case insensitive", () => {
    expect(getFileType({ filename: "REPORT.DOCX" })).toBe("docx");
  });

  it("does not treat a document extension mid-filename as the type", () => {
    expect(getFileType({ filename: "notes.docx.txt" })).toBe("text");
  });

  it("leaves existing detection intact", () => {
    expect(getFileType({ filename: "a.png", mimeType: "image/png" })).toBe(
      "image",
    );
    expect(getFileType({ filename: "README.md" })).toBe("markdown");
    // Source files are only recognized through their mime type; there is no
    // extension list for them.
    expect(getFileType({ filename: "main.ts", mimeType: "text/plain" })).toBe(
      "code",
    );
  });
});

// Extension alone has to be enough for the formats with a viewer: these files
// reach the panel from agent output and downloads, which do not always carry a
// mime type. `.doc` and `.zip` stay unknown, which is what leaves them on the
// fallback card instead of a viewer that cannot read them.
describe("types a viewer exists for", () => {
  it.each([
    ["report.docx", "docx"],
    ["deck.pptx", "pptx"],
    ["model.xlsx", "xlsx"],
    ["data.csv", "csv"],
    ["scan.pdf", "pdf"],
    ["archive.zip", "unknown"],
    ["report.doc", "unknown"],
  ] as const)("resolves %s to %s without a mime type", (filename, expected) => {
    expect(getFileType({ filename })).toBe(expected);
  });
});
