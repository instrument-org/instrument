// The source side: parse the file with source locations, serve an instrumented
// copy with a data-src-id on every element, and turn a visible-text edit into
// minimal splices of the file's text nodes.
import {
  DIFF_DELETE,
  DIFF_INSERT,
  diffCleanupSemantic,
  diffMain,
} from "diff-match-patch-es";
import { indexPageSource } from "../../shared/page-source.ts";

const decoder = document.createElement("textarea");
const decodeEntity = (s) => {
  decoder.innerHTML = s;
  return decoder.value;
};

/**
 * Parse `src` and index it. Ids are ordinals in document order, so a text-only
 * splice keeps every id pointing at the same element after a re-parse.
 */
export function analyze(src) {
  const { entries } = indexPageSource(src);
  const byStart = new Map(); // start offset -> entry
  const scripts = []; // { start, end, text, type, domId }
  const dataAttrs = []; // { name, value, start, end }
  let head = null;
  let hasBase = false;
  for (const entry of entries) {
    const child = entry.node;
    const loc = entry.loc;
    byStart.set(loc.startTag.startOffset, entry);
    child.__entry = entry;
    if (child.tagName === "head") head = entry;
    if (child.tagName === "base") hasBase = true;
    for (const a of child.attrs) {
      if (a.name.startsWith("data-") && loc.attrs?.[a.name])
        dataAttrs.push({
          name: a.name,
          value: a.value,
          start: loc.attrs[a.name].startOffset,
          end: loc.attrs[a.name].endOffset,
        });
    }
    if (child.tagName === "script") {
      const t = child.childNodes[0];
      if (t?.sourceCodeLocation) {
        const attr = (n) => child.attrs.find((a) => a.name === n)?.value;
        scripts.push({
          start: t.sourceCodeLocation.startOffset,
          end: t.sourceCodeLocation.endOffset,
          text: t.value,
          type: attr("type") || "script",
          domId: attr("id"),
        });
      }
    }
  }

  const lineStarts = [0];
  for (let i = src.indexOf("\n"); i >= 0; i = src.indexOf("\n", i + 1))
    lineStarts.push(i + 1);
  const lineCol = (off) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: off - lineStarts[lo] + 1 };
  };

  return {
    src,
    entries,
    byStart,
    scripts,
    dataAttrs,
    head,
    hasBase,
    lineCol,
    segCache: new Map(),
  };
}

/**
 * The text nodes under an element, in source order, each split into runs of
 * literal characters and entities so a position in the decoded (visible) text
 * maps back to a source offset. `ok` is false when the runs do not reproduce
 * parse5's decoded value (odd entity forms, CRLF): those stay read-only.
 */
export function segments(A, entry) {
  if (A.segCache.has(entry.id)) return A.segCache.get(entry.id);
  const segs = [];
  let ok = true;
  let text = "";
  const collect = (node) => {
    for (const c of node.childNodes ?? []) {
      if (c.nodeName === "#text") {
        const loc = c.sourceCodeLocation;
        if (!loc) {
          ok = false;
          continue;
        }
        const raw = A.src.slice(loc.startOffset, loc.endOffset);
        const runs = [];
        let dec = text.length;
        const re = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;
        let last = 0;
        const lit = (a, b) => {
          if (b > a)
            runs.push({
              s: loc.startOffset + a,
              e: loc.startOffset + b,
              ds: dec,
              de: (dec += b - a),
              ent: false,
            });
        };
        for (let m; (m = re.exec(raw));) {
          lit(last, m.index);
          const v = decodeEntity(m[0]);
          runs.push({
            s: loc.startOffset + m.index,
            e: loc.startOffset + m.index + m[0].length,
            ds: dec,
            de: (dec += v.length),
            ent: true,
            value: v,
          });
          last = m.index + m[0].length;
        }
        lit(last, raw.length);
        const decoded = runs
          .map((r) => (r.ent ? r.value : A.src.slice(r.s, r.e)))
          .join("");
        if (decoded !== c.value) ok = false;
        const raws = [
          "script",
          "style",
          "textarea",
          "title",
          "noscript",
          "xmp",
          "iframe",
        ].includes(node.tagName);
        if (raws) ok = false;
        segs.push({
          start: loc.startOffset,
          end: loc.endOffset,
          ds: text.length,
          de: text.length + c.value.length,
          runs,
          node: c,
        });
        text += c.value;
      } else if (c.tagName && c.tagName !== "template") {
        collect(c);
      }
    }
  };
  collect(entry.node);
  const out = { ok, segs, text };
  A.segCache.set(entry.id, out);
  return out;
}

const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * Visible-text change -> source splices [{ start, end, text }], touching only
 * the text-node characters that changed. Unchanged entities and markup stay as
 * written; an edit that lands inside an entity rewrites just that entity.
 * Returns { splices, written } where `written` is the decoded text the splices
 * produce (typed non-breaking spaces become plain spaces).
 */
export function textSplices(seg, newText) {
  const oldText = seg.text;
  const diffs = diffMain(oldText, newText);
  diffCleanupSemantic(diffs);
  const edits = [];
  let pos = 0;
  for (const [op, s] of diffs) {
    if (op === DIFF_DELETE) {
      const last = edits.at(-1);
      if (last && last.to === pos && last.from === pos)
        last.to = pos + s.length;
      else edits.push({ from: pos, to: pos + s.length, text: "" });
      pos += s.length;
    } else if (op === DIFF_INSERT) {
      const last = edits.at(-1);
      if (last && last.to === pos) last.text += s;
      else edits.push({ from: pos, to: pos, text: s });
    } else {
      pos += s.length;
    }
  }
  // Edits inside one word become one edit ("blacktop" -> "playground", not b->p + cktop->yground).
  for (let i = edits.length - 1; i > 0; i--) {
    const [a, b] = [edits[i - 1], edits[i]];
    const between = oldText.slice(a.to, b.from);
    if (/\s/.test(between)) continue;
    edits.splice(i - 1, 2, {
      from: a.from,
      to: b.to,
      text: a.text + between + b.text,
    });
  }
  const runs = seg.segs.flatMap((sg) => sg.runs);
  // Snap edit boundaries out of entities.
  for (const ed of edits) {
    for (const r of runs) {
      if (!r.ent) continue;
      if (r.ds < ed.from && ed.from < r.de) {
        ed.text = oldText.slice(r.ds, ed.from) + ed.text;
        ed.from = r.ds;
      }
      if (r.ds < ed.to && ed.to < r.de) {
        ed.text += oldText.slice(ed.to, r.de);
        ed.to = r.de;
      }
    }
    ed.text = ed.text.replace(/\u00a0/g, " ");
  }
  const splices = [];
  for (const ed of edits) {
    if (ed.from === ed.to) {
      const sg = seg.segs.find((g) => g.ds <= ed.from && ed.from <= g.de);
      if (!sg) return null;
      const at = sg.runs.length ? srcAtIn(sg.runs, ed.from) : sg.start;
      splices.push({ start: at, end: at, text: escapeText(ed.text) });
      continue;
    }
    let first = true;
    for (const sg of seg.segs) {
      const a = Math.max(ed.from, sg.ds);
      const b = Math.min(ed.to, sg.de);
      if (a >= b) continue;
      splices.push({
        start: srcAtIn(sg.runs, a),
        end: srcAtIn(sg.runs, b, true),
        text: first ? escapeText(ed.text) : "",
      });
      first = false;
    }
    if (first) return null;
  }
  let written = oldText;
  for (const ed of [...edits].reverse())
    written = written.slice(0, ed.from) + ed.text + written.slice(ed.to);
  return { splices, written };
}

function srcAtIn(runs, d, isEnd = false) {
  // For a range end, take the run that ends at d; for a start, the one starting at d.
  const r =
    (isEnd
      ? runs.find((x) => x.ds < d && d <= x.de)
      : runs.find((x) => x.ds <= d && d < x.de)) ??
    runs.find((x) => x.ds <= d && d <= x.de);
  if (d === r.ds) return r.s;
  if (d === r.de) return r.e;
  return r.s + (d - r.ds);
}

export function applySplices(text, splices, offset = 0) {
  let out = text;
  for (const sp of [...splices].sort((a, b) => b.start - a.start))
    out =
      out.slice(0, sp.start - offset) + sp.text + out.slice(sp.end - offset);
  return out;
}

/** The element's whole source range, start tag through end tag. */
export function outerRange(entry) {
  return { start: entry.loc.startOffset, end: entry.loc.endOffset };
}

/** Find `needle` in `hay`, choosing the occurrence closest to `near`. */
export function findNearest(hay, needle, near) {
  if (!needle) return -1;
  let best = -1;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i;
    if (i > near && best >= 0) break;
  }
  return best;
}

/** Changed ranges of `next` relative to `prev`, in `next` offsets. */
export function changedRanges(prev, next) {
  const diffs = diffMain(prev, next);
  diffCleanupSemantic(diffs);
  const out = [];
  let pos = 0;
  for (const [op, s] of diffs) {
    if (op === DIFF_INSERT) {
      out.push({ start: pos, end: pos + s.length });
      pos += s.length;
    } else if (op === DIFF_DELETE) {
      out.push({ start: pos, end: pos });
    } else pos += s.length;
  }
  return out;
}

/** Offsets of an element's content, between its start and end tags (null for void elements). */
export function innerRange(entry) {
  if (!entry.loc.endTag) return null;
  return {
    start: entry.loc.startTag.endOffset,
    end: entry.loc.endTag.startOffset,
  };
}

/** The start of the whitespace run right before `at` (so a moved line keeps its indent). */
export function leadingWs(src, at) {
  let i = at;
  while (i > 0 && /[ \t\r\n]/.test(src[i - 1])) i--;
  return i;
}

/**
 * The class attribute as written: its tokens and where the value sits. With no
 * class attribute, `insertAt` is right after the tag name.
 */
export function classAttr(A, entry) {
  const at = entry.loc.attrs?.class;
  if (!at)
    return {
      tokens: [],
      exists: false,
      insertAt: entry.loc.startTag.startOffset + 1 + entry.tag.length,
    };
  const raw = A.src.slice(at.startOffset, at.endOffset);
  const m = /^class\s*=\s*(["']?)([\s\S]*?)\1$/i.exec(raw);
  const value = m ? m[2] : "";
  return {
    tokens: value.split(/\s+/).filter(Boolean),
    exists: true,
    start: at.startOffset,
    end: at.endOffset,
    quote: m?.[1] || '"',
    value,
  };
}

/** The splice that makes the element's class attribute read `next` (a token string). */
export function classSplice(A, entry, next) {
  const c = classAttr(A, entry);
  if (!c.exists)
    return next
      ? { start: c.insertAt, end: c.insertAt, text: ` class="${next}"` }
      : null;
  if (!next) return { start: leadingWs(A.src, c.start), end: c.end, text: "" };
  return {
    start: c.start,
    end: c.end,
    text: `class=${c.quote}${next}${c.quote}`,
  };
}

/** Where `off` in `prev` lands in `next`. */
export function mapOffset(prev, next, off) {
  if (prev === next) return off;
  const diffs = diffMain(prev, next);
  let a = 0;
  let b = 0;
  for (const [op, s] of diffs) {
    if (op === DIFF_DELETE) {
      if (off < a + s.length) return b;
      a += s.length;
    } else if (op === DIFF_INSERT) {
      b += s.length;
    } else {
      if (off < a + s.length) return b + (off - a);
      a += s.length;
      b += s.length;
    }
  }
  return b + (off - a);
}

/**
 * `neu` rewritten so any stretch that differs from `old` only in whitespace
 * keeps `old`'s whitespace (a serializer collapses the source's line breaks
 * and indentation; the file should keep them).
 */
export function keepWhitespace(old, neu) {
  const diffs = diffMain(old, neu);
  diffCleanupSemantic(diffs);
  let out = "";
  for (let i = 0; i < diffs.length; i++) {
    const [op, s] = diffs[i];
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
      if (!/\S/.test(s) && /\n/.test(s)) out += s;
    } else if (op === DIFF_INSERT) {
      out += s;
    } else out += s;
  }
  return out;
}

/** The one splice turning `old` into `neu`, trimmed to the stretch that differs. */
export function trimmedSplice(old, neu, offset) {
  let s = 0;
  while (s < old.length && s < neu.length && old[s] === neu[s]) s++;
  let e = 0;
  while (
    e < old.length - s &&
    e < neu.length - s &&
    old[old.length - 1 - e] === neu[neu.length - 1 - e]
  )
    e++;
  return {
    start: offset + s,
    end: offset + old.length - e,
    text: neu.slice(s, neu.length - e),
  };
}
