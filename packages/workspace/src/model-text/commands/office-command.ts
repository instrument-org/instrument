/**
 * The `office` command's description in the bash tool, its usage, and the
 * lines it prints for the agent to act on.
 */
export const OFFICE_COMMAND = {
  description:
    "Word, PowerPoint and Excel files through LibreOffice (its first use downloads it, about 300 MB, once). `office render <file>` writes a PDF beside it and a PNG per page to read; `office recalc <file.xlsx>` computes every formula, writes the values into the file and lists errors (`--check` only reports); `office convert <file> --to <ext>` converts (pdf, docx, xlsx, pptx, csv, legacy .doc/.xls/.ppt). `soffice` runs too.",
  name: "office",
} as const;

export const SOFFICE_COMMAND = {
  description:
    "LibreOffice's own command line, headless, with a fresh profile per call.",
  name: "soffice",
} as const;

export const OFFICE_USAGE = `Usage:
  office render <file> [--pages <n|n-m|none>] [--out <dir>]
      PDF beside the file, and <name>-pages/page-N.png (at most 30 pages).
      .docx .doc .odt .rtf .pptx .ppt .odp .xlsx .xls .ods
  office recalc <file.xlsx> [--check]
      Computes every formula and writes the values into the file; --check only reports.
  office convert <file> --to <ext> [--out <dir>]
      Into the current folder unless --out. csv writes one file per sheet.
A render shows what LibreOffice draws, which is close to but not exactly what Word, PowerPoint or Excel draw.
`;

/** Why nothing ran: LibreOffice could not be had. */
export function officeUnavailable(reason: string): string {
  return `office: LibreOffice could not be downloaded (${reason}). Nothing was rendered, converted or recalculated; say so plainly. The browser preview still shows Word and PowerPoint files.`;
}

/** The note after a recalc that found functions LibreOffice does not compute. */
export function unsupportedFunctionsNote(
  cells: number,
  functions: readonly string[],
): string {
  return `! ${cells} ${cells === 1 ? "cell uses" : "cells use"} functions LibreOffice does not compute${functions.length > 0 ? ` (${functions.join(", ")})` : ""}; Excel computes them when the file opens. Their cached values are left empty.`;
}

export const PAGES_NOTE = "  read the pages with the file tool to see them";
