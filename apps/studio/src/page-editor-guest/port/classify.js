// Which element a pointer means, and whether its text can be edited in place
// or has to go to the agent. Runs in the host against the iframe's live DOM.
import { segments } from "./source.js";

const INLINE = new Set([
  "A",
  "SPAN",
  "B",
  "STRONG",
  "EM",
  "I",
  "SMALL",
  "CODE",
  "MARK",
  "ABBR",
  "TIME",
  "SUP",
  "SUB",
  "U",
  "S",
  "BR",
  "WBR",
  "KBD",
  "Q",
  "CITE",
  "DFN",
  "VAR",
  "SAMP",
  "DATA",
  "LABEL",
  "IMG",
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "g",
  "use",
]);
const TEXT_BLOCKS = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "LI",
  "TD",
  "TH",
  "DT",
  "DD",
  "FIGCAPTION",
  "BUTTON",
  "BLOCKQUOTE",
  "CAPTION",
  "SUMMARY",
  "LEGEND",
  "LABEL",
]);
const SKIP = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "TEXTAREA",
  "SELECT",
  "OPTION",
]);

const hasText = (el) => /\S/.test(el.textContent);
const hasDirectText = (el) =>
  [...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.data));
const phrasingOnly = (el) =>
  [...el.querySelectorAll("*")].every((d) => INLINE.has(d.tagName));

/**
 * The text block a node belongs to: the outermost phrasing-only ancestor that
 * is a text tag (h1-h6, p, li, td, button...), an inline leaf, or a container
 * holding its own text. Null for layout (a div with block children).
 */
export function textBlockFor(node) {
  let el = node?.nodeType === 3 ? node.parentElement : node;
  let best = null;
  for (
    let cur = el;
    cur && cur.tagName !== "BODY" && cur.tagName !== "HTML";
    cur = cur.parentElement
  ) {
    if (SKIP.has(cur.tagName)) return null;
    if (!phrasingOnly(cur) || !hasText(cur)) {
      if (best) break;
      continue;
    }
    if (
      TEXT_BLOCKS.has(cur.tagName) ||
      INLINE.has(cur.tagName) ||
      hasDirectText(cur)
    )
      best = cur;
    if (best && TEXT_BLOCKS.has(best.tagName)) break;
  }
  return best;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const collapse = (s) => s.replace(/\s+/g, " ").trim();

/**
 * Where else in the file this string appears: script bodies (JSON, render
 * code) and data-* attribute values. Word-bounded, and never inside `skip`
 * (the element's own source range).
 */
export function shadowCopies(A, text, skip) {
  const needle = collapse(text);
  if (needle.length < 3) return [];
  const key = `${needle}|${skip?.start}`;
  A.shadowCache ??= new Map();
  if (A.shadowCache.has(key)) return A.shadowCache.get(key);
  const re = new RegExp(
    `(^|[^\\w])${escRe(needle).replace(/ /g, "\\s+")}(?![\\w])`,
    "g",
  );
  const hits = [];
  for (const s of A.scripts) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(s.text)) && hits.length < 8;) {
      const at = s.start + m.index + m[1].length;
      hits.push({
        kind: s.type === "application/json" ? "json" : "script",
        at,
        script: s,
      });
    }
  }
  for (const d of A.dataAttrs) {
    if (skip && d.start >= skip.start && d.end <= skip.end) continue;
    re.lastIndex = 0;
    if (re.test(d.value)) hits.push({ kind: "data", at: d.start, attr: d });
  }
  A.shadowCache.set(key, hits);
  return hits;
}

export const REASONS = {
  generated: "Made by a script",
  copied: "Copied by a script",
  changed: "Changed by a script",
  data: "Used in page data",
  markup: "Unusual markup",
  layout: "Not a text block",
};

/**
 * { ok, reason, entry, seg, shadows } for a text block. The rules, in order:
 * it has a source id, the id is unique in the live DOM, no script touched it
 * or anything inside it, its live text still equals the decoded source text,
 * and that text is not also held in a script or data-* attribute.
 */
export function classify(A, el) {
  const win = el.ownerDocument.defaultView;
  const G = win.__srcEdit;
  const id = el.getAttribute("data-src-id");
  if (id == null) return { ok: false, reason: "generated" };
  const entry = A.entries[Number(id)];
  if (!entry) return { ok: false, reason: "generated" };
  if (el.ownerDocument.querySelectorAll(`[data-src-id="${id}"]`).length > 1)
    return { ok: false, reason: "copied", entry };
  if (G?.isTainted(el)) return { ok: false, reason: "changed", entry };
  const seg = segments(A, entry);
  if (!seg.ok) return { ok: false, reason: "markup", entry, seg };
  if (seg.text !== el.textContent)
    return { ok: false, reason: "changed", entry, seg };
  const shadows = shadowCopies(A, seg.text, {
    start: entry.loc.startOffset,
    end: entry.loc.endOffset,
  });
  if (shadows.length) return { ok: false, reason: "data", entry, seg, shadows };
  return { ok: true, entry, seg };
}

/** Nearest ancestor-or-self that came from the source. */
export function staticAncestor(A, el) {
  for (let cur = el; cur; cur = cur.parentElement) {
    const id = cur.getAttribute?.("data-src-id");
    if (id != null && A.entries[Number(id)])
      return { el: cur, entry: A.entries[Number(id)] };
  }
  return null;
}

/**
 * Share of visible text by what happens on click: edited in place, or routed
 * to the agent (and why). Counts non-whitespace characters.
 */
export function measure(A, doc) {
  const out = { editable: 0, agent: 0, reasons: {} };
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const cache = new Map();
  for (let n; (n = walker.nextNode());) {
    const chars = n.data.replace(/\s+/g, "").length;
    if (!chars) continue;
    const p = n.parentElement;
    if (
      !p ||
      SKIP.has(p.tagName) ||
      p.closest("[hidden],dialog:not([open])") ||
      !p.getClientRects().length
    )
      continue;
    const block = textBlockFor(n);
    let verdict;
    if (!block) verdict = { ok: false, reason: "layout" };
    else {
      if (!cache.has(block)) cache.set(block, classify(A, block));
      verdict = cache.get(block);
    }
    if (verdict.ok) out.editable += chars;
    else {
      out.agent += chars;
      out.reasons[verdict.reason] = (out.reasons[verdict.reason] ?? 0) + chars;
    }
  }
  out.share = out.editable / (out.editable + out.agent || 1);
  return out;
}

// ---------------------------------------------------------------- v2: any element

Object.assign(REASONS, {
  "script-class": "Styled by a script",
  "script-reads": "Read by a script",
  "page-css": "Set by the page’s stylesheet",
  responsive: "Set per screen size",
  layout: "Not a text block",
  root: "The page itself",
});

/** The element's source entry if it has one and it is the only live copy. */
export function staticEntry(A, el) {
  const id = el.getAttribute?.("data-src-id");
  if (id == null) return { ok: false, reason: "generated" };
  const entry = A.entries[Number(id)];
  if (!entry) return { ok: false, reason: "generated" };
  if (el.ownerDocument.querySelectorAll(`[data-src-id="${id}"]`).length > 1)
    return { ok: false, reason: "copied", entry };
  return { ok: true, entry };
}

/** Can its class attribute be edited? Not when a script made it or sets its classes. */
export function styleVerdict(A, el) {
  const G = el.ownerDocument.defaultView.__srcEdit;
  const s = staticEntry(A, el);
  if (!s.ok) return s;
  if (G?.taintSelf.has(el))
    return { ok: false, reason: "changed", entry: s.entry };
  if (G?.classTouched.has(el))
    return { ok: false, reason: "script-class", entry: s.entry };
  return s;
}

const escRe2 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** Does any script mention this id or data-* attribute name? */
function scriptMentions(A, { id, data }) {
  const key = id ? `#${id}` : data;
  A.mentionCache ??= new Map();
  if (!A.mentionCache.has(key))
    A.mentionCache.set(key, findMention(A, { id, data }));
  return A.mentionCache.get(key);
}

function findMention(A, { id, data }) {
  for (const s of A.scripts) {
    if (s.type === "application/json") continue;
    if (id && new RegExp(`["'\`#]${escRe2(id)}["'\`\\s)\\]]`).test(s.text))
      return `#${id}`;
    if (data) {
      const bare = data.slice(5);
      if (
        s.text.includes(data) ||
        new RegExp(`dataset\\.${escRe2(camel(bare))}\\b`).test(s.text)
      )
        return data;
    }
  }
  return null;
}

/**
 * Can this element be moved, duplicated or deleted by splicing the file? Only
 * static markup nobody else touches: no script changed it or its parent's
 * children, no script reads its ids or data-* attributes, and none of its text
 * is also held in page data. `siblings` are the parent's element children,
 * which must all be static for reordering.
 */
export function structureVerdict(A, el) {
  const G = el.ownerDocument.defaultView.__srcEdit;
  const s = staticEntry(A, el);
  if (!s.ok) return s;
  if (["HTML", "HEAD", "BODY", "MAIN"].includes(el.tagName))
    return { ok: false, reason: "root", entry: s.entry };
  if (G?.isTainted(el)) return { ok: false, reason: "changed", entry: s.entry };
  const parent = el.parentElement;
  const p = parent && staticEntry(A, parent);
  if (!p?.ok || G?.taintSelf.has(parent))
    return { ok: false, reason: "changed", entry: s.entry };
  for (const n of [el, ...el.querySelectorAll("*")]) {
    for (const a of n.attributes) {
      if (a.name === "data-src-id") continue;
      const hit =
        a.name === "id"
          ? scriptMentions(A, { id: a.value })
          : a.name.startsWith("data-")
            ? scriptMentions(A, { data: a.name })
            : null;
      if (hit)
        return {
          ok: false,
          reason: "script-reads",
          entry: s.entry,
          detail: hit,
        };
    }
  }
  // The list itself: a script that finds it by id or data-* owns its order.
  for (const a of parent.attributes) {
    const hit =
      a.name === "id"
        ? scriptMentions(A, { id: a.value })
        : a.name.startsWith("data-") && a.name !== "data-src-id"
          ? scriptMentions(A, { data: a.name })
          : null;
    if (hit)
      return { ok: false, reason: "script-reads", entry: s.entry, detail: hit };
  }
  for (const n of [el, ...el.querySelectorAll("*")]) {
    if (textBlockFor(n) !== n) continue;
    const v = classify(A, n);
    if (!v.ok && v.reason === "data")
      return { ok: false, reason: "data", entry: s.entry, shadows: v.shadows };
  }
  const siblings = [...parent.children].filter(
    (c) => !c.hasAttribute("data-editor-guest"),
  );
  const allStatic = siblings.every((c) => staticEntry(A, c).ok);
  return { ok: true, entry: s.entry, siblings: allStatic ? siblings : [el] };
}

/** What to call an element in the toolbar. */
export function kindName(el) {
  const t = el.tagName;
  if (/^H[1-6]$/.test(t)) return "Heading";
  if (t === "IMG") return "Image";
  if (t === "A") return "Link";
  if (t === "BUTTON") return "Button";
  if (t === "UL" || t === "OL") return "List";
  if (t === "SECTION") return "Section";
  if (t === "HEADER") return "Header";
  if (t === "FOOTER") return "Footer";
  if (t === "TD" || t === "TH") return "Cell";
  if (t === "TABLE") return "Table";
  if (t === "BLOCKQUOTE") return "Quote";
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  const framed =
    cs.borderTopWidth !== "0px" ||
    (cs.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      cs.backgroundColor !== "transparent") ||
    cs.boxShadow !== "none";
  const hasBlocks = [...el.children].some(
    (c) =>
      !["SPAN", "A", "B", "STRONG", "EM", "I", "BR", "SMALL", "CODE"].includes(
        c.tagName,
      ),
  );
  if (t === "ARTICLE" || (framed && hasBlocks)) return "Card";
  if (t === "LI") return "List item";
  if (t === "P" || t === "SPAN" || t === "SMALL" || t === "LABEL")
    return "Text";
  if (t === "NAV") return "Navigation";
  if (t === "FORM") return "Form";
  return hasBlocks ? "Group" : "Text";
}
