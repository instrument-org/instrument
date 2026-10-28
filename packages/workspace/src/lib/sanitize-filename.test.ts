import { describe, expect, it } from "vitest";

import { sanitizeFilename } from "./sanitize-filename";

describe("sanitizeFilename", () => {
  it.each([
    ["plain ASCII filename unchanged", "report.pdf", "report.pdf"],
    ["filename with spaces unchanged", "my report.pdf", "my report.pdf"],
    ["keeps accented letters", "résumé.pdf", "résumé.pdf"],
    ["composes a decomposed name", "re\u0301sume\u0301.pdf", "résumé.pdf"],
    ["keeps CJK", "会議メモ.pdf", "会議メモ.pdf"],
    ["keeps Cyrillic", "Отчёт.xlsx", "Отчёт.xlsx"],
    ["keeps an emoji and its joiner", "👨‍👩‍👧 trip.jpg", "👨‍👩‍👧 trip.jpg"],
    ["keeps only the name after a separator", "a/b\\c.txt", "c.txt"],
    ["drops what Windows refuses", 'q<3>: "why"|now?*.txt', "q3 whynow.txt"],
    ["drops direction overrides", "invoice\u202Etxt.exe", "invoicetxt.exe"],
    ["drops a trailing dot", "notes..txt", "notes.txt"],
    ["renames a Windows device name", "CON.txt", "CON_.txt"],
    [
      "real-world screenshot filename unchanged",
      "Screenshot 2026-02-19 at 9.11.07 AM.png",
      "Screenshot 2026-02-19 at 9.11.07 AM.png",
    ],
    [
      "macOS screenshot filenames with narrow space (U+202F) normalized to regular space",
      "Screenshot 2026-02-19 at 9.47.51 AM",
      "Screenshot 2026-02-19 at 9.47.51 AM",
    ],
    ["collapses multiple spaces", "my  file.txt", "my file.txt"],
    ["collapses multiple dashes", "my--file.txt", "my-file.txt"],
    ["trims leading/trailing spaces", " file.txt ", "file.txt"],
    [
      "falls back to 'file' when base is empty after sanitizing",
      "\u200B",
      "file",
    ],
    // length cap
    [
      "truncates base to 200 bytes",
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
