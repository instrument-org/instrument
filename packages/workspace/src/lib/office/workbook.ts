import path from "node:path";

import { ZipPackage } from "./zip";

/**
 * Reading and writing the parts of an `.xlsx` package `office recalc` and
 * `office render` need, on the XML as text: the sheets by name, and each
 * cell's formula and cached value. The original's bytes stay as they were
 * everywhere a value is not written.
 */

export type Sheet = { name: string; part: string };

/** One `<c>` element in a sheet's XML, as found. */
export type CellElement = {
  /** The attributes, as written. */
  attributes: string;
  end: number;
  /** The formula's text, decoded, if it has one with text. */
  formula?: string;
  /** Whether it has an `<f>` at all, text or none (a shared formula's). */
  hasFormula: boolean;
  /** The children, as written; undefined for an empty element. */
  inner?: string;
  /** The namespace prefix the sheet writes its elements with, `x:` or none. */
  prefix: string;
  ref: string;
  start: number;
  type?: string;
  /** The cached value's text, decoded, if it has one. */
  value?: string;
};

export type CellResult = {
  formula?: string;
  type: "b" | "e" | "n" | "str";
  value: string;
};

const RELS_NS_TYPE =
  /Type="[^"]*\/officeDocument"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Type="[^"]*\/officeDocument"/;

function attribute(attributes: string, name: string): string | undefined {
  const found = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes);
  return found?.[1] === undefined ? undefined : decodeXml(found[1]);
}

export function decodeXml(text: string): string {
  return text.replaceAll(
    /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi,
    (_, hex: string | undefined, dec: string | undefined, named?: string) => {
      if (hex !== undefined) {
        return String.fromCodePoint(Number.parseInt(hex, 16));
      }
      if (dec !== undefined) {
        return String.fromCodePoint(Number(dec));
      }
      return (
        { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' }[
          named?.toLowerCase() ?? "amp"
        ] ?? "&"
      );
    },
  );
}

export function encodeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** A part a relationship names, from the folder of the part that names it. */
function resolvePart(from: string, target: string): string {
  return target.startsWith("/")
    ? target.slice(1)
    : path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
}

function relsOf(part: string): string {
  return path.posix.join(
    path.posix.dirname(part),
    "_rels",
    `${path.posix.basename(part)}.rels`,
  );
}

/** The workbook part, `xl/workbook.xml` in every writer we know. */
export function workbookPart(zip: ZipPackage): string {
  const found = RELS_NS_TYPE.exec(zip.text("_rels/.rels") ?? "");
  const target = found?.[1] ?? found?.[2];
  return target ? resolvePart("", target) : "xl/workbook.xml";
}

/** The worksheets, in the workbook's order, by name and part. */
export function sheetsOf(zip: ZipPackage): Sheet[] {
  const workbook = workbookPart(zip);
  const rels = new Map<string, string>();
  for (const [, attributes = ""] of (zip.text(relsOf(workbook)) ?? "").matchAll(
    /<Relationship\b([^>]*)\/?>/g,
  )) {
    const id = attribute(attributes, "Id");
    const target = attribute(attributes, "Target");
    if (id !== undefined && target !== undefined) {
      rels.set(id, resolvePart(workbook, target));
    }
  }
  const sheets: Sheet[] = [];
  for (const [, attributes = ""] of (zip.text(workbook) ?? "").matchAll(
    /<(?:\w+:)?sheet\b([^>]*)\/?>/g,
  )) {
    const name = attribute(attributes, "name");
    const id = /\br:id="([^"]*)"|\b\w+:id="([^"]*)"/.exec(attributes);
    const part = rels.get(id?.[1] ?? id?.[2] ?? "");
    if (name !== undefined && part !== undefined && zip.has(part)) {
      sheets.push({ name, part });
    }
  }
  return sheets;
}

/** Every `<c>` in a sheet's XML, in order. */
export function cellsOf(xml: string): CellElement[] {
  const cells: CellElement[] = [];
  for (const match of xml.matchAll(
    /<((?:\w+:)?)c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1c>)/g,
  )) {
    const [whole, prefix = "", attributes = "", inner] = match;
    const ref = attribute(attributes, "r");
    if (ref === undefined) {
      continue;
    }
    const f = inner?.match(
      new RegExp(`<${prefix}f\\b[^>]*?(?:/>|>([\\s\\S]*?)</${prefix}f>)`),
    );
    const v = inner?.match(
      new RegExp(`<${prefix}v\\b[^>]*?(?:/>|>([\\s\\S]*?)</${prefix}v>)`),
    );
    cells.push({
      attributes,
      end: match.index + whole.length,
      ...(f?.[1] ? { formula: decodeXml(f[1]) } : {}),
      hasFormula: f !== null && f !== undefined,
      ...(inner === undefined ? {} : { inner }),
      prefix,
      ref,
      start: match.index,
      ...(attribute(attributes, "t") === undefined
        ? {}
        : { type: attribute(attributes, "t") }),
      ...(v?.[1] === undefined ? {} : { value: decodeXml(v[1]) }),
    });
  }
  return cells;
}

/** The shared strings, by index. */
function sharedStrings(zip: ZipPackage, workbook: string): string[] {
  const xml =
    zip.text(
      path.posix.join(path.posix.dirname(workbook), "sharedStrings.xml"),
    ) ?? "";
  return [
    ...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g),
  ].map(([, si = ""]) =>
    [...si.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)]
      .map(([, text = ""]) => decodeXml(text))
      .join(""),
  );
}

/**
 * Every formula cell's computed value in a workbook LibreOffice wrote, by
 * sheet name and cell.
 */
export function formulaResults(
  zip: ZipPackage,
): Map<string, Map<string, CellResult>> {
  const strings = sharedStrings(zip, workbookPart(zip));
  const results = new Map<string, Map<string, CellResult>>();
  for (const sheet of sheetsOf(zip)) {
    const cells = new Map<string, CellResult>();
    for (const cell of cellsOf(zip.text(sheet.part) ?? "")) {
      if (!cell.hasFormula) {
        continue;
      }
      const formula =
        cell.formula === undefined ? {} : { formula: cell.formula };
      const value = cell.value ?? "";
      switch (cell.type) {
        case "b":
        case "e":
        case "str":
          cells.set(cell.ref, { ...formula, type: cell.type, value });
          break;
        case "s":
          cells.set(cell.ref, {
            ...formula,
            type: "str",
            value: strings[Number(value)] ?? "",
          });
          break;
        case "inlineStr":
          cells.set(cell.ref, { ...formula, type: "str", value });
          break;
        default:
          if (cell.value !== undefined) {
            cells.set(cell.ref, { ...formula, type: "n", value });
          }
      }
    }
    results.set(sheet.name, cells);
  }
  return results;
}

/** A cell reference's column and row, `B7` → [2, 7]. */
export function cellPosition(ref: string): [number, number] | undefined {
  const found = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  if (!found?.[1] || !found[2]) {
    return undefined;
  }
  let column = 0;
  for (const letter of found[1].toUpperCase()) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }
  return [column, Number(found[2])];
}

export function columnName(column: number): string {
  let name = "";
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  }
  return name;
}

/**
 * Each sheet's used range: the smallest rectangle around every cell with a
 * value, a formula or text. Undefined for an empty sheet.
 */
export function usedRanges(
  zip: ZipPackage,
): { name: string; range: string | undefined }[] {
  return sheetsOf(zip).map((sheet) => {
    let low: [number, number] | undefined;
    let high: [number, number] | undefined;
    for (const cell of cellsOf(zip.text(sheet.part) ?? "")) {
      if (
        !cell.hasFormula &&
        cell.value === undefined &&
        !/<(?:\w+:)?is\b/.test(cell.inner ?? "")
      ) {
        continue;
      }
      const at = cellPosition(cell.ref);
      if (!at) {
        continue;
      }
      low = low ? [Math.min(low[0], at[0]), Math.min(low[1], at[1])] : at;
      high = high ? [Math.max(high[0], at[0]), Math.max(high[1], at[1])] : at;
    }
    return {
      name: sheet.name,
      range:
        low && high
          ? `${columnName(low[0])}${low[1]}:${columnName(high[0])}${high[1]}`
          : undefined,
    };
  });
}
