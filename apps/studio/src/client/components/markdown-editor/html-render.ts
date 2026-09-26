// Raw HTML in the file, drawn the way Studio's static renderer draws it:
// parsed, then sanitized to GitHub's allow-list (rehype-sanitize's default
// schema, with the same additions Studio makes: `data:` image sources, `file:`
// links, and no `<picture>`/`<source>`). Rendering is display only; the node
// keeps its source verbatim, so an untouched block saves byte-identical.
//
// - renderHtml: the sanitized DOM for one HTML value, or null when nothing
//   visible survives (a lone tag, a comment, a stripped element).
// - htmlStructurePlugin: the structure CommonMark splits apart. A block that
//   opens an element without closing it (`<details>`, `<div align="center">`)
//   and the later block that closes it make a container, and the Markdown
//   blocks between are its body: framed, aligned, and for `<details>`
//   collapsible. Inline, an opening tag and its closing tag in one paragraph
//   (`<kbd>`, `<sub>`) wrap the text between them in that element.
// - createHtmlView: the node view over one `html` node, reading its role in
//   that structure from the plugin's node decorations.
// - A source popover: clicking a rendered node (or its "HTML" tab) edits that
//   node's source, and only that node's.
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { type Node as PMNode } from "@milkdown/kit/prose/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type Decoration as DecorationType,
  type EditorView,
  type NodeView,
} from "@milkdown/kit/prose/view";
import { fromHtml } from "hast-util-from-html";
import { defaultSchema, sanitize } from "hast-util-sanitize";
import { toDom } from "hast-util-to-dom";

import { childrenOf } from "./doc-sync";
import { icon } from "./icons";

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) {
    e.className = cls;
  }
  if (text !== undefined) {
    e.textContent = text;
  }
  return e;
};

// ---------------------------------------------------------------- sanitize

const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
    src: [...(defaultSchema.protocols?.src ?? []), "data"],
  },
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => t !== "picture" && t !== "source",
  ),
};
const allowedTags = new Set(schema.tagNames);
const VISIBLE_LEAVES = new Set(["br", "hr", "img", "input"]);

type HastChild = HastRoot["children"][number];
type HastRoot = ReturnType<typeof fromHtml>;

const visible = (n: HastChild): boolean =>
  n.type === "text"
    ? /\S/.test(n.value)
    : n.type === "element" &&
      (VISIBLE_LEAVES.has(n.tagName) || n.children.some(visible));

/** The sanitized hast of an HTML value (fragment root), or null if it cannot be parsed. */
export function sanitizedTree(
  value: string,
  resolveSrc: (src: string) => string,
): HastRoot | null {
  try {
    // `sanitize` returns the root it was given, sanitized.
    const tree = sanitize(
      fromHtml(value, { fragment: true }),
      schema,
    ) as HastRoot;
    const fix = (n: HastChild | HastRoot) => {
      if (
        n.type === "element" &&
        n.tagName === "img" &&
        typeof n.properties.src === "string"
      ) {
        n.properties.src = resolveSrc(n.properties.src);
      }
      if ("children" in n) {
        n.children.forEach(fix);
      }
    };
    fix(tree);
    return tree;
  } catch (error) {
    console.warn("HTML did not render:", error);
    return null;
  }
}

const domOf = (children: HastChild[]) =>
  toDom({ children, type: "root" }, { fragment: true });

/** Sanitized DOM for an HTML value, or null when nothing visible survives. */
export function renderHtml(
  value: string,
  resolveSrc: (src: string) => string,
): Node | null {
  const tree = sanitizedTree(value, resolveSrc);
  if (!tree?.children.some(visible)) {
    return null;
  }
  return domOf(tree.children);
}

// ---------------------------------------------------------------- tag structure

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const TAG =
  /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
interface Balance {
  closes: string[];
  opens: { attrs: string; tag: string }[];
}
const balanceCache = new Map<string, Balance>();

/**
 * What one HTML value leaves open and closes: `closes` are closing tags with
 * no opening tag in the value (they close an element an earlier block
 * opened), `opens` the elements still open at its end, outermost first.
 */
function balance(value: string): Balance {
  const cached = balanceCache.get(value);
  if (cached) {
    return cached;
  }
  const closes: string[] = [];
  const opens: Balance["opens"] = [];
  for (const m of value.matchAll(TAG)) {
    const name = m[2];
    if (!name) {
      continue;
    }
    const tag = name.toLowerCase();
    const attrs = m[3] ?? "";
    if (VOID.has(tag) || /\/\s*$/.test(attrs)) {
      continue;
    }
    if (m[1]) {
      const i = opens.findLastIndex((s) => s.tag === tag);
      if (i !== -1) {
        opens.length = i;
      } else if (opens.length === 0) {
        closes.push(tag);
      }
    } else {
      opens.push({ attrs, tag });
    }
  }
  const b = { closes, opens };
  if (balanceCache.size > 5000) {
    balanceCache.clear();
  }
  balanceCache.set(value, b);
  return b;
}

const attr = (attrs: string, name: string) =>
  new RegExp(
    String.raw`(?:^|\s)${name}(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?(?=\s|/|$)`,
    "i",
  ).exec(attrs);
const attrValue = (m: null | RegExpExecArray) =>
  m?.[1] ?? m?.[2] ?? m?.[3] ?? "";
const alignOf = (attrs: string) => {
  const v = attrValue(attr(attrs, "align")).toLowerCase();
  return ["center", "justify", "right"].includes(v) ? v : "";
};

/** A top-level paragraph holding nothing but one HTML node: a CommonMark HTML block. */
const htmlOnly = (n: PMNode): null | string =>
  n.type.name === "paragraph" &&
  n.childCount === 1 &&
  n.firstChild?.type.name === "html"
    ? String(n.firstChild.attrs.value)
    : null;

// Inline elements an opening and a closing tag in one paragraph may wrap text in.
const INLINE = new Set(
  [
    "a",
    "b",
    "code",
    "del",
    "em",
    "i",
    "ins",
    "kbd",
    "q",
    "s",
    "samp",
    "span",
    "strike",
    "strong",
    "sub",
    "sup",
    "tt",
    "var",
  ].filter((t) => allowedTags.has(t)),
);
const LONE_OPEN = /^<([a-z][\w-]*)(\s[^<>]*)?>$/i;
const LONE_CLOSE = /^<\/([a-z][\w-]*)\s*>$/i;

interface Span {
  attrs: string;
  end: number;
  expanded?: boolean;
  openPos?: number;
  start: number;
  tag: string;
}

interface StructureState {
  decos: DecorationSet;
  hidden: { from: number; openPos: number; to: number }[];
  toggled: Set<number>;
}

export const htmlStructureKey = new PluginKey<StructureState>("html-structure");

interface HtmlRoleSpec {
  htmlExpanded?: boolean | null;
  htmlRole: string;
  htmlTag: string;
}

/**
 * Containers across top-level blocks and tag pairs inside paragraphs, as
 * decorations. State: `toggled`, the positions of `<details>` openers opened
 * or closed against their default; `hidden`, the ranges a collapsed
 * `<details>` hides (a selection landing in one opens it).
 */
export function htmlStructurePlugin() {
  const build = (doc: PMNode, toggled: Set<number>) => {
    const decos: DecorationType[] = [];
    const hidden: StructureState["hidden"] = [];
    const kids: { n: PMNode; pos: number; value: null | string }[] = [];
    for (const { node: n, offset: pos } of childrenOf(doc))
      kids.push({ n, pos, value: htmlOnly(n) });

    // Containers: a stack of open elements carried across HTML blocks.
    const stack: { attrs: string; start: number; tag: string }[] = [];
    const spans: Span[] = [];
    for (const [i, k] of kids.entries()) {
      if (k.value === null) {
        continue;
      }
      const { closes, opens } = balance(k.value);
      for (const tag of closes) {
        const j = stack.findLastIndex((s) => s.tag === tag);
        const opened = stack[j];
        if (j === -1 || !opened) {
          continue;
        }
        spans.push({ ...opened, end: i });
        // Elements opened inside it and never closed are not containers.
        stack.length = j;
      }
      for (const o of opens) {
        stack.push({ attrs: o.attrs, start: i, tag: o.tag });
      }
    }
    spans.sort((a, b) => a.start - b.start || b.end - a.end);

    const roles = kids.map(() => ({
      align: "",
      close: null as null | Span,
      depth: 0,
      hide: false,
      open: null as null | Span,
    }));
    for (const s of spans) {
      const opener = kids[s.start];
      const closer = kids[s.end];
      const r = roles[s.start];
      const rc = roles[s.end];
      if (!opener || !closer || !r || !rc) {
        continue;
      }
      const openPos = opener.pos;
      if (s.tag === "details") {
        const dflt = attr(s.attrs, "open") !== null;
        s.expanded = toggled.has(openPos) ? !dflt : dflt;
        s.openPos = openPos;
      }
      // The innermost opened element names the block's role; a <details> wins.
      if (!r.open || s.tag === "details" || r.open.tag !== "details") {
        r.open = s;
      }
      rc.close ??= s;
      for (let j = s.start + 1; j < s.end; j++) {
        const rj = roles[j];
        if (!rj) {
          continue;
        }
        rj.depth++;
        const a = alignOf(s.attrs);
        if (a) {
          rj.align = a;
        }
        if (s.expanded === false) {
          rj.hide = true;
        }
      }
      if (s.expanded === false) {
        rc.hide = true;
        hidden.push({
          from: opener.pos + opener.n.nodeSize,
          openPos,
          to: closer.pos + closer.n.nodeSize,
        });
      }
    }
    for (const [i, k] of kids.entries()) {
      const r = roles[i];
      if (!r) {
        continue;
      }
      const cls: string[] = [];
      if (r.depth) {
        cls.push("md-html-inner");
      }
      if (r.open) {
        cls.push("md-html-open");
      }
      if (r.close) {
        cls.push("md-html-close");
      }
      if (r.hide) {
        cls.push("md-html-hidden");
      }
      if (cls.length > 0) {
        const style = `--html-depth: ${r.depth};${r.align ? ` text-align: ${r.align};` : ""}`;
        decos.push(
          Decoration.node(k.pos, k.pos + k.n.nodeSize, {
            class: cls.join(" "),
            style,
          }),
        );
      }
      const role = r.open ?? r.close;
      if (k.value !== null && role) {
        const spec: HtmlRoleSpec = {
          htmlExpanded: r.open?.expanded ?? null,
          htmlRole: r.open ? "open" : "close",
          htmlTag: role.tag,
        };
        decos.push(Decoration.node(k.pos + 1, k.pos + 2, {}, spec));
      }
    }

    // Tag pairs inside one paragraph.
    doc.descendants((node, pos) => {
      if (!node.isTextblock) {
        return true;
      }
      if (node.childCount < 3) {
        return false;
      }
      const items: { at: number; c: PMNode }[] = [];
      for (const { node: c, offset: off } of childrenOf(node))
        items.push({ at: pos + 1 + off, c });
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const v =
          item?.c.type.name === "html" ? String(item.c.attrs.value) : null;
        const m = v ? LONE_OPEN.exec(v) : null;
        const tag = m?.[1]?.toLowerCase();
        if (!item || !m || !tag) {
          continue;
        }
        let depth = 0;
        let close = -1;
        for (let j = i + 1; j < items.length && close < 0; j++) {
          const other = items[j];
          if (other?.c.type.name !== "html") {
            continue;
          }
          const w = String(other.c.attrs.value);
          if (LONE_OPEN.exec(w)?.[1]?.toLowerCase() === tag) {
            depth++;
          } else if (LONE_CLOSE.exec(w)?.[1]?.toLowerCase() === tag) {
            if (depth) {
              depth--;
            } else {
              close = j;
            }
          }
        }
        const closer = items[close];
        if (!closer) {
          continue;
        }
        const from = item.at;
        const to = closer.at;
        decos.push(
          Decoration.node(from, from + 1, {}, {
            htmlRole: "pair-open",
            htmlTag: tag,
          } satisfies HtmlRoleSpec),
          Decoration.node(to, to + 1, {}, {
            htmlRole: "pair-close",
            htmlTag: tag,
          } satisfies HtmlRoleSpec),
        );
        // A tag the allow-list strips (Studio drops it and keeps the text) wraps nothing.
        if (to > from + 1 && INLINE.has(tag)) {
          const a: Record<string, string> = {
            class: `md-html-el md-html-el-${tag}`,
            nodeName: tag === "a" ? "span" : tag,
          };
          const title = attr(m[2] ?? "", "title");
          if (title) {
            a.title = attrValue(title);
          }
          decos.push(Decoration.inline(from + 1, to, a));
        }
      }
      return false;
    });
    return { decos: DecorationSet.create(doc, decos), hidden };
  };

  return new Plugin<StructureState>({
    appendTransaction(trs, _, st) {
      if (
        !trs.some(
          (tr) =>
            (tr.getMeta(htmlStructureKey) as undefined | { toggle?: number })
              ?.toggle !== undefined,
        )
      ) {
        return null;
      }
      const { from } = st.selection;
      const h = htmlStructureKey
        .getState(st)
        ?.hidden.find((r) => from > r.from && from < r.to);
      return h
        ? st.tr.setSelection(TextSelection.near(st.doc.resolve(h.from - 1), -1))
        : null;
    },
    key: htmlStructureKey,
    props: {
      decorations: (st: EditorState) => htmlStructureKey.getState(st)?.decos,
    },
    state: {
      apply(tr, old, _, st) {
        const meta = tr.getMeta(htmlStructureKey) as
          | undefined
          | { toggle?: number };
        if (!tr.docChanged && !meta && !tr.selectionSet) {
          return old;
        }
        let toggled = old.toggled;
        if (tr.docChanged) {
          toggled = new Set([...toggled].map((p) => tr.mapping.map(p, 1)));
        }
        if (meta?.toggle !== undefined) {
          toggled = new Set(toggled);
          if (toggled.has(meta.toggle)) {
            toggled.delete(meta.toggle);
          } else {
            toggled.add(meta.toggle);
          }
        }
        let next: StructureState =
          tr.docChanged || meta ? { toggled, ...build(st.doc, toggled) } : old;
        // A selection inside a collapsed <details> (a jump, a search, an arrow
        // key) opens it rather than leaving the caret out of sight.
        const { from } = st.selection;
        const h =
          meta?.toggle === undefined &&
          next.hidden.find((r) => from > r.from && from < r.to);
        if (h) {
          toggled = new Set(next.toggled);
          if (toggled.has(h.openPos)) {
            toggled.delete(h.openPos);
          } else {
            toggled.add(h.openPos);
          }
          next = { toggled, ...build(st.doc, toggled) };
        }
        return next;
      },
      init: (_, st) => ({ toggled: new Set(), ...build(st.doc, new Set()) }),
    },
  });
}

// ---------------------------------------------------------------- source popover

let popover: null | {
  box: HTMLElement;
  outside: (e: MouseEvent) => void;
} = null;

interface Role {
  expanded: boolean | null;
  role: string;
  tag: string;
}

export function closeSourcePopover() {
  if (!popover) {
    return;
  }
  document.removeEventListener("mousedown", popover.outside, true);
  popover.box.remove();
  popover = null;
}

// ---------------------------------------------------------------- node view

/** Edit one node's source in a popover under `anchor`; `save(next)` writes it. */
export function openSourcePopover(
  anchor: HTMLElement,
  value: string,
  save: (next: string) => void,
  { title = "HTML" }: { title?: string } = {},
) {
  closeSourcePopover();
  const box = el("div", "md-html-popover");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", `Edit ${title}`);
  const head = el("div", "md-html-popover-head");
  head.append(
    el("span", "md-html-popover-title", title),
    el("span", "md-html-popover-hint", "⌘↩ to save · Esc to cancel"),
  );
  const area = el("textarea");
  area.spellcheck = false;
  area.value = value;
  area.setAttribute("aria-label", `${title} source`);
  const foot = el("div", "md-html-popover-foot");
  const cancel = el("button", "md-html-btn", "Cancel");
  const ok = el("button", "md-html-btn md-html-btn-primary", "Save");
  cancel.type = "button";
  ok.type = "button";
  foot.append(cancel, ok);
  box.append(head, area, foot);
  document.body.append(box);
  const fit = () => {
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight + 2, window.innerHeight * 0.5)}px`;
  };
  fit();
  void computePosition(anchor, box, {
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    placement: "bottom-start",
    strategy: "fixed",
  }).then(({ x, y }) => {
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
  });
  const commit = () => {
    const next = area.value;
    closeSourcePopover();
    if (next !== value) {
      save(next);
    }
  };
  const outside = (e: MouseEvent) => {
    if (!(e.target instanceof Node) || !box.contains(e.target)) {
      commit();
    }
  };
  area.addEventListener("input", fit);
  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSourcePopover();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  });
  cancel.addEventListener("click", closeSourcePopover);
  ok.addEventListener("click", commit);
  setTimeout(() => {
    document.addEventListener("mousedown", outside, true);
  });
  popover = { box, outside };
  area.focus();
}
const roleOf = (decorations: readonly DecorationType[]): Role => {
  const d = decorations.find(
    (x) => (x.spec as Partial<HtmlRoleSpec>).htmlRole !== undefined,
  );
  const spec = d?.spec as HtmlRoleSpec | undefined;
  return spec
    ? {
        expanded: spec.htmlExpanded ?? null,
        role: spec.htmlRole,
        tag: spec.htmlTag,
      }
    : { expanded: null, role: "", tag: "" };
};
const roleKey = (r: Role) => `${r.role}|${r.tag}|${String(r.expanded)}`;

const caret = icon("caretRight", 12);

/**
 * The view over one `html` node. A paragraph holding only this node is an
 * HTML block, drawn as block content; anything else is inline. Where nothing
 * visible renders (or rendering fails), it shows its source: an editable box
 * for a block, a chip inline.
 */
export function createHtmlView({
  decorations,
  getPos,
  node: initial,
  resolveSrc,
  view: pmView,
}: {
  decorations: readonly DecorationType[];
  getPos: () => number | undefined;
  node: PMNode;
  resolveSrc: (src: string) => string;
  view: EditorView;
}): NodeView {
  let node = initial;
  let role = roleOf(decorations);
  const pos0 = getPos();
  const parent =
    pos0 === undefined ? null : pmView.state.doc.resolve(pos0).parent;
  const isBlock = parent?.type.name === "paragraph" && parent.childCount === 1;
  const dom = el("span", isBlock ? "md-html-block" : "md-html-span");
  dom.contentEditable = "false";
  // The inline source box, when a block falls back to its source.
  let area: HTMLTextAreaElement | null = null;
  const valueOf = (n: PMNode) => String(n.attrs.value);

  const write = (value: string) => {
    const pos = getPos();
    if (pos === undefined) {
      return;
    }
    pmView.dispatch(
      pmView.state.tr.setNodeMarkup(pos, null, { ...node.attrs, value }),
    );
  };
  const edit = () => {
    openSourcePopover(dom, valueOf(node), write);
  };
  const toggle = () => {
    const pos = getPos();
    if (pos !== undefined) {
      pmView.dispatch(
        pmView.state.tr.setMeta(htmlStructureKey, { toggle: pos - 1 }),
      );
    }
  };
  const editTab = () => {
    const b = el("button", "md-html-edit", "HTML");
    b.type = "button";
    b.title = "Edit the HTML source";
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      edit();
    });
    return b;
  };

  const sourceBox = () => {
    dom.className = "md-html-block md-html-source";
    const label = el("span", "md-html-label");
    const tag = /^\s*<\/?([a-z][\w-]*)/i
      .exec(valueOf(node))?.[1]
      ?.toLowerCase();
    label.textContent = tag ? `HTML · ${tag}` : "HTML";
    const box = el("textarea");
    box.spellcheck = false;
    box.value = valueOf(node);
    box.rows = 1;
    box.setAttribute("aria-label", "Raw HTML");
    const fit = () => {
      box.style.height = "auto";
      box.style.height = `${box.scrollHeight}px`;
    };
    box.addEventListener("input", () => {
      fit();
      if (box.value !== valueOf(node)) {
        write(box.value);
      }
    });
    dom.append(label, box);
    area = box;
    requestAnimationFrame(fit);
  };

  const render = () => {
    dom.replaceChildren();
    area = null;
    const value = valueOf(node);
    if (!isBlock) {
      if (role.role === "pair-open" || role.role === "pair-close") {
        dom.className = `md-html-mark md-html-mark-${role.role === "pair-open" ? "open" : "close"}`;
        dom.title = `${value} (click to edit)`;
        return;
      }
      const frag = renderHtml(value, resolveSrc);
      dom.title = "";
      if (!frag) {
        dom.className = "md-html-inline";
        dom.textContent = value;
        return;
      }
      dom.className = "md-html-span md-html-rendered";
      dom.title = "Click to edit the HTML";
      dom.append(frag);
      return;
    }

    if (role.role === "open" && role.tag === "details") {
      // The opening of a <details> whose body is the Markdown blocks that follow.
      dom.className = `md-html-block md-html-details${role.expanded ? " is-open" : ""}`;
      const tree = sanitizedTree(value, resolveSrc);
      const det = tree?.children.find(
        (c) => c.type === "element" && c.tagName === "details",
      );
      const detChildren = det?.type === "element" ? det.children : [];
      const sum = detChildren.find(
        (c) => c.type === "element" && c.tagName === "summary",
      );
      const row = el("span", "md-html-summary");
      row.setAttribute("role", "button");
      row.setAttribute("aria-expanded", String(role.expanded === true));
      const icon = el("span", "md-html-caret");
      icon.innerHTML = caret;
      const text = el("span", "md-html-summary-text");
      if (sum?.type === "element" && sum.children.some(visible)) {
        text.append(domOf(sum.children));
      } else {
        text.textContent = "Details";
      }
      row.append(icon, text);
      dom.append(row);
      const rest = detChildren.filter((c) => c !== sum);
      if (role.expanded && rest.some(visible)) {
        const body = el("span", "md-html-details-body md-html-rendered");
        body.append(domOf(rest));
        dom.append(body);
      }
      dom.append(editTab());
      return;
    }

    const frag = renderHtml(value, resolveSrc);
    if (frag) {
      dom.className = `md-html-block md-html-rendered${role.role ? ` md-html-${role.role}-rendered` : ""}`;
      const body = el("span", "md-html-body");
      body.append(frag);
      dom.append(body, editTab());
      return;
    }
    if (role.role) {
      // A bare opening or closing tag of a container: the frame's lid or base.
      dom.className = `md-html-block md-html-${role.role}-tag`;
      const cls =
        role.role === "open"
          ? /\bclass\s*=\s*["']?([\w-]+)/i.exec(
              balance(value).opens.at(-1)?.attrs ?? "",
            )?.[1]
          : "";
      dom.append(
        el(
          "span",
          "md-html-tagname",
          role.role === "open"
            ? `${role.tag}${cls ? `.${cls}` : ""}`
            : `/${role.tag}`,
        ),
        editTab(),
      );
      return;
    }
    sourceBox();
  };
  render();

  const targetOf = (e: Event) =>
    e.target instanceof Element ? e.target : null;
  dom.addEventListener("mousedown", (e) => {
    const t = targetOf(e);
    if (e.target === area || e.button !== 0 || t?.closest(".md-html-edit")) {
      return;
    }
    e.preventDefault();
  });
  dom.addEventListener("click", (e) => {
    const t = targetOf(e);
    if (e.target === area || e.button !== 0 || t?.closest(".md-html-edit")) {
      return;
    }
    e.preventDefault();
    if (t?.closest(".md-html-summary")) {
      toggle();
      return;
    }
    // A <details> drawn whole inside one node toggles natively.
    const details = t?.closest("summary") ? t.closest("details") : null;
    if (details) {
      details.open = !details.open;
      return;
    }
    edit();
  });

  return {
    dom,
    ignoreMutation: () => true,
    stopEvent: (e) =>
      e.target === area ||
      /^(?:click|dblclick|mousedown|mouseup)$/.test(e.type),
    update(n, decos) {
      if (n.type !== node.type) {
        return false;
      }
      const r = roleOf(decos);
      if (valueOf(n) === valueOf(node) && roleKey(r) === roleKey(role)) {
        node = n;
        return true;
      }
      node = n;
      role = r;
      if (area && !role.role && renderHtml(valueOf(n), resolveSrc) === null) {
        // Typing in the source box: keep the box (and its caret).
        if (area.value !== valueOf(n)) {
          area.value = valueOf(n);
        }
        return true;
      }
      render();
      return true;
    },
  };
}
