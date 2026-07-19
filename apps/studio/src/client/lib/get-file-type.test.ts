import { describe, expect, it } from "vitest";

import { canPreviewFile, getFileKindLabel, getFileType } from "./get-file-type";

describe("getFileType", () => {
  it.each([
    ["quarterly-report.docx", "docx"],
    ["DECK.PPTX", "pptx"],
    ["budget.xlsx", "xlsx"],
    // Legacy binary Office formats have no viewer.
    ["memo.doc", "unknown"],
    ["deck.ppt", "unknown"],
    ["budget.xls", "unknown"],
  ] as const)("classifies %s by extension as %s", (filename, expected) => {
    expect(getFileType({ filename })).toBe(expected);
  });

  it.each([
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "docx",
    ],
    [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "pptx",
    ],
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "xlsx",
    ],
  ] as const)("classifies the %s MIME type as %s", (mimeType, expected) => {
    expect(getFileType({ filename: "attachment", mimeType })).toBe(expected);
  });

  it.each([
    ["README", undefined, "unknown"],
    ["README", "text/plain", "text"],
    ["Makefile", undefined, "unknown"],
    [".gitignore", undefined, "unknown"],
    [".env", undefined, "unknown"],
    ["", undefined, "unknown"],
    [".", undefined, "unknown"],
  ] as const)("classifies %s (%s) as %s", (filename, mimeType, expected) => {
    expect(getFileType({ filename, mimeType })).toBe(expected);
  });

  // Filenames and MIME types come from the agent, so lookups must not reach
  // `Object.prototype`.
  it("does not resolve prototype members for hostile names", () => {
    const names = [
      "notes.constructor",
      "notes.__proto__",
      "notes.toString",
      "notes.hasOwnProperty",
      "constructor",
      "__proto__",
    ];

    expect(
      Object.fromEntries(
        names.map((filename) => [
          filename,
          {
            kindLabel: getFileKindLabel({ filename }),
            type: getFileType({ filename }),
          },
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "__proto__": {
          "kindLabel": "File",
          "type": "unknown",
        },
        "constructor": {
          "kindLabel": "File",
          "type": "unknown",
        },
        "notes.__proto__": {
          "kindLabel": "File",
          "type": "unknown",
        },
        "notes.constructor": {
          "kindLabel": "File",
          "type": "unknown",
        },
        "notes.hasOwnProperty": {
          "kindLabel": "File",
          "type": "unknown",
        },
        "notes.toString": {
          "kindLabel": "File",
          "type": "unknown",
        },
      }
    `);
  });

  it("does not resolve prototype members for hostile MIME types", () => {
    const mimeTypes = ["constructor", "__proto__", "toString"];

    expect(
      Object.fromEntries(
        mimeTypes.map((mimeType) => [
          mimeType,
          {
            kindLabel: getFileKindLabel({ filename: "attachment", mimeType }),
            type: getFileType({ filename: "attachment", mimeType }),
          },
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "__proto__": {
          "kindLabel": "File",
          "type": "unknown",
        },
        "constructor": {
          "kindLabel": "File",
          "type": "unknown",
        },
        "toString": {
          "kindLabel": "File",
          "type": "unknown",
        },
      }
    `);
  });
});

describe("canPreviewFile", () => {
  it.each([
    ["report.docx", undefined, true],
    ["deck.pptx", undefined, true],
    ["budget.xlsx", undefined, true],
    ["paper.pdf", "application/pdf", true],
    ["photo.png", "image/png", true],
    ["notes.md", undefined, true],
    ["archive.zip", "application/zip", false],
    ["memo.doc", "application/msword", false],
    ["notes.constructor", undefined, false],
  ] as const)(
    "reports %s (%s) as viewable in Studio: %s",
    (filename, mimeType, expected) => {
      expect(canPreviewFile({ filename, mimeType })).toBe(expected);
    },
  );
});
