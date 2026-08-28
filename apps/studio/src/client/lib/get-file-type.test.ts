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
    ["analysis.ipynb", "notebook"],
  ] as const)("maps %s to %s", (filename, expected) => {
    expect(getFileType({ filename })).toBe(expected);
  });

  // A notebook is JSON, so without the mime route it would land in the syntax
  // highlighter as soon as the extension were missing or unusual.
  it.each([
    ["analysis", "application/x-ipynb+json"],
    ["analysis.ipynb", "application/json"],
  ] as const)(
    "routes %s (%s) to the notebook viewer",
    (filename, mimeType) => {
      expect(getFileType({ filename, mimeType })).toBe("notebook");
    },
  );

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
    expect(getFileType({ filename: "main.ts", mimeType: "text/plain" })).toBe(
      "code",
    );
  });
});

// Nothing resolves a file over the network to draw a reference to it, so a
// filename is all these have. Every case here would reach the fallback card if
// the extension did not answer on its own.
describe("resolving from the extension alone", () => {
  it.each([
    ["chart.png", "image"],
    ["photo.JPG", "image"],
    ["logo.svg", "image"],
    ["clip.mp4", "video"],
    ["clip.mov", "video"],
    ["theme.mp3", "audio"],
    ["voice.m4a", "audio"],
    ["main.ts", "code"],
    ["main.tsx", "code"],
    ["script.py", "code"],
    ["styles.css", "code"],
    ["config.yaml", "code"],
    ["notes.md", "markdown"],
    ["index.html", "html"],
    ["notes.txt", "text"],
  ] as const)("resolves %s to %s", (filename, expected) => {
    expect(getFileType({ filename })).toBe(expected);
  });

  // `.ts` is a registered video extension (MPEG transport stream) and a
  // TypeScript file everywhere it turns up here.
  it("reads .ts as TypeScript rather than a transport stream", () => {
    expect(getFileType({ filename: "main.ts" })).toBe("code");
  });

  // The server labels a response's Content-Type from the same table, so a file
  // has to read the same way whether or not that label reached the client.
  it.each([
    ["chart.png", "image/png"],
    ["clip.mp4", "video/mp4"],
    ["main.ts", "text/typescript"],
    ["script.py", "text/plain"],
    ["notes.md", "text/markdown"],
    ["index.html", "text/html"],
  ] as const)("resolves %s the same way with %s", (filename, mimeType) => {
    expect(getFileType({ filename })).toBe(getFileType({ filename, mimeType }));
  });

  // A binary with no extension entry has nothing to go on and belongs on the
  // fallback card rather than being guessed into a viewer.
  it.each(["program.exe", "data.bin", "font.woff2"] as const)(
    "leaves %s unknown",
    (filename) => {
      expect(getFileType({ filename })).toBe("unknown");
    },
  );
});

// Extension alone has to be enough for the formats with a viewer: these files
// reach the panel from agent output and downloads, which do not always carry a
// mime type. `.doc` stays unknown, which is what leaves it on the fallback card
// instead of a viewer that cannot read it.
describe("types a viewer exists for", () => {
  it.each([
    ["report.docx", "docx"],
    ["deck.pptx", "pptx"],
    ["model.xlsx", "xlsx"],
    ["data.csv", "csv"],
    ["scan.pdf", "pdf"],
    ["analysis.ipynb", "notebook"],
    ["archive.zip", "archive"],
    ["notes.db", "sqlite"],
    ["notes.sqlite", "sqlite"],
    ["notes.sqlite3", "sqlite"],
    ["budget.numbers", "iwork"],
    ["letter.pages", "iwork"],
    ["talk.key", "iwork"],
    ["report.doc", "unknown"],
  ] as const)("resolves %s to %s without a mime type", (filename, expected) => {
    expect(getFileType({ filename })).toBe(expected);
  });

  // The iWork formats are themselves zip containers, and the archive viewer
  // would happily list one, so what keeps a `.numbers` showing its page image
  // rather than its internals is that the extension table answers first.
  it("prefers the iWork preview over an archive listing", () => {
    expect(
      getFileType({
        filename: "budget.numbers",
        mimeType: "application/vnd.apple.numbers",
      }),
    ).toBe("iwork");
  });

  // Only zip. The other archive containers have no reader here and keep their
  // labeled download card.
  it.each(["bundle.7z", "bundle.rar", "bundle.tar", "bundle.tgz"] as const)(
    "leaves %s on the fallback card",
    (filename) => {
      expect(getFileType({ filename })).toBe("unknown");
    },
  );
});
