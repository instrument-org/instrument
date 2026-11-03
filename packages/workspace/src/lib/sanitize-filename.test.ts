import { describe, expect, it } from "vitest";

import { sanitizeFilename } from "./sanitize-filename";

describe("sanitizeFilename", () => {
  it.each([
    [
      "leaves a plain name with a space unchanged",
      "my report.pdf",
      "my report.pdf",
    ],
    ["keeps accented letters", "résumé.pdf", "résumé.pdf"],
    ["composes a decomposed name", "re\u0301sume\u0301.pdf", "résumé.pdf"],
    ["keeps CJK", "会議メモ.pdf", "会議メモ.pdf"],
    ["keeps an emoji and its joiner", "👨‍👩‍👧 trip.jpg", "👨‍👩‍👧 trip.jpg"],
    ["keeps only the name after a separator", "a/b\\c.txt", "c.txt"],
    ["drops what Windows refuses", 'q<3>: "why"|now?*.txt', "q3 whynow.txt"],
    ["drops direction overrides", "invoice\u202Etxt.exe", "invoicetxt.exe"],
    ["drops a trailing dot", "notes..txt", "notes.txt"],
    ["renames a Windows device name", "CON.txt", "CON_.txt"],
    [
      "keeps the dots of a screenshot's time before its extension",
      "Screenshot 2026-02-19 at 9.11.07 AM.png",
      "Screenshot 2026-02-19 at 9.11.07 AM.png",
    ],
    [
      "turns a narrow no-break space into a space, reading no extension",
      "Screenshot 2026-02-19 at 9.47.51\u202FAM",
      "Screenshot 2026-02-19 at 9.47.51 AM",
    ],
    ["collapses multiple spaces", "my  file.txt", "my file.txt"],
    ["collapses multiple dashes", "my--file.txt", "my-file.txt"],
    ["trims spaces around the name", " file.txt ", "file.txt"],
    ["names it file when nothing is left", "\u200B", "file"],
    [
      "cuts the name to 200 bytes, keeping the extension",
      `${"a".repeat(201)}.txt`,
      `${"a".repeat(200)}.txt`,
    ],
    [
      "truncates a CJK base to 200 bytes on a character boundary",
      `${"文".repeat(100)}.txt`,
      `${"文".repeat(66)}.txt`,
    ],
  ])("%s", (_label, input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });
});
