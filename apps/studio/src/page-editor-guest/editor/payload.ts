/**
 * What the agent receives for one ask. The source is one file with exact
 * offsets, so the payload points at lines, not guesses: where the element is,
 * its source, what makes or feeds it, and what the person asked.
 */
import { finder } from "@medv/finder";

import {
  type Blocked,
  escapeRegExp,
  REASONS,
  shadowCopies,
  staticAncestor,
} from "./classify";
import { type Analysis, type PageSourceEntry, type Range } from "./source";

/** The verdict a request is built from: why the element is the agent's, or what it is. */
export type AskVerdict =
  | Blocked
  | {
      entry: null | PageSourceEntry | undefined;
      label: string;
      ok: true;
      status: RequestStatus;
    };

export interface RequestPayload {
  anchorSnippet: string;
  anchorStart: number;
  displayText: string;
  endLine: null | number;
  /** The element is not in the file as shown: a script made it. */
  generated: boolean;
  label: string;
  line: null | number;
  liveText: string;
  selector: string;
  /** The full description the agent reads. */
  text: string;
}

/** How a request describes what it points at, beyond the reasons a verdict can give. */
export type RequestStatus = "element" | "static";

/** A text edit the editor could not write itself, queued for the agent. */
export interface TextEdit {
  from: string;
  to: string;
}

const STATUS: Record<string, string> = {
  changed: "in the file, but a script rewrites it after load",
  copied: "copied by a script from markup in the file",
  data: "static text, also used by the page's data",
  element: "static element in the file",
  generated: "made by a script (not in the file as shown)",
  layout: "layout element",
  markup: "static text with unusual markup",
  "page-css":
    "in the file; the page's own stylesheet decides this property, so a utility class has no effect",
  responsive:
    "in the file; a screen-size variant class decides this property at the current width",
  root: "page root",
  "script-class": "in the file, but a script sets its classes after load",
  "script-reads": "in the file; a script reads it by id or data-* attribute",
  static: "static text in the file",
};

export const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
export const collapse = (s: string) => s.replaceAll(/\s+/g, " ").trim();

/** Source of an element, trimmed to its start tag, some text, and end tag. */
function snippet(A: Analysis, entry: PageSourceEntry, max = 360) {
  const { endOffset: b, startOffset: a } = entry.loc;
  const full = A.src.slice(a, b);
  if (full.length <= max) {
    return full;
  }
  const open = A.src.slice(a, entry.loc.startTag.endOffset);
  const close = entry.loc.endTag
    ? A.src.slice(entry.loc.endTag.startOffset, b)
    : "";
  return `${clip(open, max - 60)}${clip(collapse(A.src.slice(entry.loc.startTag.endOffset, entry.loc.endTag?.startOffset ?? b)), 60)}${close}`;
}

const lineOf = (A: Analysis, off: number) => A.lineCol(off).line;
const lineText = (A: Analysis, off: number) => {
  const s = A.src.lastIndexOf("\n", off) + 1;
  const e = A.src.indexOf("\n", off);
  const line = A.src.slice(s, e === -1 ? undefined : e);
  const col = off - s;
  return collapse(
    line.length > 140
      ? `…${line.slice(Math.max(0, col - 50), col + 80)}…`
      : line,
  );
};

/** The text a person sees in an element, or its text content where layout gives none. */
const visibleText = (el: Element) =>
  // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- the rendered text, without hidden parts, is what the person saw.
  el instanceof HTMLElement ? el.innerText : el.textContent;

/**
 * One request's payload. `verdict` is why the element is the agent's (or what
 * it is, when it is not). `edit` is set when this is a queued text edit, and
 * `change` when it is a style or structure change the editor could not make.
 */
export function buildRequest({
  A,
  change,
  edit,
  el,
  instruction,
  path,
  verdict,
}: {
  A: Analysis;
  change: null | string;
  edit: null | TextEdit;
  el: Element;
  instruction: string;
  path: string;
  verdict: AskVerdict;
}): RequestPayload {
  const doc = el.ownerDocument;
  const reason = verdict.ok ? verdict.status : verdict.reason;
  const inFile = reason !== "generated";
  const anchor =
    inFile && verdict.entry
      ? { el, entry: verdict.entry }
      : staticAncestor(A, el);
  const lines: string[] = [];
  if (anchor) {
    const a = A.lineCol(anchor.entry.loc.startOffset);
    const b = A.lineCol(anchor.entry.loc.endOffset);
    lines.push(
      `${inFile ? "Where" : "Nearest source element"}: ${path} ${a.line}:${a.col}–${b.line}:${b.col} <${anchor.entry.tag}>`,
    );
  } else {
    lines.push(`Where: ${path}, no source element found`);
  }
  lines.push(`Status: ${STATUS[reason] ?? reason}`);
  if (anchor) {
    lines.push(
      "Source:",
      ...snippet(A, anchor.entry)
        .split("\n")
        .map((l) => `  ${l}`),
    );
  }
  const fed = fedBy(A, el, inFile ? (verdict.entry ?? null) : null);
  if (fed.length > 0) {
    lines.push(
      inFile ? "Also appears at:" : "Fed by (best guess):",
      ...fed.map((f) => `  ${f}`),
    );
  }
  lines.push(`Live text: "${clip(collapse(visibleText(el)), 160)}"`);
  let selector = "";
  try {
    selector = finder(el, {
      attr: (n) =>
        n !== "data-src-id" && n.startsWith("data-") && n !== "data-state",
      root: doc.body,
      seedMinLength: 2,
    });
  } catch {
    selector = el.tagName.toLowerCase();
  }
  lines.push(`Selector: ${selector}`);
  if (edit) {
    lines.push(
      `Text edit: "${clip(edit.from, 200)}" → "${clip(edit.to, 200)}"`,
    );
  }
  if (change) {
    lines.push(`Attempted change: ${change}`);
  }
  lines.push(`Instruction: ${instruction}`);
  return {
    anchorSnippet: anchor
      ? A.src.slice(anchor.entry.loc.startOffset, anchor.entry.loc.endOffset)
      : "",
    anchorStart: anchor?.entry.loc.startOffset ?? -1,
    displayText: collapse(visibleText(el)),
    endLine: anchor
      ? A.lineCol(
          Math.max(
            anchor.entry.loc.startOffset,
            anchor.entry.loc.endOffset - 1,
          ),
        ).line
      : null,
    generated: !inFile,
    label: verdict.ok ? verdict.label : REASONS[verdict.reason],
    line: anchor ? A.lineCol(anchor.entry.loc.startOffset).line : null,
    liveText: collapse(el.textContent),
    selector,
    text: lines.join("\n"),
  };
}

/** Best-effort list of script and data lines that hold or render this element's text. */
function fedBy(A: Analysis, el: Element, entry: null | PageSourceEntry) {
  const hits = new Map<number, string>();
  const add = (at: number, label: string) => {
    const line = lineOf(A, at);
    if (!hits.has(line) && hits.size < 6) {
      hits.set(line, `line ${line} (${label}): ${lineText(A, at)}`);
    }
  };
  const texts = new Set<string>();
  texts.add(collapse(el.textContent));
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const data = collapse(n.textContent ?? "");
    if (data.length >= 3) {
      texts.add(data);
    }
  }
  const skip: null | Range = entry
    ? { end: entry.loc.endOffset, start: entry.loc.startOffset }
    : null;
  for (const t of texts) {
    if (t.length > 120) {
      continue;
    }
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
  for (
    let cur: Element | null = el;
    cur && hits.size < 6;
    cur = cur.parentElement
  ) {
    if (!cur.id) {
      continue;
    }
    const re = new RegExp(`["'\`#]${escapeRegExp(cur.id)}["'\`\\s)]`);
    for (const s of A.scripts) {
      const m = re.exec(s.text);
      if (m) {
        add(s.start + m.index, `script uses #${cur.id}`);
      }
    }
    break;
  }
  return [...hits.values()];
}
