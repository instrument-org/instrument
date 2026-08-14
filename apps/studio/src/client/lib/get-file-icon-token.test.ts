import { describe, expect, it } from "vitest";

import { type FileIconToken, getFileIconToken } from "./get-file-icon-token";

describe("getFileIconToken", () => {
  // Every extension `getFileKindLabel` names, every extension a document viewer
  // opens, and every extension `getFileType` calls media. Naming a file's kind
  // in words while drawing the blank page is the failure this guards: if a new
  // format earns a label there, it has to earn a token here too.
  it.each<[string, FileIconToken]>([
    ["backup.db", "database"],
    ["notes.sqlite", "database"],
    ["notes.sqlite3", "database"],
    ["events.parquet", "table"],
    ["records.avro", "table"],
    ["export.jsonl", "code"],
    ["export.ndjson", "code"],
    ["analysis.ipynb", "code"],
    ["shape.geojson", "code"],
    ["budget.xlsb", "spreadsheet"],
    ["budget.xlsm", "spreadsheet"],
    ["budget.xlt", "spreadsheet"],
    ["budget.xltm", "spreadsheet"],
    ["budget.xltx", "spreadsheet"],
    ["memo.docm", "word"],
    ["memo.dot", "word"],
    ["memo.dotm", "word"],
    ["memo.dotx", "word"],
    ["deck.pot", "presentation"],
    ["deck.potm", "presentation"],
    ["deck.potx", "presentation"],
    ["deck.pps", "presentation"],
    ["deck.ppsm", "presentation"],
    ["deck.ppsx", "presentation"],
    ["deck.pptm", "presentation"],
    ["release.tgz", "archive"],
    ["release.bz2", "archive"],
    ["release.xz", "archive"],
    ["release.zst", "archive"],
    ["theme.aiff", "audio"],
    ["theme.oga", "audio"],
    ["theme.opus", "audio"],
    ["clip.m4v", "video"],
    ["clip.ogv", "video"],
    ["captions.srt", "subtitle"],
    ["captions.vtt", "subtitle"],
    ["captions.ass", "subtitle"],
    ["captions.ssa", "subtitle"],
    ["shot.avif", "image"],
    ["shot.heif", "image"],
    ["favicon.ico", "image"],
    ["invite.ics", "calendar"],
    ["card.vcf", "contact"],
    ["thread.eml", "email"],
    ["thread.msg", "email"],
    ["novel.mobi", "ebook"],
    ["page.mhtml", "html"],
    ["run.log", "text"],
    ["refs.bib", "text"],
    ["refs.ris", "text"],
  ])("gives %s a token of its own", (filename, expected) => {
    expect(getFileIconToken({ filename })).toBe(expected);
  });

  it("keeps the lettered zip glyph for zip alone", () => {
    expect(getFileIconToken({ filename: "bundle.zip" })).toBe("zip");
    expect(getFileIconToken({ filename: "bundle.rar" })).toBe("archive");
    expect(getFileIconToken({ filename: "bundle.tar" })).toBe("archive");
  });

  it("matches a bare filename before an extension", () => {
    expect(getFileIconToken({ filename: "Dockerfile" })).toBe("config");
    expect(getFileIconToken({ filename: "README" })).toBe("markdown");
    expect(getFileIconToken({ filename: ".env" })).toBe("ini");
  });

  it("falls back to the generic code page for a known language", () => {
    expect(getFileIconToken({ filename: "main.go" })).toBe("code");
    expect(getFileIconToken({ filename: "app.rb" })).toBe("code");
  });

  it("reads the fallback extension only when the name carries none", () => {
    expect(
      getFileIconToken({ fallbackExtension: "PDF", filename: "download" }),
    ).toBe("pdf");
    expect(
      getFileIconToken({ fallbackExtension: "pdf", filename: "notes.md" }),
    ).toBe("markdown");
  });

  it("reads a text mime type when nothing in the name resolves", () => {
    expect(
      getFileIconToken({ filename: "payload", mimeType: "text/plain" }),
    ).toBe("text");
    expect(
      getFileIconToken({
        filename: "payload",
        mimeType: "application/x-thing",
      }),
    ).toBe("unknown");
    expect(getFileIconToken({ filename: "payload" })).toBe("unknown");
  });
});
