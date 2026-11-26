import { HEADER_KEYS, type ReplyBlockName } from "./names";

/**
 * A block's body as its renderer reads it: the `key: value` header lines at
 * its top (for the keys the block takes), and the rest.
 */
export function readBlockHeader(
  code: string,
  name: ReplyBlockName,
): { body: string; header: Record<string, string> } {
  const keys = HEADER_KEYS[name];
  const lines = code.split("\n");
  const header: Record<string, string> = {};
  let index = 0;
  while (index < lines.length && lines[index]?.trim() === "") {
    index += 1;
  }
  for (; index < lines.length; index += 1) {
    const match = /^\s*([a-z]+)\s*:\s?(.*)$/i.exec(lines[index] ?? "");
    const key = match?.[1]?.toLowerCase();
    if (!match || key === undefined || !keys.includes(key)) {
      break;
    }
    header[key] ??= (match[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { body: lines.slice(index).join("\n"), header };
}

/**
 * The complete lines of a body still arriving: the last one is held back
 * until its line ends, since until then it may be half a row or half a word.
 */
export const completeLines = (body: string, isArriving: boolean) =>
  isArriving ? body.slice(0, body.lastIndexOf("\n") + 1) : body;

export type Alignment = "center" | "left" | "right" | undefined;

export interface ParsedTable {
  align: Alignment[];
  /** Lines after the table, drawn under it as Markdown. */
  after: string;
  /** Lines before the table, drawn above it as Markdown. */
  before: string;
  head: string[];
  rows: string[][];
}

const DELIMITER_CELL = /^:?-+:?$/;

/** A row's cells, split on unescaped pipes, as GFM does. */
const tableCellsOf = (line: string): string[] => {
  const trimmed = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return trimmed
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll("\\|", "|"));
};

const isTableLine = (line: string) => line.includes("|");

/**
 * The first GFM pipe table in a block's body: a header row, the delimiter
 * row, then rows until the first line that is not one. Undefined when there
 * is none, which the blocks read as "draw this as Markdown".
 */
export function parseTable(body: string): ParsedTable | undefined {
  const lines = body.split("\n");
  for (let start = 0; start + 1 < lines.length; start += 1) {
    const headLine = lines[start] ?? "";
    const delimiterLine = lines[start + 1] ?? "";
    if (!isTableLine(headLine) || !isTableLine(delimiterLine)) {
      continue;
    }
    const delimiter = tableCellsOf(delimiterLine);
    if (!delimiter.every((cell) => DELIMITER_CELL.test(cell))) {
      continue;
    }
    const head = tableCellsOf(headLine);
    if (head.length !== delimiter.length) {
      continue;
    }
    let end = start + 2;
    const rows: string[][] = [];
    while (end < lines.length) {
      const line = lines[end] ?? "";
      if (line.trim() === "" || !isTableLine(line)) {
        break;
      }
      const cells = tableCellsOf(line);
      rows.push(head.map((_, column) => cells[column] ?? ""));
      end += 1;
    }
    return {
      after: lines.slice(end).join("\n").trim(),
      align: delimiter.map((cell) =>
        cell.startsWith(":") && cell.endsWith(":")
          ? "center"
          : cell.endsWith(":")
            ? "right"
            : cell.startsWith(":")
              ? "left"
              : undefined,
      ),
      before: lines.slice(0, start).join("\n").trim(),
      head,
      rows,
    };
  }
  return undefined;
}
