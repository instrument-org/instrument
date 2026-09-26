// Delimited text as the bytes it is: every field's span in the file, so an
// edit is a splice of that span and nothing else in the file moves. Quoting,
// line endings, a byte-order mark and a trailing newline all stay as the file
// had them, because nothing here ever serializes a table back out.
import Papa from "papaparse";

const QUOTE = 34; // "
const CR = 13;
const LF = 10;

export interface CsvDocument {
  bom: boolean;
  delimiter: string;
  /** The file's line ending, from its first line break outside quotes. */
  eol: "\n" | "\r" | "\r\n";
  /** Where each field's text ends in `text`, exclusive, quotes included. */
  fieldEnd: Int32Array;
  /** Whether each field is written quoted. */
  fieldQuoted: Uint8Array;
  /** Where each field's text starts in `text`, its opening quote included. */
  fieldStart: Int32Array;
  /** The header's record, or -1 in a file with no records at all. */
  headerRecord: number;
  /** Each record's first field, as an index into the field arrays; one more entry than records. */
  recordField: Int32Array;
  /** The record behind each grid row, in file order, blank lines skipped. */
  rowRecords: number[];
  text: string;
  /** Each record's fields as they read, unquoted and unescaped. */
  values: string[][];
}

/**
 * One thing the person did to the table, held until it is on disk so it can be
 * made again on top of a version of the file someone else wrote meanwhile.
 */
export type CsvEdit =
  | {
      cells: {
        /** The value the cell had when it was edited. */
        before: string;
        column: number;
        /** The column's name, for finding it when columns moved. */
        header: string;
        ref: RecordRef;
        value: string;
      }[];
      kind: "cells";
    }
  | { kind: "addColumn"; name: string }
  | { kind: "deleteRows"; refs: RecordRef[] }
  | { kind: "insertRow"; ref: RecordRef; where: "above" | "below" };

/** A record an edit was made to, and how to find it again. */
export interface RecordRef {
  /** The record's text when the edit was made. */
  key: string;
  record: number;
}

export interface ReplayNotes {
  /** Cells whose row or column had to be found by position rather than by its text. */
  byPosition: number;
  /** Cells the other writer also changed, where the person's value was kept. */
  keptYours: number;
  /** Edits whose row is gone from the other version, and were dropped. */
  lost: number;
}

export interface Splice {
  from: number;
  insert: string;
  to: number;
}

/**
 * Makes one edit on a parsed file: the new text, and the edit restated in
 * terms of that file, so a later replay starts from where it landed.
 */
export function applyEdit(
  doc: CsvDocument,
  edit: CsvEdit,
  notes: ReplayNotes,
): null | { edit: CsvEdit; text: string } {
  switch (edit.kind) {
    case "addColumn": {
      return {
        edit,
        text: applySplices(doc.text, spliceAddColumn(doc, edit.name)),
      };
    }
    case "cells": {
      const header = doc.values[doc.headerRecord] ?? [];
      const splices: Splice[] = [];
      const cells: Extract<CsvEdit, { kind: "cells" }>["cells"] = [];
      const found = new Map<string, ReturnType<typeof locate>>();
      for (const cell of edit.cells) {
        const cacheKey = `${cell.ref.record}\u0000${cell.ref.key}`;
        const at = found.has(cacheKey)
          ? found.get(cacheKey)
          : locate(doc, cell.ref);
        found.set(cacheKey, at ?? null);
        if (!at) {
          notes.lost += 1;
          continue;
        }
        let column = cell.column;
        if (header[column] !== cell.header) {
          const named = header.indexOf(cell.header);
          if (named !== -1) {
            column = named;
          }
          notes.byPosition += 1;
        } else if (!at.exact) {
          notes.byPosition += 1;
        }
        const current = doc.values[at.record]?.[column] ?? "";
        if (current === cell.value) {
          continue;
        }
        if (current !== cell.before) {
          notes.keptYours += 1;
        }
        splices.push(spliceCell(doc, at.record, column, cell.value));
        cells.push({
          ...cell,
          before: current,
          column,
          ref: { key: recordKey(doc, at.record), record: at.record },
        });
      }
      return {
        edit: { cells, kind: "cells" },
        text: applySplices(doc.text, splices),
      };
    }
    case "deleteRows": {
      const refs: RecordRef[] = [];
      for (const ref of edit.refs) {
        const at = locate(doc, ref);
        // A row that changed under a delete is left alone: the other
        // writer's version of it is not the row the person chose to remove.
        if (!at?.exact) {
          notes.lost += 1;
          continue;
        }
        refs.push({ key: ref.key, record: at.record });
      }
      return {
        edit: { kind: "deleteRows", refs },
        text: applySplices(
          doc.text,
          spliceDeleteRows(
            doc,
            refs.map((ref) => ref.record),
          ),
        ),
      };
    }
    case "insertRow": {
      const at = locate(doc, edit.ref);
      if (!at) {
        notes.lost += 1;
        return null;
      }
      if (!at.exact) {
        notes.byPosition += 1;
      }
      return {
        edit: {
          ...edit,
          ref: { key: recordKey(doc, at.record), record: at.record },
        },
        text: applySplices(doc.text, [
          spliceInsertRow(doc, at.record, edit.where),
        ]),
      };
    }
  }
}

/**
 * Applies splices computed against one text, which must not overlap, in one
 * pass: a column added to every row of a large file is thousands of splices.
 */
export function applySplices(text: string, splices: Splice[]) {
  const ordered = splices.toSorted((a, b) => a.from - b.from || a.to - b.to);
  const parts: string[] = [];
  let at = 0;
  for (const { from, insert, to } of ordered) {
    parts.push(text.slice(at, from), insert);
    at = to;
  }
  parts.push(text.slice(at));
  return parts.join("");
}

/**
 * The cells that differ between two versions, by grid row and column in the
 * newer one. Records the two share at the top and bottom are skipped by their
 * text, so a row added or removed in the middle does not mark everything
 * after it as changed.
 */
export function changedCells(before: CsvDocument, after: CsvDocument) {
  const changed = new Set<string>();
  const a = before.values.length;
  const b = after.values.length;
  let top = 0;
  while (
    top < a &&
    top < b &&
    recordKey(before, top) === recordKey(after, top)
  ) {
    top += 1;
  }
  let bottom = 0;
  while (
    bottom < a - top &&
    bottom < b - top &&
    recordKey(before, a - 1 - bottom) === recordKey(after, b - 1 - bottom)
  ) {
    bottom += 1;
  }
  const rowOf = new Map(after.rowRecords.map((record, row) => [record, row]));
  const sameShape = a === b;
  for (let record = top; record < b - bottom; record += 1) {
    const row = rowOf.get(record);
    const next = after.values[record] ?? [];
    const previous = sameShape ? (before.values[record] ?? []) : null;
    for (const [column, element] of next.entries()) {
      if (previous?.[column] === element) {
        continue;
      }
      changed.add(
        row === undefined
          ? record === after.headerRecord
            ? `h:${column}`
            : ""
          : `${row}:${column}`,
      );
    }
  }
  changed.delete("");
  return changed;
}

/** Whether every field the column has below the header is written quoted. */
export function columnAllQuoted(doc: CsvDocument, column: number) {
  let seen = 0;
  for (const record of doc.rowRecords) {
    const first = doc.recordField[record] ?? 0;
    const count = (doc.recordField[record + 1] ?? first) - first;
    if (column >= count) {
      continue;
    }
    if (!doc.fieldQuoted[first + column]) {
      return false;
    }
    seen += 1;
  }
  return seen > 0;
}

/**
 * The delimiter a file uses: a tab for `.tsv`, which Papa could guess wrong on
 * a first line holding more commas than tabs, and Papa's guess otherwise.
 */
export function detectDelimiter(filename: string, text: string) {
  if (filename.toLowerCase().endsWith(".tsv")) {
    return "\t";
  }
  const guessed = Papa.parse(text.slice(0, 64 * 1024), { preview: 50 }).meta
    .delimiter;
  return guessed || ",";
}

/**
 * A value as a field of this file: quoted only when it has to be (it holds the
 * delimiter, a quote or a line break) or when the field or its column already
 * is, and with any line break in it written as the file writes its own.
 */
export function encodeField(
  doc: CsvDocument,
  value: string,
  forceQuote: boolean,
) {
  const text = value.replaceAll(/\r\n|\r|\n/g, doc.eol);
  const needs =
    text.includes(doc.delimiter) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r");
  return needs || forceQuote ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The last line a record's text reaches, for a record with a line break inside a field. */
export function lastLineOf(doc: CsvDocument, record: number, first: number) {
  const { end, start } = recordSpan(doc, record);
  let line = first;
  const { text } = doc;
  for (let i = start; i < end; i += 1) {
    const c = text.codePointAt(i);
    if (c === LF || (c === CR && text.codePointAt(i + 1) !== LF)) {
      line += 1;
    }
  }
  return line;
}

/** The 1-based line a record starts on, counting line breaks inside quoted fields. */
export function lineOf(doc: CsvDocument, record: number) {
  const { start } = recordSpan(doc, record);
  let line = 1;
  const { text } = doc;
  for (let i = 0; i < start; i += 1) {
    const c = text.codePointAt(i);
    if (c === LF || (c === CR && text.codePointAt(i + 1) !== LF)) {
      line += 1;
    }
  }
  return line;
}

/**
 * Reads delimited text the way RFC 4180 does, the way Papa reads it for the
 * viewer: `"` quotes a field and `""` is a quote inside one, and a line ending
 * is `\r\n`, `\n` or `\r`. Text after a closing quote, before the delimiter,
 * is kept as part of the value rather than dropped, so nothing in the file
 * is invisible in the grid.
 */
export function parseCsv(text: string, delimiter: string): CsvDocument {
  const bom = text.codePointAt(0) === 0xfe_ff;
  const n = text.length;
  const delim = delimiter.codePointAt(0);
  const starts: number[] = [];
  const ends: number[] = [];
  const quoted: number[] = [];
  const recordField: number[] = [];
  const values: string[][] = [];
  let eol: CsvDocument["eol"] | null = null;
  let i = bom ? 1 : 0;

  while (i < n) {
    recordField.push(starts.length);
    const record: string[] = [];
    for (;;) {
      const start = i;
      let value: string;
      let isQuoted = 0;
      if (text.codePointAt(i) === QUOTE) {
        isQuoted = 1;
        let parts = "";
        let from = i + 1;
        for (;;) {
          const close = text.indexOf('"', from);
          if (close === -1) {
            // An unterminated quote runs to the end of the file.
            parts += text.slice(from);
            i = n;
            break;
          }
          parts += text.slice(from, close);
          if (text.codePointAt(close + 1) === QUOTE) {
            parts += '"';
            from = close + 2;
            continue;
          }
          i = close + 1;
          break;
        }
        // Anything between the closing quote and the delimiter.
        const tail = i;
        while (i < n) {
          const c = text.codePointAt(i);
          if (c === delim || c === LF || c === CR) {
            break;
          }
          i += 1;
        }
        value = tail === i ? parts : parts + text.slice(tail, i);
      } else {
        while (i < n) {
          const c = text.codePointAt(i);
          if (c === delim || c === LF || c === CR) {
            break;
          }
          i += 1;
        }
        value = text.slice(start, i);
      }
      starts.push(start);
      ends.push(i);
      quoted.push(isQuoted);
      record.push(value);
      if (i < n && text.codePointAt(i) === delim) {
        i += 1;
        continue;
      }
      break;
    }
    values.push(record);
    const c = text.codePointAt(i);
    if (c === CR && text.codePointAt(i + 1) === LF) {
      eol ??= "\r\n";
      i += 2;
    } else if (c === CR) {
      eol ??= "\r";
      i += 1;
    } else if (c === LF) {
      eol ??= "\n";
      i += 1;
    }
  }
  recordField.push(starts.length);

  const rowRecords: number[] = [];
  let headerRecord = -1;
  for (const [r, record] of values.entries()) {
    // Blank lines are not rows. A line of bare delimiters is one, though,
    // unlike in Papa's `greedy` skip: it is what inserting a row writes.
    if (record.length === 1 && (record[0] ?? "").trim() === "") {
      continue;
    }
    if (headerRecord === -1) {
      headerRecord = r;
    } else {
      rowRecords.push(r);
    }
  }

  return {
    bom,
    delimiter,
    eol: eol ?? "\n",
    fieldEnd: Int32Array.from(ends),
    fieldQuoted: Uint8Array.from(quoted),
    fieldStart: Int32Array.from(starts),
    headerRecord,
    recordField: Int32Array.from(recordField),
    rowRecords,
    text,
    values,
  };
}

/** A record's text as written, the key that finds it again in another version of the file. */
export function recordKey(doc: CsvDocument, record: number) {
  const { end, start } = recordSpan(doc, record);
  return doc.text.slice(start, end);
}

/** Where a record's text sits in the file, line ending excluded. */
export function recordSpan(doc: CsvDocument, record: number) {
  const first = doc.recordField[record] ?? 0;
  const last = (doc.recordField[record + 1] ?? first + 1) - 1;
  return { end: doc.fieldEnd[last] ?? 0, start: doc.fieldStart[first] ?? 0 };
}

// ---------------------------------------------------------------- edits

/**
 * Makes the person's unsaved edits again on top of a version of the file
 * someone else wrote: the text that results, and the edits restated against
 * it.
 */
export function replayEdits(
  theirs: CsvDocument,
  edits: CsvEdit[],
): { doc: CsvDocument; edits: CsvEdit[]; notes: ReplayNotes } {
  const notes: ReplayNotes = { byPosition: 0, keptYours: 0, lost: 0 };
  let doc = theirs;
  const restated: CsvEdit[] = [];
  for (const edit of edits) {
    const applied = applyEdit(doc, edit, notes);
    if (!applied) {
      continue;
    }
    restated.push(applied.edit);
    if (applied.text !== doc.text) {
      doc = parseCsv(applied.text, doc.delimiter);
    }
  }
  return { doc, edits: restated, notes };
}

/** A new last column: its name on the header, an empty field on every other row. */
export function spliceAddColumn(doc: CsvDocument, name: string): Splice[] {
  const width = widthOf(doc);
  const splices: Splice[] = [];
  const records = [doc.headerRecord, ...doc.rowRecords];
  for (const record of records) {
    if (record < 0) {
      continue;
    }
    const first = doc.recordField[record] ?? 0;
    const count = (doc.recordField[record + 1] ?? first) - first;
    const { end } = recordSpan(doc, record);
    splices.push({
      from: end,
      insert:
        doc.delimiter.repeat(width - count + 1) +
        (record === doc.headerRecord ? encodeField(doc, name, false) : ""),
      to: end,
    });
  }
  return splices;
}

/** Sets one field: a splice of exactly its span, or delimiters and the value past the end of a short record. */
export function spliceCell(
  doc: CsvDocument,
  record: number,
  column: number,
  value: string,
): Splice {
  const first = doc.recordField[record] ?? 0;
  const count = (doc.recordField[record + 1] ?? first) - first;
  if (column < count) {
    const field = first + column;
    const quote = doc.fieldQuoted[field] === 1 || columnAllQuoted(doc, column);
    return {
      from: doc.fieldStart[field] ?? 0,
      insert: encodeField(doc, value, quote),
      to: doc.fieldEnd[field] ?? 0,
    };
  }
  const { end } = recordSpan(doc, record);
  return {
    from: end,
    insert:
      doc.delimiter.repeat(column - count + 1) +
      encodeField(doc, value, columnAllQuoted(doc, column)),
    to: end,
  };
}

/**
 * Removes records and one line ending with each: its own, or, for a run that
 * ends the file with no trailing newline, the one before the run, so the file
 * keeps or lacks a trailing newline as it did.
 */
export function spliceDeleteRows(
  doc: CsvDocument,
  records: number[],
): Splice[] {
  const sorted = [...new Set(records)].toSorted((a, b) => a - b);
  const last = doc.values.length - 1;
  const trailing = recordSpan(doc, last).end < doc.text.length;
  const splices: Splice[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] ?? 0) + 1) {
      j += 1;
    }
    const first = sorted[i] ?? 0;
    const end = sorted[j] ?? 0;
    const { start } = recordSpan(doc, first);
    if (end < last) {
      splices.push({
        from: start,
        insert: "",
        to: doc.fieldStart[doc.recordField[end + 1] ?? 0] ?? start,
      });
    } else if (trailing || first === 0) {
      splices.push({ from: start, insert: "", to: doc.text.length });
    } else {
      splices.push({
        from: recordSpan(doc, first - 1).end,
        insert: "",
        to: doc.text.length,
      });
    }
    i = j + 1;
  }
  return splices;
}

/** An empty record as wide as the table, next to `record`. */
export function spliceInsertRow(
  doc: CsvDocument,
  record: number,
  where: "above" | "below",
): Splice {
  const blank = doc.delimiter.repeat(Math.max(widthOf(doc) - 1, 0));
  const { end, start } = recordSpan(doc, record);
  return where === "above"
    ? { from: start, insert: blank + doc.eol, to: start }
    : { from: end, insert: doc.eol + blank, to: end };
}

/** The widest record, which is how many columns the grid shows. */
export function widthOf(doc: CsvDocument) {
  let width = 0;
  for (const record of doc.values) {
    width = Math.max(width, record.length);
  }
  return width;
}

/**
 * Finds an edited record in another version of the file: where it was, if the
 * text there is unchanged; wherever that text now is, nearest first; else by
 * position, which the notes count.
 */
function locate(
  doc: CsvDocument,
  ref: RecordRef,
): null | { exact: boolean; record: number } {
  const records = doc.values.length;
  if (ref.record < records && recordKey(doc, ref.record) === ref.key) {
    return { exact: true, record: ref.record };
  }
  for (let distance = 1; distance < records; distance += 1) {
    const below = ref.record + distance;
    const above = ref.record - distance;
    if (below >= records && above < 0) {
      break;
    }
    if (below < records && recordKey(doc, below) === ref.key) {
      return { exact: true, record: below };
    }
    if (above >= 0 && above < records && recordKey(doc, above) === ref.key) {
      return { exact: true, record: above };
    }
  }
  if (ref.record < records && ref.record !== doc.headerRecord) {
    return { exact: false, record: ref.record };
  }
  return null;
}
