/**
 * The source side: the file indexed with source locations (the copy the page
 * shows carries a `data-src-id` on every element), a visible-text edit turned
 * into minimal splices of the file's text nodes, and the offset arithmetic the
 * rest of the editor uses to find things again after the file changes.
 */
import type { DefaultTreeAdapterTypes } from "parse5";

import { indexPageSource, type PageSourceEntry } from "@/shared/page-source";
import {
  DIFF_DELETE,
  DIFF_INSERT,
  diffCleanupSemantic,
  diffMain,
} from "diff-match-patch-es";

export type { PageSourceEntry } from "@/shared/page-source";

/** The file indexed: every element it writes, its scripts and data attributes. */
export interface Analysis {
  byNode: Map<DefaultTreeAdapterTypes.Element, PageSourceEntry>;
  /** Entries by their start tag's offset. */
  byStart: Map<number, PageSourceEntry>;
  dataAttrs: DataAttr[];
  entries: PageSourceEntry[];
  lineCol: (off: number) => { col: number; line: number };
  mentionCache: Map<string, null | string>;
  scripts: ScriptInfo[];
  segCache: Map<number, Segments>;
  shadowCache: Map<string, ShadowHit[]>;
  src: string;
}
export interface Range {
  end: number;
  start: number;
}

/** The text nodes of one element in source order, and whether they map back exactly. */
export interface Segments {
  ok: boolean;
  segs: TextSegment[];
  text: string;
}

/** One place where a string also appears: a script body or a data-* value. */
export type ShadowHit =
  | { at: number; attr: DataAttr; kind: "data" }
  | { at: number; kind: "json" | "script"; script: ScriptInfo };

export interface Splice {
  end: number;
  start: number;
  text: string;
}

interface DataAttr {
  end: number;
  name: string;
  start: number;
  value: string;
}

interface ScriptInfo {
  domId: string | undefined;
  end: number;
  start: number;
  text: string;
  /** The script's `type`, or "script" when it has none. */
  type: string;
}

type SourceNode =
  | DefaultTreeAdapterTypes.ChildNode
  | DefaultTreeAdapterTypes.ParentNode;

type SourceTextNode = DefaultTreeAdapterTypes.TextNode;

/** A text node's characters, split into literal runs and entities. */
interface TextRun {
  /** Where the run ends in the block's decoded text. */
  de: number;
  /** Where the run starts in the block's decoded text. */
  ds: number;
  /** Where the run ends in the source. */
  e: number;
  /** Whether the run is one entity rather than literal characters. */
  ent: boolean;
  /** Where the run starts in the source. */
  s: number;
  /** An entity's decoded value. */
  value?: string;
}

interface TextSegment {
  de: number;
  ds: number;
  end: number;
  node: SourceTextNode;
  runs: TextRun[];
  start: number;
}

const decoder = document.createElement("textarea");
const decodeEntity = (s: string) => {
  decoder.innerHTML = s;
  return decoder.value;
};

/**
 * Parse `src` and index it. Ids are ordinals in document order, so a text-only
 * splice keeps every id pointing at the same element after a re-parse.
 */
export function analyze(src: string): Analysis {
  const { entries } = indexPageSource(src);
  const byStart = new Map<number, PageSourceEntry>();
  const byNode = new Map<DefaultTreeAdapterTypes.Element, PageSourceEntry>();
  const scripts: ScriptInfo[] = [];
  const dataAttrs: DataAttr[] = [];
  for (const entry of entries) {
    const child = entry.node;
    const loc = entry.loc;
    byStart.set(loc.startTag.startOffset, entry);
    byNode.set(child, entry);
    for (const a of child.attrs) {
      const at = loc.attrs?.[a.name];
      if (a.name.startsWith("data-") && at) {
        dataAttrs.push({
          end: at.endOffset,
          name: a.name,
          start: at.startOffset,
          value: a.value,
        });
      }
    }
    if (child.tagName === "script") {
      const t = child.childNodes[0];
      if (t && isText(t) && t.sourceCodeLocation) {
        const attr = (n: string) =>
          child.attrs.find((a) => a.name === n)?.value;
        scripts.push({
          domId: attr("id"),
          end: t.sourceCodeLocation.endOffset,
          start: t.sourceCodeLocation.startOffset,
          text: t.value,
          type: attr("type") || "script",
        });
      }
    }
  }

  const lineStarts = [0];
  for (let i = src.indexOf("\n"); i >= 0; i = src.indexOf("\n", i + 1)) {
    lineStarts.push(i + 1);
  }
  const lineCol = (off: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= off) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { col: off - (lineStarts[lo] ?? 0) + 1, line: lo + 1 };
  };

  return {
    byNode,
    byStart,
    dataAttrs,
    entries,
    lineCol,
    mentionCache: new Map(),
    scripts,
    segCache: new Map(),
    shadowCache: new Map(),
    src,
  };
}

function isText(node: SourceNode): node is SourceTextNode {
  return node.nodeName === "#text";
}

/** Elements whose text is raw (not markup), which a text edit never rewrites. */
const RAW_TEXT = new Set([
  "iframe",
  "noscript",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

/**
 * The text nodes under an element, in source order, each split into runs of
 * literal characters and entities so a position in the decoded (visible) text
 * maps back to a source offset. `ok` is false when the runs do not reproduce
 * parse5's decoded value (odd entity forms, CRLF): those stay read-only.
 */
export function segments(A: Analysis, entry: PageSourceEntry): Segments {
  const cached = A.segCache.get(entry.id);
  if (cached) {
    return cached;
  }
  const segs: TextSegment[] = [];
  let ok = true;
  let text = "";
  const collect = (node: DefaultTreeAdapterTypes.Element) => {
    for (const c of node.childNodes) {
      if (isText(c)) {
        const loc = c.sourceCodeLocation;
        if (!loc) {
          ok = false;
          continue;
        }
        const raw = A.src.slice(loc.startOffset, loc.endOffset);
        const runs: TextRun[] = [];
        let dec = text.length;
        const re = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;
        let last = 0;
        const lit = (a: number, b: number) => {
          if (b > a) {
            const ds = dec;
            dec += b - a;
            runs.push({
              de: dec,
              ds,
              e: loc.startOffset + b,
              ent: false,
              s: loc.startOffset + a,
            });
          }
        };
        for (let m; (m = re.exec(raw));) {
          lit(last, m.index);
          const v = decodeEntity(m[0]);
          const ds = dec;
          dec += v.length;
          runs.push({
            de: dec,
            ds,
            e: loc.startOffset + m.index + m[0].length,
            ent: true,
            s: loc.startOffset + m.index,
            value: v,
          });
          last = m.index + m[0].length;
        }
        lit(last, raw.length);
        const decoded = runs
          .map((r) => (r.ent ? r.value : A.src.slice(r.s, r.e)))
          .join("");
        if (decoded !== c.value || RAW_TEXT.has(node.tagName)) {
          ok = false;
        }
        segs.push({
          de: text.length + c.value.length,
          ds: text.length,
          end: loc.endOffset,
          node: c,
          runs,
          start: loc.startOffset,
        });
        text += c.value;
      } else if ("tagName" in c && c.tagName !== "template") {
        collect(c);
      }
    }
  };
  collect(entry.node);
  const out = { ok, segs, text };
  A.segCache.set(entry.id, out);
  return out;
}

const escapeText = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

type ClassAttr =
  | {
      end: number;
      exists: true;
      quote: string;
      start: number;
      tokens: string[];
      value: string;
    }
  | { exists: false; insertAt: number; tokens: string[] };

interface TextEditSpan {
  from: number;
  text: string;
  to: number;
}

/** Changed ranges of `next` relative to `prev`, in `next` offsets. */
export function changedRanges(prev: string, next: string) {
  const diffs = diffMain(prev, next);
  diffCleanupSemantic(diffs);
  const out: Range[] = [];
  let pos = 0;
  for (const [op, s] of diffs) {
    if (op === DIFF_INSERT) {
      out.push({ end: pos + s.length, start: pos });
      pos += s.length;
    } else if (op === DIFF_DELETE) {
      out.push({ end: pos, start: pos });
    } else {
      pos += s.length;
    }
  }
  return out;
}

/**
 * The class attribute as written: its tokens and where the value sits. With no
 * class attribute, `insertAt` is right after the tag name.
 */
export function classAttr(A: Analysis, entry: PageSourceEntry): ClassAttr {
  const at = entry.loc.attrs?.class;
  if (!at) {
    return {
      exists: false,
      insertAt: entry.loc.startTag.startOffset + 1 + entry.tag.length,
      tokens: [],
    };
  }
  const { quote, value } = writtenValue(
    A.src.slice(at.startOffset, at.endOffset),
  );
  return {
    end: at.endOffset,
    exists: true,
    quote: quote || '"',
    start: at.startOffset,
    tokens: value.split(/\s+/).filter(Boolean),
    value,
  };
}

/** The splice that makes the element's class attribute read `next` (a token string). */
export function classSplice(
  A: Analysis,
  entry: PageSourceEntry,
  next: string,
): null | Splice {
  const c = classAttr(A, entry);
  if (!c.exists) {
    return next
      ? { end: c.insertAt, start: c.insertAt, text: ` class="${next}"` }
      : null;
  }
  if (!next) {
    return { end: c.end, start: leadingWs(A.src, c.start), text: "" };
  }
  return {
    end: c.end,
    start: c.start,
    text: `class=${c.quote}${next}${c.quote}`,
  };
}

/** Find `needle` in `hay`, choosing the occurrence closest to `near`. */
export function findNearest(hay: string, needle: string, near: number) {
  if (!needle) {
    return -1;
  }
  let best = -1;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) {
      best = i;
    }
    if (i > near && best >= 0) {
      break;
    }
  }
  return best;
}

/** Offsets of an element's content, between its start and end tags (null for void elements). */
export function innerRange(entry: PageSourceEntry): null | Range {
  if (!entry.loc.endTag) {
    return null;
  }
  return {
    end: entry.loc.endTag.startOffset,
    start: entry.loc.startTag.endOffset,
  };
}

/**
 * `neu` rewritten so any stretch that differs from `old` only in whitespace
 * keeps `old`'s whitespace (a serializer collapses the source's line breaks
 * and indentation; the file should keep them).
 */
export function keepWhitespace(old: string, neu: string) {
  const diffs = diffMain(old, neu);
  diffCleanupSemantic(diffs);
  let out = "";
  for (let i = 0; i < diffs.length; i++) {
    const diff = diffs[i];
    if (!diff) {
      continue;
    }
    const [op, s] = diff;
    const next = diffs[i + 1];
    if (
      op === DIFF_DELETE &&
      next?.[0] === DIFF_INSERT &&
      !/\S/.test(s) &&
      !/\S/.test(next[1])
    ) {
      out += s;
      i++;
    } else if (op === DIFF_DELETE) {
      if (!/\S/.test(s) && s.includes("\n")) {
        out += s;
      }
    } else {
      out += s;
    }
  }
  return out;
}

/** The start of the whitespace run right before `at` (so a moved line keeps its indent). */
export function leadingWs(src: string, at: number) {
  let i = at;
  while (i > 0 && /[ \t\r\n]/.test(src[i - 1] ?? "")) {
    i--;
  }
  return i;
}

/** Where `off` in `prev` lands in `next`. */
export function mapOffset(prev: string, next: string, off: number) {
  if (prev === next) {
    return off;
  }
  const diffs = diffMain(prev, next);
  let a = 0;
  let b = 0;
  for (const [op, s] of diffs) {
    if (op === DIFF_DELETE) {
      if (off < a + s.length) {
        return b;
      }
      a += s.length;
    } else if (op === DIFF_INSERT) {
      b += s.length;
    } else {
      if (off < a + s.length) {
        return b + (off - a);
      }
      a += s.length;
      b += s.length;
    }
  }
  return b + (off - a);
}

/**
 * Visible-text change -> source splices, touching only the text-node
 * characters that changed. Unchanged entities and markup stay as written; an
 * edit that lands inside an entity rewrites just that entity. `written` is
 * the decoded text the splices produce (typed non-breaking spaces become
 * plain spaces). Null when the change cannot be mapped to the file.
 */
export function textSplices(
  seg: Segments,
  newText: string,
): null | { splices: Splice[]; written: string } {
  const oldText = seg.text;
  const diffs = diffMain(oldText, newText);
  diffCleanupSemantic(diffs);
  const edits: TextEditSpan[] = [];
  let pos = 0;
  for (const [op, s] of diffs) {
    if (op === DIFF_DELETE) {
      const last = edits.at(-1);
      if (last?.to === pos && last.from === pos) {
        last.to = pos + s.length;
      } else {
        edits.push({ from: pos, text: "", to: pos + s.length });
      }
      pos += s.length;
    } else if (op === DIFF_INSERT) {
      const last = edits.at(-1);
      if (last?.to === pos) {
        last.text += s;
      } else {
        edits.push({ from: pos, text: s, to: pos });
      }
    } else {
      pos += s.length;
    }
  }
  // Edits inside one word become one edit ("blacktop" -> "playground", not b->p + cktop->yground).
  for (let i = edits.length - 1; i > 0; i--) {
    const a = edits[i - 1];
    const b = edits[i];
    if (!a || !b) {
      continue;
    }
    const between = oldText.slice(a.to, b.from);
    if (/\s/.test(between)) {
      continue;
    }
    edits.splice(i - 1, 2, {
      from: a.from,
      text: a.text + between + b.text,
      to: b.to,
    });
  }
  const runs = seg.segs.flatMap((sg) => sg.runs);
  // Snap edit boundaries out of entities.
  for (const ed of edits) {
    for (const r of runs) {
      if (!r.ent) {
        continue;
      }
      if (r.ds < ed.from && ed.from < r.de) {
        ed.text = oldText.slice(r.ds, ed.from) + ed.text;
        ed.from = r.ds;
      }
      if (r.ds < ed.to && ed.to < r.de) {
        ed.text += oldText.slice(ed.to, r.de);
        ed.to = r.de;
      }
    }
    ed.text = ed.text.replaceAll("\u00A0", " ");
  }
  const splices: Splice[] = [];
  for (const ed of edits) {
    if (ed.from === ed.to) {
      const sg = seg.segs.find((g) => g.ds <= ed.from && ed.from <= g.de);
      if (!sg) {
        return null;
      }
      const at = sg.runs.length > 0 ? srcAtIn(sg.runs, ed.from) : sg.start;
      splices.push({ end: at, start: at, text: escapeText(ed.text) });
      continue;
    }
    let first = true;
    for (const sg of seg.segs) {
      const a = Math.max(ed.from, sg.ds);
      const b = Math.min(ed.to, sg.de);
      if (a >= b) {
        continue;
      }
      splices.push({
        end: srcAtIn(sg.runs, b, true),
        start: srcAtIn(sg.runs, a),
        text: first ? escapeText(ed.text) : "",
      });
      first = false;
    }
    if (first) {
      return null;
    }
  }
  let written = oldText;
  for (const ed of [...edits].reverse()) {
    written = written.slice(0, ed.from) + ed.text + written.slice(ed.to);
  }
  return { splices, written };
}

/** The one splice turning `old` into `neu`, trimmed to the stretch that differs. */
export function trimmedSplice(
  old: string,
  neu: string,
  offset: number,
): Splice {
  let s = 0;
  while (s < old.length && s < neu.length && old[s] === neu[s]) {
    s++;
  }
  let e = 0;
  while (
    e < old.length - s &&
    e < neu.length - s &&
    old[old.length - 1 - e] === neu[neu.length - 1 - e]
  ) {
    e++;
  }
  return {
    end: offset + old.length - e,
    start: offset + s,
    text: neu.slice(s, neu.length - e),
  };
}

/** The source offset of decoded position `d` among `runs`. */
function srcAtIn(runs: TextRun[], d: number, isEnd = false) {
  // For a range end, take the run that ends at d; for a start, the one starting at d.
  const r =
    (isEnd
      ? runs.find((x) => x.ds < d && d <= x.de)
      : runs.find((x) => x.ds <= d && d < x.de)) ??
    runs.find((x) => x.ds <= d && d <= x.de);
  if (!r) {
    throw new Error(`No text run holds offset ${d}`);
  }
  if (d === r.ds) {
    return r.s;
  }
  if (d === r.de) {
    return r.e;
  }
  return r.s + (d - r.ds);
}

/**
 * A written `class=...` attribute's value and the quote around it (empty
 * when unquoted), as the source has them; empty for a bare `class`.
 */
function writtenValue(raw: string) {
  const head = /^class\s*=/i.exec(raw);
  if (!head) {
    return { quote: "", value: "" };
  }
  const rest = raw.slice(head[0].length).trimStart();
  const q = rest[0];
  if ((q === '"' || q === "'") && rest.length >= 2 && rest.endsWith(q)) {
    return { quote: q, value: rest.slice(1, -1) };
  }
  return { quote: "", value: rest };
}
