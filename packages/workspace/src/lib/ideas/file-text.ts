import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  cellPosition,
  cellsOf,
  sharedStrings,
  sheetsOf,
  usedRanges,
  workbookPart,
} from "../office/workbook";
import { ZipPackage } from "../office/zip";

/**
 * A file's text for an idea's context, read from disk with the app's own
 * readers and cut to `budget` characters: Markdown, CSV and other text as
 * text, a workbook's sheets as rows, a Word document's paragraphs, a deck's
 * slides. Undefined, with why, for a file this cannot read, which the
 * context names in one line.
 */

/** Past this a file is named, not read: reading it would hold up the call. */
const FILE_BYTES_MAX = 25 * 1024 * 1024;

/** The rows of a table a context shows before it says how many are left. */
const ROWS_SHOWN = 20;

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cpp",
  ".css",
  ".go",
  ".h",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".log",
  ".md",
  ".markdown",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export type FileText = { text: string } | { unreadable: string };

export async function fileText(
  shownPath: string,
  budget: number,
): Promise<FileText> {
  // A folder the window names from the home folder.
  const filePath = shownPath.replace(/^~(?=\/|$)/, os.homedir());
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { unreadable: "not found" };
  }
  if (stat.isDirectory()) {
    return { text: await folderText(filePath, budget) };
  }
  if (stat.size > FILE_BYTES_MAX) {
    return { unreadable: "too large to read" };
  }
  const extension = path.extname(filePath).toLowerCase();
  try {
    switch (extension) {
      case ".csv":
      case ".tsv": {
        return { text: csvText(await fs.readFile(filePath, "utf8"), budget) };
      }
      case ".xlsx": {
        return { text: workbookText(await fs.readFile(filePath), budget) };
      }
      case ".docx": {
        return { text: documentText(await fs.readFile(filePath), budget) };
      }
      case ".pptx": {
        return { text: deckText(await fs.readFile(filePath), budget) };
      }
      case ".md":
      case ".markdown": {
        return {
          text: markdownText(await fs.readFile(filePath, "utf8"), budget),
        };
      }
      default: {
        if (!TEXT_EXTENSIONS.has(extension)) {
          return { unreadable: `a ${extension || "binary"} file` };
        }
        return {
          text: cut(await fs.readFile(filePath, "utf8"), budget),
        };
      }
    }
  } catch {
    return { unreadable: "could not be read" };
  }
}

/** Text cut to `budget` at a line's end where one is near, never mid-word. */
export function cut(text: string, budget: number): string {
  if (text.length <= budget) {
    return text;
  }
  const head = text.slice(0, budget);
  const lineEnd = head.lastIndexOf("\n");
  return `${lineEnd > budget * 0.8 ? head.slice(0, lineEnd) : head.replace(/\S*$/, "")}\n…`;
}

/** A long Markdown file's headings first, so its shape survives the cut. */
function markdownText(text: string, budget: number): string {
  if (text.length <= budget) {
    return text;
  }
  const outline = text
    .split("\n")
    .filter((line) => /^#{1,3}\s/.test(line))
    .slice(0, 40)
    .join("\n");
  const head = outline ? `Outline:\n${cut(outline, budget / 4)}\n\n` : "";
  return head + cut(text, budget - head.length);
}

function csvText(text: string, budget: number): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const shown = lines.slice(0, ROWS_SHOWN + 1).join("\n");
  const more =
    lines.length > ROWS_SHOWN + 1
      ? `\n(${lines.length - ROWS_SHOWN - 1} more rows)`
      : "";
  return cut(shown, budget - more.length) + more;
}

/** Each sheet's name and used range, then the first sheet's first rows of values. */
function workbookText(bytes: Buffer, budget: number): string {
  const zip = ZipPackage.read(bytes);
  const strings = sharedStrings(zip, workbookPart(zip));
  const ranges = usedRanges(zip);
  const parts: string[] = [];
  for (const [index, sheet] of sheetsOf(zip).entries()) {
    const range = ranges[index]?.range;
    parts.push(`Sheet "${sheet.name}"${range ? ` (${range})` : " (empty)"}`);
    if (index > 1 || !range) {
      continue;
    }
    const rows = new Map<number, string[]>();
    for (const cell of cellsOf(zip.text(sheet.part) ?? "")) {
      const at = cellPosition(cell.ref);
      const value =
        cell.type === "s"
          ? strings[Number(cell.value)]
          : cell.type === "inlineStr"
            ? (/<(?:\w+:)?t\b[^>]*>([\s\S]*?)</.exec(cell.inner ?? "")?.[1] ??
              "")
            : cell.value;
      if (!at || value === undefined || value === "") {
        continue;
      }
      const row = rows.get(at[1]) ?? [];
      row[at[0] - 1] = value;
      rows.set(at[1], row);
    }
    const ordered = [...rows.entries()].toSorted(([a], [b]) => a - b);
    for (const [, row] of ordered.slice(0, ROWS_SHOWN)) {
      parts.push(`| ${Array.from(row, (value) => value ?? "").join(" | ")} |`);
    }
    if (ordered.length > ROWS_SHOWN) {
      parts.push(`(${ordered.length - ROWS_SHOWN} more rows)`);
    }
  }
  return cut(parts.join("\n"), budget);
}

const decode = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

/** A Word document's paragraphs, a heading marked as one. */
function documentText(bytes: Buffer, budget: number): string {
  const xml = ZipPackage.read(bytes).text("word/document.xml") ?? "";
  const paragraphs: string[] = [];
  for (const [paragraph = ""] of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const words = [...paragraph.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)]
      .map(([, text = ""]) => decode(text))
      .join("")
      .trim();
    if (!words) {
      continue;
    }
    const level = /<w:pStyle w:val="Heading(\d)"/.exec(paragraph)?.[1];
    paragraphs.push(level ? `${"#".repeat(Number(level))} ${words}` : words);
    if (paragraphs.join("\n").length > budget) {
      break;
    }
  }
  return cut(paragraphs.join("\n"), budget);
}

/** A deck's slides in order, a line of text each. */
function deckText(bytes: Buffer, budget: number): string {
  const zip = ZipPackage.read(bytes);
  const slides: string[] = [];
  for (let number = 1; zip.has(`ppt/slides/slide${number}.xml`); number++) {
    const words = [
      ...(zip.text(`ppt/slides/slide${number}.xml`) ?? "").matchAll(
        /<a:t>([^<]*)<\/a:t>/g,
      ),
    ]
      .map(([, text = ""]) => decode(text).trim())
      .filter(Boolean)
      .join(" · ");
    slides.push(`Slide ${number}: ${words}`);
  }
  return cut(slides.join("\n"), budget);
}

/** A folder's entries, folders first, by name. */
async function folderText(folder: string, budget: number): Promise<string> {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const names = entries
    .filter((entry) => !entry.name.startsWith("."))
    .toSorted(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  return cut(`Folder with ${names.length} items:\n${names.join("\n")}`, budget);
}
