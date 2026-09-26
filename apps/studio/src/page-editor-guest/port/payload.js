// What the agent receives for one request, and for the whole queue. The source
// is one file with exact offsets, so the payload points at lines, not guesses.
import { finder } from "@medv/finder";
import { REASONS, shadowCopies, staticAncestor } from "./classify.js";

const STATUS = {
  static: "static text in the file",
  generated: "made by a script (not in the file as shown)",
  copied: "copied by a script from markup in the file",
  changed: "in the file, but a script rewrites it after load",
  data: "static text, also used by the page's data",
  markup: "static text with unusual markup",
  layout: "layout element",
  element: "static element in the file",
  "script-class": "in the file, but a script sets its classes after load",
  "script-reads": "in the file; a script reads it by id or data-* attribute",
  "page-css":
    "in the file; the page's own stylesheet decides this property, so a utility class has no effect",
  responsive:
    "in the file; a screen-size variant class decides this property at the current width",
  root: "page root",
};

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const collapse = (s) => s.replace(/\s+/g, " ").trim();

/** Source of an element, trimmed to its start tag, some text, and end tag. */
function snippet(A, entry, max = 360) {
  const { startOffset: a, endOffset: b } = entry.loc;
  const full = A.src.slice(a, b);
  if (full.length <= max) return full;
  const open = A.src.slice(a, entry.loc.startTag.endOffset);
  const close = entry.loc.endTag
    ? A.src.slice(entry.loc.endTag.startOffset, b)
    : "";
  return `${clip(open, max - 60)}${clip(collapse(A.src.slice(entry.loc.startTag.endOffset, entry.loc.endTag?.startOffset ?? b)), 60)}${close}`;
}

const lineOf = (A, off) => A.lineCol(off).line;
const lineText = (A, off) => {
  const s = A.src.lastIndexOf("\n", off) + 1;
  const e = A.src.indexOf("\n", off);
  const line = A.src.slice(s, e < 0 ? undefined : e);
  const col = off - s;
  return collapse(
    line.length > 140
      ? `…${line.slice(Math.max(0, col - 50), col + 80)}…`
      : line,
  );
};

/** Best-effort list of script and data lines that hold or render this element's text. */
function fedBy(A, el, entry) {
  const hits = new Map();
  const add = (at, label) => {
    const line = lineOf(A, at);
    if (!hits.has(line) && hits.size < 6)
      hits.set(line, `line ${line} (${label}): ${lineText(A, at)}`);
  };
  const texts = new Set();
  texts.add(collapse(el.textContent));
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());)
    if (collapse(n.data).length >= 3) texts.add(collapse(n.data));
  const skip = entry
    ? { start: entry.loc.startOffset, end: entry.loc.endOffset }
    : null;
  for (const t of texts) {
    if (t.length > 120) continue;
    for (const h of shadowCopies(A, t, skip)) {
      const label =
        h.kind === "json"
          ? `JSON${h.script.domId ? ` #${h.script.domId}` : ""}`
          : h.kind === "data"
            ? h.attr.name
            : "script";
      add(h.at, label);
    }
  }
  // Scripts that address the nearest element with an id, e.g. $("#leaderboard").
  for (let cur = el; cur && hits.size < 6; cur = cur.parentElement) {
    if (!cur.id) continue;
    const re = new RegExp(
      `["'\`#]${cur.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`\\s)]`,
    );
    for (const s of A.scripts) {
      const m = re.exec(s.text);
      if (m) add(s.start + m.index, `script uses #${cur.id}`);
    }
    break;
  }
  return [...hits.values()];
}

/**
 * One request's payload. `verdict` is classify()'s result (or { reason } for
 * a non-text element). `edit` is { from, to } when this is a queued text edit.
 */
export function buildRequest({
  A,
  path,
  el,
  verdict,
  instruction,
  edit,
  change,
}) {
  const doc = el.ownerDocument;
  const reason = verdict.ok ? (verdict.status ?? "static") : verdict.reason;
  const inFile = reason !== "generated";
  const anchor =
    inFile && verdict.entry
      ? { el, entry: verdict.entry }
      : staticAncestor(A, el);
  const lines = [];
  if (anchor) {
    const a = A.lineCol(anchor.entry.loc.startOffset);
    const b = A.lineCol(anchor.entry.loc.endOffset);
    lines.push(
      `${inFile ? "Where" : "Nearest source element"}: ${path} ${a.line}:${a.col}–${b.line}:${b.col} <${anchor.entry.tag}>`,
    );
  } else lines.push(`Where: ${path}, no source element found`);
  lines.push(`Status: ${STATUS[reason] ?? reason}`);
  if (anchor)
    lines.push(
      "Source:",
      ...snippet(A, anchor.entry)
        .split("\n")
        .map((l) => `  ${l}`),
    );
  const fed = fedBy(A, el, inFile ? verdict.entry : null);
  if (fed.length)
    lines.push(
      inFile ? "Also appears at:" : "Fed by (best guess):",
      ...fed.map((f) => `  ${f}`),
    );
  lines.push(
    `Live text: "${clip(collapse(el.innerText ?? el.textContent), 160)}"`,
  );
  let selector = "";
  try {
    selector = finder(el, {
      root: doc.body,
      attr: (n) =>
        n !== "data-src-id" && n.startsWith("data-") && n !== "data-state",
      seedMinLength: 2,
    });
  } catch {
    selector = el.tagName.toLowerCase();
  }
  lines.push(`Selector: ${selector}`);
  if (edit)
    lines.push(
      `Text edit: "${clip(edit.from, 200)}" → "${clip(edit.to, 200)}"`,
    );
  if (change) lines.push(`Attempted change: ${change}`);
  lines.push(`Instruction: ${instruction}`);
  return {
    reason,
    label: verdict.ok ? (verdict.label ?? "Static text") : REASONS[reason],
    text: lines.join("\n"),
    selector,
    liveText: collapse(el.textContent),
    displayText: collapse(el.innerText ?? el.textContent),
    anchorSnippet: anchor
      ? A.src.slice(anchor.entry.loc.startOffset, anchor.entry.loc.endOffset)
      : "",
    anchorStart: anchor?.entry.loc.startOffset ?? -1,
    generated: !inFile,
    line: anchor ? A.lineCol(anchor.entry.loc.startOffset).line : null,
    endLine: anchor
      ? A.lineCol(
          Math.max(
            anchor.entry.loc.startOffset,
            anchor.entry.loc.endOffset - 1,
          ),
        ).line
      : null,
  };
}

/** The message "Send to agent" would post: every queued request, numbered. */
export function combine(path, requests) {
  const head = [
    `The user left ${requests.length} request${requests.length === 1 ? "" : "s"} on ${path}.`,
    "Line numbers refer to the file as it is on disk now. Apply each one by editing the file; for text a script renders, change the data or code that produces it.",
  ];
  const body = requests.map((r) =>
    [
      `## ${r.n}. ${r.kind === "edit" ? (r.edit ? "Text edit" : "Queued edit") : "Request"}${r.stale ? " (element no longer found; use the snippet)" : ""}`,
      r.payload.text,
    ].join("\n"),
  );
  return [...head, "", ...body.flatMap((b) => [b, ""])].join("\n").trim();
}
