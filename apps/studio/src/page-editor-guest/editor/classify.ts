/**
 * Which element a pointer means, and what the editor may do to it: edit its
 * text in place, restyle it, move or remove it, or only ask the agent (and
 * why). Every verdict is read against the page's live DOM and the page
 * watch's record of what its scripts touched.
 */
import { pageWatch } from "./observer";
import {
  type Analysis,
  type PageSourceEntry,
  type Range,
  type Segments,
  segments,
  type ShadowHit,
} from "./source";

const INLINE = new Set([
  "A",
  "ABBR",
  "B",
  "BR",
  "circle",
  "CITE",
  "CODE",
  "DATA",
  "DFN",
  "EM",
  "g",
  "I",
  "IMG",
  "KBD",
  "LABEL",
  "line",
  "MARK",
  "path",
  "polygon",
  "polyline",
  "Q",
  "rect",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "svg",
  "TIME",
  "U",
  "use",
  "VAR",
  "WBR",
]);
const TEXT_BLOCKS = new Set([
  "BLOCKQUOTE",
  "BUTTON",
  "CAPTION",
  "DD",
  "DT",
  "FIGCAPTION",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LABEL",
  "LEGEND",
  "LI",
  "P",
  "SUMMARY",
  "TD",
  "TH",
]);
const SKIP = new Set([
  "NOSCRIPT",
  "OPTION",
  "SCRIPT",
  "SELECT",
  "STYLE",
  "TEMPLATE",
  "TEXTAREA",
]);

const hasText = (el: Element) => /\S/.test(el.textContent);
const hasDirectText = (el: Element) =>
  [...el.childNodes].some((n) => n instanceof Text && /\S/.test(n.data));
const phrasingOnly = (el: Element) =>
  [...el.querySelectorAll("*")].every((d) => INLINE.has(d.tagName));

/**
 * The text block a node belongs to: the outermost phrasing-only ancestor that
 * is a text tag (h1-h6, p, li, td, button...), an inline leaf, or a container
 * holding its own text. Null for layout (a div with block children).
 */
export function textBlockFor(node: Node | null): Element | null {
  const el = node instanceof Text ? node.parentElement : node;
  let best: Element | null = null;
  for (
    let cur = el instanceof Element ? el : null;
    cur && cur.tagName !== "BODY" && cur.tagName !== "HTML";
    cur = cur.parentElement
  ) {
    if (SKIP.has(cur.tagName)) {
      return null;
    }
    if (!phrasingOnly(cur) || !hasText(cur)) {
      if (best) {
        break;
      }
      continue;
    }
    if (
      TEXT_BLOCKS.has(cur.tagName) ||
      INLINE.has(cur.tagName) ||
      hasDirectText(cur)
    ) {
      best = cur;
    }
    if (best && TEXT_BLOCKS.has(best.tagName)) {
      break;
    }
  }
  return best;
}

export const escapeRegExp = (s: string) =>
  s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
const collapse = (s: string) => s.replaceAll(/\s+/g, " ").trim();

export type Reason =
  | "changed"
  | "copied"
  | "data"
  | "generated"
  | "layout"
  | "markup"
  | "page-css"
  | "responsive"
  | "root"
  | "script-class"
  | "script-reads";

/**
 * Where else in the file this string appears: script bodies (JSON, render
 * code) and data-* attribute values. Word-bounded, and never inside `skip`
 * (the element's own source range).
 */
export function shadowCopies(
  A: Analysis,
  text: string,
  skip: null | Range,
): ShadowHit[] {
  const needle = collapse(text);
  if (needle.length < 3) {
    return [];
  }
  const key = `${needle}|${skip?.start ?? "-"}`;
  const cached = A.shadowCache.get(key);
  if (cached) {
    return cached;
  }
  const re = new RegExp(
    `(^|[^\\w])${escapeRegExp(needle).replaceAll(" ", "\\s+")}(?![\\w])`,
    "g",
  );
  const hits: ShadowHit[] = [];
  for (const s of A.scripts) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(s.text)) && hits.length < 8;) {
      const at = s.start + m.index + (m[1] ?? "").length;
      hits.push({
        at,
        kind: s.type === "application/json" ? "json" : "script",
        script: s,
      });
    }
  }
  for (const d of A.dataAttrs) {
    if (skip && d.start >= skip.start && d.end <= skip.end) {
      continue;
    }
    re.lastIndex = 0;
    if (re.test(d.value)) {
      hits.push({ at: d.start, attr: d, kind: "data" });
    }
  }
  A.shadowCache.set(key, hits);
  return hits;
}

/** Why the editor leaves something to the agent, as the toolbar says it. */
export const REASONS: Record<Reason, string> = {
  changed: "Changed by a script",
  copied: "Copied by a script",
  data: "Used in page data",
  generated: "Made by a script",
  layout: "Not a text block",
  markup: "Unusual markup",
  "page-css": "Set by the page’s stylesheet",
  responsive: "Set per screen size",
  root: "The page itself",
  "script-class": "Styled by a script",
  "script-reads": "Read by a script",
};

/** Something the editor will not change itself, and why. */
export interface Blocked {
  /** What a script reads it by (`#id` or a data-* name), for "script-reads". */
  detail?: string;
  entry?: PageSourceEntry;
  ok: false;
  reason: Reason;
  seg?: Segments;
  /** Where its text also appears, for "data". */
  shadows?: ShadowHit[];
}

export type StaticVerdict = Blocked | { entry: PageSourceEntry; ok: true };
export type StructureVerdict =
  | Blocked
  | { entry: PageSourceEntry; ok: true; siblings: Element[] };
export type TextVerdict =
  | Blocked
  | { entry: PageSourceEntry; ok: true; seg: Segments };

/**
 * Whether a text block can be edited in place. The rules, in order: it has a
 * source id, the id is unique in the live DOM, no script touched it or
 * anything inside it, its live text still equals the decoded source text, and
 * that text is not also held in a script or data-* attribute.
 */
export function classify(A: Analysis, el: Element): TextVerdict {
  const watch = pageWatch();
  const id = el.getAttribute("data-src-id");
  if (id === null) {
    return { ok: false, reason: "generated" };
  }
  const entry = A.entries[Number(id)];
  if (!entry) {
    return { ok: false, reason: "generated" };
  }
  if (el.ownerDocument.querySelectorAll(`[data-src-id="${id}"]`).length > 1) {
    return { entry, ok: false, reason: "copied" };
  }
  if (watch?.isTainted(el)) {
    return { entry, ok: false, reason: "changed" };
  }
  const seg = segments(A, entry);
  if (!seg.ok) {
    return { entry, ok: false, reason: "markup", seg };
  }
  if (seg.text !== el.textContent) {
    return { entry, ok: false, reason: "changed", seg };
  }
  const shadows = shadowCopies(A, seg.text, {
    end: entry.loc.endOffset,
    start: entry.loc.startOffset,
  });
  if (shadows.length > 0) {
    return { entry, ok: false, reason: "data", seg, shadows };
  }
  return { entry, ok: true, seg };
}

/**
 * Share of visible text by what happens on click: edited in place, or routed
 * to the agent (and why). Counts non-whitespace characters.
 */
export function measure(A: Analysis, doc: Document) {
  const reasons: Partial<Record<Reason, number>> = {};
  const out = { agent: 0, editable: 0, reasons, share: 0 };
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const cache = new Map<Element, TextVerdict>();
  for (let n; (n = walker.nextNode());) {
    const chars = (n.textContent ?? "").replaceAll(/\s+/g, "").length;
    if (!chars) {
      continue;
    }
    const p = n.parentElement;
    if (
      !p ||
      SKIP.has(p.tagName) ||
      p.closest("[hidden],dialog:not([open])") ||
      p.getClientRects().length === 0
    ) {
      continue;
    }
    const block = textBlockFor(n);
    let verdict: TextVerdict;
    if (block) {
      verdict = cache.get(block) ?? classify(A, block);
      cache.set(block, verdict);
    } else {
      verdict = { ok: false, reason: "layout" };
    }
    if (verdict.ok) {
      out.editable += chars;
    } else {
      out.agent += chars;
      out.reasons[verdict.reason] = (out.reasons[verdict.reason] ?? 0) + chars;
    }
  }
  out.share = out.editable / (out.editable + out.agent || 1);
  return out;
}

/** Nearest ancestor-or-self that came from the source. */
export function staticAncestor(A: Analysis, el: Element) {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const id = cur.getAttribute("data-src-id");
    const entry = id === null ? undefined : A.entries[Number(id)];
    if (entry) {
      return { el: cur, entry };
    }
  }
  return null;
}

/** The element's source entry if it has one and it is the only live copy. */
export function staticEntry(A: Analysis, el: Element): StaticVerdict {
  const id = el.getAttribute("data-src-id");
  if (id === null) {
    return { ok: false, reason: "generated" };
  }
  const entry = A.entries[Number(id)];
  if (!entry) {
    return { ok: false, reason: "generated" };
  }
  if (el.ownerDocument.querySelectorAll(`[data-src-id="${id}"]`).length > 1) {
    return { entry, ok: false, reason: "copied" };
  }
  return { entry, ok: true };
}

/** Can its class attribute be edited? Not when a script made it or sets its classes. */
export function styleVerdict(A: Analysis, el: Element): StaticVerdict {
  const watch = pageWatch();
  const s = staticEntry(A, el);
  if (!s.ok) {
    return s;
  }
  if (watch?.taintSelf.has(el)) {
    return { entry: s.entry, ok: false, reason: "changed" };
  }
  if (watch?.classTouched.has(el)) {
    return { entry: s.entry, ok: false, reason: "script-class" };
  }
  return s;
}

const camel = (s: string) =>
  s.replaceAll(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** What to call an element in the toolbar. */
export function kindName(el: Element) {
  const t = el.tagName;
  if (/^H[1-6]$/.test(t)) {
    return "Heading";
  }
  const named: Record<string, string> = {
    A: "Link",
    BLOCKQUOTE: "Quote",
    BUTTON: "Button",
    FOOTER: "Footer",
    HEADER: "Header",
    IMG: "Image",
    OL: "List",
    SECTION: "Section",
    TABLE: "Table",
    TD: "Cell",
    TH: "Cell",
    UL: "List",
  };
  const name = named[t];
  if (name) {
    return name;
  }
  const cs = getComputedStyle(el);
  const framed =
    cs.borderTopWidth !== "0px" ||
    (cs.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      cs.backgroundColor !== "transparent") ||
    cs.boxShadow !== "none";
  const hasBlocks = [...el.children].some(
    (c) =>
      !["A", "B", "BR", "CODE", "EM", "I", "SMALL", "SPAN", "STRONG"].includes(
        c.tagName,
      ),
  );
  if (t === "ARTICLE" || (framed && hasBlocks)) {
    return "Card";
  }
  if (t === "LI") {
    return "List item";
  }
  if (t === "P" || t === "SPAN" || t === "SMALL" || t === "LABEL") {
    return "Text";
  }
  if (t === "NAV") {
    return "Navigation";
  }
  if (t === "FORM") {
    return "Form";
  }
  return hasBlocks ? "Group" : "Text";
}

/**
 * Can this element be moved, duplicated or deleted by splicing the file? Only
 * static markup nobody else touches: no script changed it or its parent's
 * children, no script reads its ids or data-* attributes, and none of its text
 * is also held in page data. `siblings` are the parent's element children,
 * which must all be static for reordering.
 */
export function structureVerdict(A: Analysis, el: Element): StructureVerdict {
  const watch = pageWatch();
  const s = staticEntry(A, el);
  if (!s.ok) {
    return s;
  }
  if (["BODY", "HEAD", "HTML", "MAIN"].includes(el.tagName)) {
    return { entry: s.entry, ok: false, reason: "root" };
  }
  if (watch?.isTainted(el)) {
    return { entry: s.entry, ok: false, reason: "changed" };
  }
  const parent = el.parentElement;
  if (!parent || !staticEntry(A, parent).ok || watch?.taintSelf.has(parent)) {
    return { entry: s.entry, ok: false, reason: "changed" };
  }
  for (const n of [el, ...el.querySelectorAll("*")]) {
    for (const a of n.attributes) {
      const hit = attrMention(A, a);
      if (hit) {
        return {
          detail: hit,
          entry: s.entry,
          ok: false,
          reason: "script-reads",
        };
      }
    }
  }
  // The list itself: a script that finds it by id or data-* owns its order.
  for (const a of parent.attributes) {
    const hit = attrMention(A, a);
    if (hit) {
      return { detail: hit, entry: s.entry, ok: false, reason: "script-reads" };
    }
  }
  for (const n of [el, ...el.querySelectorAll("*")]) {
    if (textBlockFor(n) !== n) {
      continue;
    }
    const v = classify(A, n);
    if (!v.ok && v.reason === "data") {
      return {
        entry: s.entry,
        ok: false,
        reason: "data",
        shadows: v.shadows,
      };
    }
  }
  const siblings = [...parent.children].filter(
    (c) => !c.hasAttribute("data-editor-guest"),
  );
  const allStatic = siblings.every((c) => staticEntry(A, c).ok);
  return { entry: s.entry, ok: true, siblings: allStatic ? siblings : [el] };
}

/** What a script reads this attribute by, if one does. */
function attrMention(A: Analysis, a: Attr) {
  if (a.name === "id") {
    return scriptMentions(A, { id: a.value });
  }
  if (a.name.startsWith("data-") && a.name !== "data-src-id") {
    return scriptMentions(A, { data: a.name });
  }
  return null;
}

function findMention(A: Analysis, mention: { data: string } | { id: string }) {
  for (const s of A.scripts) {
    if (s.type === "application/json") {
      continue;
    }
    if ("id" in mention) {
      const { id } = mention;
      if (
        id &&
        new RegExp(`["'\`#]${escapeRegExp(id)}["'\`\\s)\\]]`).test(s.text)
      ) {
        return `#${id}`;
      }
      continue;
    }
    const { data } = mention;
    if (data) {
      const bare = data.slice(5);
      if (
        s.text.includes(data) ||
        new RegExp(`dataset\\.${escapeRegExp(camel(bare))}\\b`).test(s.text)
      ) {
        return data;
      }
    }
  }
  return null;
}

/** Does any script mention this id or data-* attribute name? */
function scriptMentions(
  A: Analysis,
  mention: { data: string } | { id: string },
) {
  const key = "id" in mention ? `#${mention.id}` : mention.data;
  const cached = A.mentionCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const found = findMention(A, mention);
  A.mentionCache.set(key, found);
  return found;
}
