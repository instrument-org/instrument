import { describe, expect, it } from "vitest";

import { referencedAreas, withFullCalcOnLoad, writeBack } from "./recalc";
import { usedRanges } from "./workbook";
import { ZipPackage, zipOf } from "./zip";

const MAIN =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const REL =
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function workbook(
  sheets: Record<string, string>,
  extra: Record<string, string> = {},
) {
  const names = Object.keys(sheets);
  return zipOf(
    new Map<string, string>([
      [
        "[Content_Types].xml",
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      ],
      [
        "_rels/.rels",
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ],
      [
        "xl/workbook.xml",
        `<workbook ${MAIN}><sheets>${names
          .map(
            (name, i) =>
              `<sheet ${REL} name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
          )
          .join(
            "",
          )}</sheets><calcPr calcId="124519" fullCalcOnLoad="0"/></workbook>`,
      ],
      [
        "xl/_rels/workbook.xml.rels",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
          .map(
            (_, i) =>
              `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet${i + 1}.xml" Id="rId${i + 1}"/>`,
          )
          .join("")}</Relationships>`,
      ],
      ...Object.values(sheets).map((cells, i): [string, string] => [
        `xl/worksheets/sheet${i + 1}.xml`,
        `<worksheet ${MAIN}><sheetData>${cells}</sheetData></worksheet>`,
      ]),
      ["xl/styles.xml", `<styleSheet ${MAIN}><fonts count="1"/></styleSheet>`],
      ...Object.entries(extra),
    ]),
  );
}

// What openpyxl writes: formulas with empty cached values, one stale.
const ORIGINAL = workbook({
  Data: '<row r="1"><c r="A1" t="n"><v>10</v></c><c r="B1" t="n"><v>4</v></c></row>',
  Summary:
    '<row r="1"><c r="A1" s="3"><f>Data!A1*2</f><v></v></c>' +
    '<c r="B1" s="3" t="str"><f>"Total: "&amp;Data!B1</f><v>stale</v></c></row>' +
    '<row r="2"><c r="A2"><f>Data!A1/0</f><v></v></c>' +
    '<c r="B2"><f>_xlfn.PERCENTOF(Data!A1,Data!A1:B1)</f><v></v></c>' +
    '<c r="C2"><f>ROUND(B2,2)</f><v></v></c>' +
    '<c r="D2"><f>Data!B1&gt;3</f><v>0</v></c></row>' +
    '<row r="3"><c r="A3"><f t="shared" ref="A3:A4" si="0">A1+1</f><v>1</v></c></row>' +
    '<row r="4"><c r="A4"><f t="shared" si="0"/><v>1</v></c></row>',
});

// What LibreOffice exports for it, recalculated.
const RECALCULATED = workbook(
  {
    Data: '<row r="1"><c r="A1" s="0" t="n"><v>10</v></c><c r="B1" s="0" t="n"><v>4</v></c></row>',
    Summary:
      '<row r="1"><c r="A1" s="0" t="n"><f aca="false">Data!A1*2</f><v>20</v></c>' +
      '<c r="B1" s="0" t="s"><f aca="false">"Total: "&amp;Data!B1</f><v>0</v></c></row>' +
      '<row r="2"><c r="A2" s="0" t="e"><f aca="false">Data!A1/0</f><v>#DIV/0!</v></c>' +
      '<c r="B2" s="0" t="e"><f aca="false">_xlfn.percentof(Data!A1,Data!A1:B1)</f><v>#NAME?</v></c>' +
      '<c r="C2" s="0" t="e"><f aca="false">ROUND(B2,2)</f><v>#NAME?</v></c>' +
      '<c r="D2" s="0" t="b"><f aca="false">Data!B1&gt;3</f><v>1</v></c></row>' +
      '<row r="3"><c r="A3" s="0" t="n"><f aca="false">A1+1</f><v>21</v></c></row>' +
      '<row r="4"><c r="A4" s="0" t="e"><f aca="false">A2+1</f><v>#DIV/0!</v></c></row>',
  },
  {
    "xl/sharedStrings.xml": `<sst ${MAIN} count="1" uniqueCount="1"><si><t xml:space="preserve">Total: 4</t></si></sst>`,
  },
);

describe("writeBack", () => {
  const outcome = writeBack(ORIGINAL, RECALCULATED);
  const written = ZipPackage.read(outcome.bytes);

  it("writes each formula's value into the original's cells", () => {
    expect(written.text("xl/worksheets/sheet2.xml")).toMatchInlineSnapshot(
      `"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" s="3"><f>Data!A1*2</f><v>20</v></c><c r="B1" s="3" t="str"><f>"Total: "&amp;Data!B1</f><v>Total: 4</v></c></row><row r="2"><c r="A2" t="e"><f>Data!A1/0</f><v>#DIV/0!</v></c><c r="B2"><f>_xlfn.PERCENTOF(Data!A1,Data!A1:B1)</f></c><c r="C2"><f>ROUND(B2,2)</f></c><c r="D2" t="b"><f>Data!B1&gt;3</f><v>1</v></c></row><row r="3"><c r="A3"><f t="shared" ref="A3:A4" si="0">A1+1</f><v>21</v></c></row><row r="4"><c r="A4" t="e"><f t="shared" si="0"/><v>#DIV/0!</v></c></row></sheetData></worksheet>"`,
    );
  });

  it("sorts the file's errors from what LibreOffice cannot compute", () => {
    expect(outcome.formulas).toBe(8);
    expect(outcome.errors).toEqual([
      { cell: "Summary!A2", error: "#DIV/0!", formula: "=Data!A1/0" },
      // A shared formula's cell names LibreOffice's text of it.
      { cell: "Summary!A4", error: "#DIV/0!", formula: "=A2+1" },
    ]);
    expect(outcome.unsupported).toEqual({ cells: 2, functions: ["PERCENTOF"] });
  });

  it("counts the cached values that were stale", () => {
    // B1's text, D2's boolean and the shared formula's two cells had values
    // cached; the empty ones openpyxl writes are not stale, only missing.
    expect(outcome.changed).toBe(4);
  });

  it("asks Excel to recalculate on open", () => {
    expect(written.text("xl/workbook.xml")).toContain('fullCalcOnLoad="1"');
  });

  it("leaves every other part byte for byte, compressed data included", () => {
    const before = ZipPackage.read(ORIGINAL);
    expect(written.names()).toEqual(before.names());
    for (const name of [
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "_rels/.rels",
    ]) {
      expect(
        written.get(name)?.equals(before.get(name) ?? Buffer.alloc(0)),
      ).toBe(true);
    }
    const rawOf = (bytes: Buffer, name: string) => {
      const at = bytes.indexOf(Buffer.from(name));
      return bytes.subarray(at, at + 200);
    };
    expect(rawOf(outcome.bytes, "xl/styles.xml")).toEqual(
      rawOf(ORIGINAL, "xl/styles.xml"),
    );
  });

  it("reads back as a ZIP any reader takes", () => {
    for (const name of written.names()) {
      expect(written.get(name)).toBeDefined();
    }
  });
});

describe("withFullCalcOnLoad", () => {
  it.each([
    [
      '<workbook><calcPr calcId="1" fullCalcOnLoad="0"/></workbook>',
      '<workbook><calcPr calcId="1" fullCalcOnLoad="1"/></workbook>',
    ],
    [
      '<workbook><calcPr calcId="1"/></workbook>',
      '<workbook><calcPr calcId="1" fullCalcOnLoad="1"/></workbook>',
    ],
    [
      "<workbook><sheets/><definedNames/><extLst/></workbook>",
      '<workbook><sheets/><definedNames/><calcPr fullCalcOnLoad="1"/><extLst/></workbook>',
    ],
    [
      "<x:workbook><x:sheets/></x:workbook>",
      '<x:workbook><x:sheets/><x:calcPr fullCalcOnLoad="1"/></x:workbook>',
    ],
  ])("%s", (xml, expected) => {
    expect(withFullCalcOnLoad(xml)).toBe(expected);
  });
});

describe("referencedAreas", () => {
  it("reads cells and ranges, on other sheets too, and skips text", () => {
    expect(
      referencedAreas(
        `SUM(A1:B3)+'My Sheet'!C4+Data!$D$5+LEN("Z9")`,
        "Summary",
      ),
    ).toEqual([
      { bottom: [2, 3], sheet: "Summary", top: [1, 1] },
      { bottom: [3, 4], sheet: "My Sheet", top: [3, 4] },
      { bottom: [4, 5], sheet: "Data", top: [4, 5] },
    ]);
  });
});

describe("usedRanges", () => {
  it("gives each sheet the rectangle around its filled cells", () => {
    expect(usedRanges(ZipPackage.read(ORIGINAL))).toEqual([
      { name: "Data", range: "A1:B1" },
      { name: "Summary", range: "A1:D4" },
    ]);
  });
});
