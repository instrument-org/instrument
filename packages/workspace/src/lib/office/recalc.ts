import {
  type CellElement,
  type CellResult,
  cellPosition,
  cellsOf,
  encodeXml,
  formulaResults,
  sheetsOf,
  workbookPart,
} from "./workbook";
import { ZipPackage } from "./zip";

type FormulaError = {
  cell: string;
  error: string;
  formula: string;
};

export type RecalcOutcome = {
  /** The original package with the computed values written in. */
  bytes: Buffer;
  /** Cells whose result is an error Excel would show too. */
  errors: FormulaError[];
  formulas: number;
  /**
   * The Excel functions LibreOffice does not compute, by name, and how
   * many cells use them or depend on one that does.
   */
  unsupported: { cells: number; functions: string[] };
  /** Cells whose cached value the file had and LibreOffice changed. */
  changed: number;
};

/**
 * A function Excel knows and LibreOffice does not: the file names it with
 * Excel's `_xlfn.` prefix, and LibreOffice writes back what it could not
 * parse in lowercase.
 */
const UNKNOWN_EXCEL_FUNCTION = /_xlfn\.(?:_xlws\.)?([a-z][a-z0-9_.]*)\s*\(/g;

type Area = {
  sheet: string;
  top: [number, number];
  bottom: [number, number];
};

/**
 * The cells and ranges a formula refers to, on `sheet` unless it names
 * another. String literals are skipped, so text that looks like a
 * reference is not one.
 */
export function referencedAreas(formula: string, sheet: string): Area[] {
  const areas: Area[] = [];
  const code = formula.replaceAll(/"(?:[^"]|"")*"/g, '""');
  for (const found of code.matchAll(
    /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?(?![\w(])/g,
  )) {
    const [, quoted, bare, first = "", second] = found;
    const top = cellPosition(first);
    const bottom = second === undefined ? top : cellPosition(second);
    if (!top || !bottom) {
      continue;
    }
    areas.push({
      bottom: [Math.max(top[0], bottom[0]), Math.max(top[1], bottom[1])],
      sheet: quoted?.replaceAll("''", "'") ?? bare ?? sheet,
      top: [Math.min(top[0], bottom[0]), Math.min(top[1], bottom[1])],
    });
  }
  return areas;
}

function within(area: Area, sheet: string, at: [number, number]) {
  return (
    area.sheet === sheet &&
    at[0] >= area.top[0] &&
    at[0] <= area.bottom[0] &&
    at[1] >= area.top[1] &&
    at[1] <= area.bottom[1]
  );
}

/** A sheet name as a formula spells it: quoted when it has to be. */
function sheetLabel(name: string): string {
  return /^[A-Za-z_][\w.]*$/.test(name)
    ? name
    : `'${name.replaceAll("'", "''")}'`;
}

/** The cell's `<c>` element with its cached value set to `result`, or none. */
function withCachedValue(
  cell: CellElement,
  result: CellResult | undefined,
): string {
  const p = cell.prefix;
  let attributes = cell.attributes.replace(/\s+t="[^"]*"/, "");
  const type = result?.type === "n" || !result ? undefined : result.type;
  if (type) {
    attributes = `${attributes} t="${type}"`;
  }
  const inner = (cell.inner ?? "").replace(
    new RegExp(`<${p}v\\b[^>]*?(?:/>|>[\\s\\S]*?</${p}v>)`),
    "",
  );
  const value = result ? `<${p}v>${encodeXml(result.value)}</${p}v>` : "";
  // The value goes right after the formula, where the schema has it.
  const formulaEnd = new RegExp(
    `<${p}f\\b[^>]*?(?:/>|>[\\s\\S]*?</${p}f>)`,
  ).exec(inner);
  const children = formulaEnd
    ? inner.slice(0, formulaEnd.index + formulaEnd[0].length) +
      value +
      inner.slice(formulaEnd.index + formulaEnd[0].length)
    : inner + value;
  return `<${p}c${attributes}>${children}</${p}c>`;
}

/**
 * The workbook part with `fullCalcOnLoad` set, so Excel computes every
 * formula when it opens the file whatever was cached.
 */
export function withFullCalcOnLoad(xml: string): string {
  const calcPr = /<((?:\w+:)?)calcPr\b([^>]*?)(\/?)>/.exec(xml);
  if (calcPr) {
    const [whole, prefix = "", attributes = "", selfClosing = ""] = calcPr;
    const updated = /\sfullCalcOnLoad="[^"]*"/.test(attributes)
      ? attributes.replace(/\sfullCalcOnLoad="[^"]*"/, ' fullCalcOnLoad="1"')
      : `${attributes} fullCalcOnLoad="1"`;
    return xml.replace(whole, `<${prefix}calcPr${updated}${selfClosing}>`);
  }
  // Before the first element the schema puts after it, or at the end.
  const prefix = /<((?:\w+:)?)workbook\b/.exec(xml)?.[1] ?? "";
  const after = new RegExp(
    `<${prefix}(?:oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\\b|</${prefix}workbook>`,
  ).exec(xml);
  if (!after) {
    return xml;
  }
  return `${xml.slice(0, after.index)}<${prefix}calcPr fullCalcOnLoad="1"/>${xml.slice(after.index)}`;
}

/**
 * Writes the values LibreOffice computed (`recalculated`, its export of the
 * workbook) into the original package as each formula cell's cached value,
 * and sorts the errors into the file's own and the cells LibreOffice could
 * not compute. A cell of the second kind is left with no cached value, so
 * no reader takes LibreOffice's error for Excel's answer.
 */
export function writeBack(
  original: Uint8Array,
  recalculated: Uint8Array,
): RecalcOutcome {
  const zip = ZipPackage.read(original);
  const results = formulaResults(ZipPackage.read(recalculated));

  type Found = {
    cell: CellElement;
    result: CellResult | undefined;
    sheet: string;
    unsupported: string[];
  };
  const found: Found[] = [];
  const sheets = sheetsOf(zip);
  const sheetXml = new Map<string, string>();
  for (const sheet of sheets) {
    const xml = zip.text(sheet.part) ?? "";
    sheetXml.set(sheet.part, xml);
    const computed = results.get(sheet.name);
    for (const cell of cellsOf(xml)) {
      if (!cell.hasFormula) {
        continue;
      }
      const result = computed?.get(cell.ref);
      const unsupported = [
        ...(result?.formula ?? "").matchAll(UNKNOWN_EXCEL_FUNCTION),
      ].map(([, name = ""]) => name.toUpperCase());
      found.push({ cell, result, sheet: sheet.name, unsupported });
    }
  }

  // An error in a cell that refers to one LibreOffice could not compute is
  // that cell's, not its own: followed until nothing more is added.
  const cannot = new Set(found.filter((each) => each.unsupported.length > 0));
  for (let grew = true; grew;) {
    grew = false;
    for (const each of found) {
      if (cannot.has(each) || each.result?.type !== "e") {
        continue;
      }
      const areas = referencedAreas(
        each.result.formula ?? each.cell.formula ?? "",
        each.sheet,
      );
      const depends = [...cannot].some((source) => {
        const at = cellPosition(source.cell.ref);
        return (
          at !== undefined &&
          areas.some((area) => within(area, source.sheet, at))
        );
      });
      if (depends) {
        cannot.add(each);
        grew = true;
      }
    }
  }

  const errors: FormulaError[] = [];
  let changed = 0;
  const replaced = new Map<string, Buffer>();
  for (const sheet of sheets) {
    const xml = sheetXml.get(sheet.part) ?? "";
    const here = found.filter((each) => each.sheet === sheet.name);
    let out = "";
    let at = 0;
    for (const each of here) {
      if (!cannot.has(each) && each.result === undefined) {
        continue;
      }
      const result = cannot.has(each) ? undefined : each.result;
      if (result?.type === "e") {
        errors.push({
          cell: `${sheetLabel(sheet.name)}!${each.cell.ref}`,
          error: result.value,
          formula: `=${each.cell.formula ?? result.formula ?? ""}`,
        });
      }
      if (
        each.cell.value !== undefined &&
        each.cell.value !== "" &&
        result !== undefined &&
        each.cell.value !== result.value
      ) {
        changed++;
      }
      out +=
        xml.slice(at, each.cell.start) + withCachedValue(each.cell, result);
      at = each.cell.end;
    }
    if (here.length > 0) {
      replaced.set(sheet.part, Buffer.from(out + xml.slice(at), "utf8"));
    }
  }
  const workbook = workbookPart(zip);
  replaced.set(
    workbook,
    Buffer.from(withFullCalcOnLoad(zip.text(workbook) ?? ""), "utf8"),
  );

  return {
    bytes: zip.withParts(replaced),
    changed,
    errors,
    formulas: found.length,
    unsupported: {
      cells: cannot.size,
      functions: [
        ...new Set([...cannot].flatMap((each) => each.unsupported)),
      ].sort(),
    },
  };
}
