import Papa from "papaparse";
import { describe, expect, it } from "vitest";

import {
  applyEdit,
  applySplices,
  changedCells,
  type CsvEdit,
  detectDelimiter,
  lineOf,
  parseCsv,
  recordKey,
  replayEdits,
  spliceAddColumn,
  spliceCell,
  spliceDeleteRows,
  spliceInsertRow,
} from "./csv-text";

const QUOTED =
  'id,name,notes,city\n1,Ann,"likes ""tea"", and cake",Paris\n2,"Bob, Jr.","line one\nline two",Berlin\n3,Cy,plain,"New York"\n';
const CRLF_BOM =
  '﻿code,label,amount\r\nA1,First,10\r\nA2,"Second, quoted",20\r\nA3,Third,30';

const set = (text: string, record: number, column: number, value: string) => {
  const doc = parseCsv(text, detectDelimiter("x.csv", text));
  return applySplices(text, [spliceCell(doc, record, column, value)]);
};

describe("parseCsv", () => {
  it.each([QUOTED, CRLF_BOM, "a;b\n1;2\n", "a\tb\n\n1\t2\n"])(
    "reads what Papa reads: %j",
    (text) => {
      const doc = parseCsv(text, detectDelimiter("x.csv", text));
      const papa = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
        delimiter: doc.delimiter,
        skipEmptyLines: "greedy",
      }).data;
      expect(
        [doc.headerRecord, ...doc.rowRecords].map((r) => doc.values[r]),
      ).toEqual(papa);
    },
  );

  it("keeps the BOM, the line ending and the missing trailing newline", () => {
    const doc = parseCsv(CRLF_BOM, ",");
    expect([doc.bom, doc.eol, doc.values.length]).toEqual([true, "\r\n", 4]);
  });
});

describe("splices", () => {
  it("changes only the edited field's bytes", () => {
    expect(set(QUOTED, 1, 1, "Anne")).toBe(QUOTED.replace("Ann,", "Anne,"));
  });

  it("keeps a quoted field quoted and quotes a value that needs it", () => {
    expect(set(QUOTED, 3, 3, "Boston")).toBe(
      QUOTED.replace('"New York"', '"Boston"'),
    );
    expect(set(QUOTED, 3, 2, 'a "b", c')).toBe(
      QUOTED.replace("plain", '"a ""b"", c"'),
    );
  });

  it("writes a line break inside a value as the file's own", () => {
    expect(set(CRLF_BOM, 1, 1, "one\ntwo")).toBe(
      CRLF_BOM.replace("First", '"one\r\ntwo"'),
    );
  });

  it("quotes a new value when its whole column is quoted", () => {
    const text = 'a,b\n1,"x"\n2,"y"\n';
    expect(set(text, 1, 1, "z")).toBe('a,b\n1,"z"\n2,"y"\n');
  });

  it("adds, removes and widens rows without touching the others", () => {
    const doc = parseCsv(CRLF_BOM, ",");
    expect(applySplices(CRLF_BOM, [spliceInsertRow(doc, 1, "below")])).toBe(
      CRLF_BOM.replace("A1,First,10\r\n", "A1,First,10\r\n,,\r\n"),
    );
    expect(applySplices(CRLF_BOM, spliceDeleteRows(doc, [3]))).toBe(
      CRLF_BOM.replace("\r\nA3,Third,30", ""),
    );
    expect(applySplices(QUOTED, spliceAddColumn(parseCsv(QUOTED, ","), "z")))
      .toMatchInlineSnapshot(`
        "id,name,notes,city,z
        1,Ann,"likes ""tea"", and cake",Paris,
        2,"Bob, Jr.","line one
        line two",Berlin,
        3,Cy,plain,"New York",
        "
      `);
  });

  it("deletes adjacent last rows of a file with no trailing newline", () => {
    const doc = parseCsv(CRLF_BOM, ",");
    const edit: CsvEdit = {
      kind: "deleteRows",
      refs: [2, 3].map((record) => ({ key: recordKey(doc, record), record })),
    };
    const notes = { byPosition: 0, keptYours: 0, lost: 0 };
    expect(applyEdit(doc, edit, notes)?.text).toBe(
      "﻿code,label,amount\r\nA1,First,10",
    );
  });

  it("counts lines through quoted line breaks", () => {
    const doc = parseCsv(QUOTED, ",");
    expect([1, 2, 3].map((r) => lineOf(doc, r))).toEqual([2, 3, 5]);
  });
});

describe("replayEdits", () => {
  const edit = (
    text: string,
    record: number,
    column: number,
    value: string,
  ) => {
    const doc = parseCsv(text, ",");
    return {
      cells: [
        {
          before: doc.values[record]?.[column] ?? "",
          column,
          header: doc.values[0]?.[column] ?? "",
          ref: { key: recordKey(doc, record), record },
          value,
        },
      ],
      kind: "cells",
    } satisfies CsvEdit;
  };

  it("finds a row the other writer moved by its text", () => {
    const theirs = QUOTED.replace(
      "id,name,notes,city\n",
      "id,name,notes,city\n0,Zed,new,Rome\n",
    );
    const { doc, notes } = replayEdits(parseCsv(theirs, ","), [
      edit(QUOTED, 3, 1, "Cyd"),
    ]);
    expect(doc.text).toBe(theirs.replace("3,Cy,", "3,Cyd,"));
    expect(notes).toEqual({ byPosition: 0, keptYours: 0, lost: 0 });
  });

  it("falls back to position and header when the row changed", () => {
    const theirs = QUOTED.replace("3,Cy,plain", "3,Cy,fancy").replace(
      "id,name,notes,city",
      "id,notes,name,city",
    );
    const { doc, notes } = replayEdits(parseCsv(theirs, ","), [
      edit(QUOTED, 3, 1, "Cyd"),
    ]);
    expect(doc.values[3]).toEqual(["3", "Cy", "Cyd", "New York"]);
    expect(notes.byPosition).toBe(1);
  });

  it("reports the flash cells the other writer changed", () => {
    const before = parseCsv(QUOTED, ",");
    const after = parseCsv(QUOTED.replace("Paris", "Lyon"), ",");
    expect([...changedCells(before, after)]).toEqual(["0:3"]);
  });
});
