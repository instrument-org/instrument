// The pure half of a plain text file open for editing: how its bytes become
// an editor document and back without changing one of them, and how a new
// version of the file on disk becomes the smallest set of edits to the one on
// screen.
import { ChangeSet } from "@codemirror/state";
import {
  DIFF_DELETE,
  DIFF_INSERT,
  diffCleanupSemantic,
  diffMain,
} from "diff-match-patch-es";

const BOM = "\uFEFF";

/** Past this, a file opens read only: about 5 MB of text. */
export const MAX_EDITABLE_CHARS = 5 * 1024 * 1024;
/** A line longer than this (a minified bundle, a data blob) makes the file read only. */
export const MAX_EDITABLE_LINE = 20_000;

/** A file's text as the editor holds it, and what it takes to write it back unchanged. */
export interface TextForm {
  /** The text without its byte order mark. */
  body: string;
  /** Whether the file starts with a byte order mark, which the editor does not show. */
  bom: boolean;
  /** What ends a line: CRLF only when every line break in the file is one. */
  lineBreak: "\n" | "\r\n";
}

/**
 * The edits that turn `from` into `to`, as a change set over `from`, in the
 * editor's positions for a document split on `lineBreak`.
 *
 * With LF breaks a position is a string offset, so the diff is character
 * level (line level first, then refined, which keeps a long file fast). With
 * CRLF a break is one position but two characters, so the diff is by whole
 * lines, whose positions are counted the editor's way.
 */
export function changesBetween(
  from: string,
  to: string,
  lineBreak: "\n" | "\r\n",
): ChangeSet {
  if (lineBreak === "\n") {
    return changesFromDiff(from, charDiff(from, to), lineBreak);
  }
  return lineChanges(from, to, lineBreak);
}

/** The indent a file already uses: a tab, or the smallest run of leading spaces. */
export function detectIndent(text: string): string {
  let tabs = 0;
  let spaces = 0;
  let smallest = Infinity;
  const sample = text.slice(0, 200_000);
  for (const match of sample.matchAll(/^([ \t]+)\S/gm)) {
    const lead = match[1] ?? "";
    if (lead.startsWith("\t")) {
      tabs++;
    } else {
      spaces++;
      if (lead.length >= 2) {
        smallest = Math.min(smallest, lead.length);
      }
    }
  }
  if (tabs > spaces) {
    return "\t";
  }
  return " ".repeat(Number.isFinite(smallest) ? Math.min(smallest, 8) : 2);
}

/** The file's bytes for a document body in a given form. */
export function fileText(form: Pick<TextForm, "bom">, body: string): string {
  return form.bom ? BOM + body : body;
}

/** Why a file opens read only, or null when it can be edited. */
export function readOnlyReason(text: string): null | string {
  if (text.length > MAX_EDITABLE_CHARS) {
    return "This file is too large to edit here, so it opens read only.";
  }
  if (/[\0\uFFFD]/.test(text)) {
    return "This file has bytes that are not text, so it opens read only.";
  }
  let start = 0;
  while (start <= text.length) {
    const end = text.indexOf("\n", start);
    const stop = end === -1 ? text.length : end;
    if (stop - start > MAX_EDITABLE_LINE) {
      return "This file has very long lines, so it opens read only.";
    }
    if (end === -1) {
      break;
    }
    start = end + 1;
  }
  return null;
}

/**
 * Merges a new version of the file into the document on screen: `theirs` are
 * the edits from the last version both sides agreed on to the new one on
 * disk, `ours` the person's edits since that version. Returns the agent's
 * edits over the document as it stands, and the person's edits over the new
 * disk version, which is what is still unsaved afterward. Where the two
 * touched the same stretch of text both are kept.
 */
export function rebase(theirs: ChangeSet, ours: ChangeSet) {
  let overlaps = 0;
  if (!ours.empty) {
    const mine: [number, number][] = [];
    ours.iterChangedRanges((fromA, toA) => {
      mine.push([fromA, toA]);
    });
    theirs.iterChangedRanges((fromA, toA) => {
      if (mine.some(([from, to]) => fromA <= to && toA >= from)) {
        overlaps++;
      }
    });
  }
  return {
    overlaps,
    /** The agent's edits, over the document on screen. */
    theirsOnScreen: theirs.map(ours),
    /** The person's edits, over the new version on disk. */
    unsaved: ours.map(theirs, true),
  };
}

/**
 * Reads a file's text into the form the editor holds. The line separator is
 * the file's own, so the document joins back to the same bytes: CRLF when
 * every break is CRLF, and otherwise LF, with any stray `\r` kept as a
 * character of its line rather than read as a break.
 */
export function textForm(text: string): TextForm {
  const bom = text.startsWith(BOM);
  const body = bom ? text.slice(1) : text;
  const crlf = body.includes("\r\n") && !/(?:^|[^\r])\n/.test(body);
  return { body, bom, lineBreak: crlf ? "\r\n" : "\n" };
}

function changesFromDiff(
  from: string,
  diffs: ReturnType<typeof diffMain>,
  lineBreak: string,
): ChangeSet {
  const specs: { from: number; insert?: string; to?: number }[] = [];
  let at = 0;
  for (const [op, text] of diffs) {
    if (op === DIFF_DELETE) {
      specs.push({ from: at, to: at + text.length });
      at += text.length;
    } else if (op === DIFF_INSERT) {
      specs.push({ from: at, insert: text });
    } else {
      at += text.length;
    }
  }
  return ChangeSet.of(specs, from.length, lineBreak);
}

function charDiff(from: string, to: string) {
  const diffs = diffMain(from, to, { diffTimeout: 0.5 }, true);
  // Whole words and lines rather than scattered letters, so a caret inside
  // a rewritten word lands at its edge instead of in the middle of it.
  diffCleanupSemantic(diffs);
  return diffs;
}

function lineChanges(from: string, to: string, lineBreak: string): ChangeSet {
  // Each line with the break that ends it (the last has none) is one unit,
  // and each distinct unit one character, so the diff runs over lines and
  // every run of units is an exact stretch of both texts.
  const units = (text: string) =>
    text
      .split(lineBreak)
      .map((line, i, all) => (i < all.length - 1 ? line + lineBreak : line));
  const a = units(from);
  const b = units(to);
  const ids = new Map<string, string>();
  const encode = (lines: string[]) =>
    lines
      .map((line) => {
        let id = ids.get(line);
        if (id === undefined) {
          id = String.fromCharCode(ids.size + 1);
          ids.set(line, id);
        }
        return id;
      })
      .join("");
  const codeA = encode(a);
  const codeB = encode(b);
  // In the editor a unit is its line and one position for its break.
  const size = (unit: string) =>
    unit.endsWith(lineBreak) ? unit.length - lineBreak.length + 1 : unit.length;
  const length = a.reduce((n, unit) => n + size(unit), 0);
  if (ids.size > 60_000) {
    return ChangeSet.of(
      [{ from: 0, insert: to, to: length }],
      length,
      lineBreak,
    );
  }
  const specs: { from: number; insert?: string; to?: number }[] = [];
  let lineA = 0;
  let lineB = 0;
  let pos = 0;
  for (const [op, run] of diffMain(codeA, codeB, { diffTimeout: 0.5 }, false)) {
    const count = run.length;
    if (op === DIFF_DELETE) {
      let span = 0;
      for (let i = lineA; i < lineA + count; i++) {
        span += size(a[i] ?? "");
      }
      specs.push({ from: pos, to: pos + span });
      pos += span;
      lineA += count;
    } else if (op === DIFF_INSERT) {
      specs.push({ from: pos, insert: b.slice(lineB, lineB + count).join("") });
      lineB += count;
    } else {
      for (let i = lineA; i < lineA + count; i++) {
        pos += size(a[i] ?? "");
      }
      lineA += count;
      lineB += count;
    }
  }
  return ChangeSet.of(specs, length, lineBreak);
}
