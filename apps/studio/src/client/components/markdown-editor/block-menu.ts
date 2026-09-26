// Block menu: "Turn into", Duplicate, Delete and friends, opened by clicking
// the drag handle (a drag still drags) or by right-clicking a block.
//
// The target is the block the handle belongs to: Crepe's handle selects it as
// a node on mousedown, so the click reads `view.state.selection`. A right-click
// targets the list item, or else the top-level block, under the pointer.
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import {
  Fragment,
  type Node as PMNode,
  type Schema,
} from "@milkdown/kit/prose/model";
import {
  type EditorState,
  NodeSelection,
  TextSelection,
} from "@milkdown/kit/prose/state";
import { type EditorView } from "@milkdown/kit/prose/view";

import { childrenOf } from "./doc-sync";
import { icon } from "./icons";

const I = {
  bullet: icon("listBullets"),
  check: icon("check"),
  chevron: icon("caretRight", 12),
  code: icon("code"),
  copy: icon("copy"),
  duplicate: icon("copy"),
  h1: icon("textHOne"),
  h2: icon("textHTwo"),
  h3: icon("textHThree"),
  ordered: icon("listNumbers"),
  quote: icon("quotes"),
  task: icon("listChecks"),
  text: icon("textT"),
  trash: icon("trash"),
  turn: icon("swap"),
};

type Kind =
  | "bullet"
  | "code"
  | "h1"
  | "h2"
  | "h3"
  | "ordered"
  | "quote"
  | "task"
  | "text";

const KINDS: { icon: string; key: Kind; label: string }[] = [
  { icon: I.text, key: "text", label: "Text" },
  { icon: I.h1, key: "h1", label: "Heading 1" },
  { icon: I.h2, key: "h2", label: "Heading 2" },
  { icon: I.h3, key: "h3", label: "Heading 3" },
  { icon: I.bullet, key: "bullet", label: "Bulleted list" },
  { icon: I.ordered, key: "ordered", label: "Numbered list" },
  { icon: I.task, key: "task", label: "To-do list" },
  { icon: I.quote, key: "quote", label: "Quote" },
  { icon: I.code, key: "code", label: "Code" },
];
const LIST_KINDS: readonly Kind[] = ["bullet", "ordered", "task"];

/** What a block is, in "Turn into" terms. */
function kindOf(node: PMNode, parent: null | PMNode): Kind | null {
  const n = node.type.name;
  if (n === "paragraph") {
    return "text";
  }
  if (n === "heading") {
    const level = Number(node.attrs.level);
    return level === 1 ? "h1" : level === 2 ? "h2" : level === 3 ? "h3" : null;
  }
  if (n === "blockquote") {
    return "quote";
  }
  if (n === "code_block") {
    return "code";
  }
  if (n === "list_item") {
    if (node.attrs.checked !== null && node.attrs.checked !== undefined) {
      return "task";
    }
    return parent?.type.name === "ordered_list" ? "ordered" : "bullet";
  }
  if (n === "bullet_list") {
    const checked: unknown = node.firstChild?.attrs.checked;
    return checked !== null && checked !== undefined ? "task" : "bullet";
  }
  if (n === "ordered_list") {
    return "ordered";
  }
  return null;
}

/** Inline content of each line of a block: one per textblock inside it, code split by line. */
function linesOf(node: PMNode, schema: Schema): Fragment[] {
  const out: Fragment[] = [];
  const visit = (n: PMNode) => {
    if (n.type.name === "code_block") {
      for (const line of n.textContent.split("\n")) {
        out.push(line ? Fragment.from(schema.text(line)) : Fragment.empty);
      }
    } else if (n.isTextblock) {
      out.push(n.content);
    } else {
      for (const { node: child } of childrenOf(n)) {
        visit(child);
      }
    }
  };
  visit(node);
  return out.length > 0 ? out : [Fragment.empty];
}

// Headings and paragraphs hold the same inline content; drop hard breaks from headings.
const inlineOnly = (frag: Fragment, schema: Schema) => {
  const nodes: PMNode[] = [];
  for (const { node: n } of childrenOf(frag))
    nodes.push(n.type.name === "hardbreak" ? schema.text(" ") : n);
  return Fragment.fromArray(nodes);
};

interface MenuElement extends HTMLDivElement {
  closeAll?: () => void;
  handleKey?: (e: { key: string }) => boolean;
  owner?: unknown;
}

interface MenuItem {
  checked?: boolean;
  children?: MenuItem[];
  danger?: boolean;
  heading?: string;
  hint?: string;
  icon?: string;
  key?: string;
  label?: string;
  run?: () => void;
  sep?: boolean;
}

// ---------------------------------------------------------------- operations

interface Target {
  node: PMNode;
  parent: null | PMNode;
  parentPos: null | number;
  pos: number;
}

function build(kind: Kind, lines: Fragment[], schema: Schema): PMNode[] {
  const paragraph = nodeType(schema, "paragraph");
  const para = (f: Fragment) => paragraph.create(null, f);
  switch (kind) {
    case "bullet":
    case "task": {
      return [
        nodeType(schema, "bullet_list").create(
          null,
          lines.map((f) =>
            nodeType(schema, "list_item").create(
              {
                checked: kind === "task" ? false : null,
                label: "•",
                listType: "bullet",
                spread: false,
              },
              para(f),
            ),
          ),
        ),
      ];
    }
    case "code": {
      const text = lines.map((f) => para(f).textContent).join("\n");
      return [
        nodeType(schema, "code_block").create(
          { language: "" },
          text ? schema.text(text) : null,
        ),
      ];
    }
    case "h1":
    case "h2":
    case "h3": {
      return lines.map((f) =>
        nodeType(schema, "heading").create(
          { level: Number(kind[1]) },
          inlineOnly(f, schema),
        ),
      );
    }
    case "ordered": {
      return [
        nodeType(schema, "ordered_list").create(
          null,
          lines.map((f, i) =>
            nodeType(schema, "list_item").create(
              { label: `${i + 1}.`, listType: "ordered", spread: false },
              para(f),
            ),
          ),
        ),
      ];
    }
    case "quote": {
      return [nodeType(schema, "blockquote").create(null, lines.map(para))];
    }
    case "text": {
      return lines.map(para);
    }
  }
}

function duplicate(view: EditorView, { node, pos }: Target) {
  const end = pos + node.nodeSize;
  const tr = view.state.tr.insert(end, node.copy(node.content));
  tr.setSelection(NodeSelection.create(tr.doc, end));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

function nodeType(schema: Schema, name: string) {
  const t = schema.nodes[name];
  if (!t) {
    throw new Error(`schema has no ${name}`);
  }
  return t;
}

function remove(view: EditorView, { node, parent, parentPos, pos }: Target) {
  let from = pos;
  let to = pos + node.nodeSize;
  // The last item of a list takes the list with it.
  if (
    node.type.name === "list_item" &&
    parent?.childCount === 1 &&
    parentPos !== null
  ) {
    from = parentPos;
    to = parentPos + parent.nodeSize;
  }
  const tr = view.state.tr.delete(from, to);
  tr.setSelection(
    TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))),
  );
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

function resolveTarget(state: EditorState, pos: number): null | Target {
  const node = state.doc.nodeAt(pos);
  if (!node) {
    return null;
  }
  const $pos = state.doc.resolve(pos);
  return {
    node,
    parent: $pos.parent,
    parentPos: $pos.depth ? $pos.before() : null,
    pos,
  };
}

// ---------------------------------------------------------------- menu UI

function tableRows(node: PMNode): string[][] {
  const rows: string[][] = [];
  for (const { node: row } of childrenOf(node)) {
    const cells: string[] = [];
    for (const { node: cell } of childrenOf(row)) cells.push(cell.textContent);
    rows.push(cells);
  }
  return rows;
}

function turnInto(view: EditorView, target: Target, kind: Kind) {
  const { state } = view;
  const schema = state.schema;
  let { node, pos } = target;
  const { parent, parentPos } = target;
  const isItem = node.type.name === "list_item";
  // A list item turned into another list kind changes its whole list.
  if (isItem && LIST_KINDS.includes(kind) && parent && parentPos !== null) {
    pos = parentPos;
    node = parent;
  }
  let nodes = build(kind, linesOf(node, schema), schema);
  // Keep a list's own items (with their nesting) when only the list type changes.
  if (
    LIST_KINDS.includes(kind) &&
    ["bullet_list", "ordered_list"].includes(node.type.name)
  ) {
    const items = childrenOf(node).map(({ index: i, node: item }) =>
      nodeType(schema, "list_item").create(
        {
          ...item.attrs,
          checked:
            kind === "task"
              ? ((item.attrs.checked as boolean | null) ?? false)
              : null,
          label: kind === "ordered" ? `${i + 1}.` : "•",
          listType: kind === "ordered" ? "ordered" : "bullet",
        },
        item.content,
      ),
    );
    nodes = [
      nodeType(
        schema,
        kind === "ordered" ? "ordered_list" : "bullet_list",
      ).create(kind === "ordered" ? { order: 1 } : null, items),
    ];
  }
  let tr = state.tr;
  if (isItem && !LIST_KINDS.includes(kind) && parent && parentPos !== null) {
    // Split the item out of its list: items before stay, items after form a new list.
    const before: PMNode[] = [];
    const after: PMNode[] = [];
    let seen = false;
    for (const { node: item, offset: off } of childrenOf(parent)) {
      if (parentPos + 1 + off === pos) {
        seen = true;
      } else {
        (seen ? after : before).push(item);
      }
    }
    const parts: PMNode[] = [];
    if (before.length > 0) {
      parts.push(parent.type.create(parent.attrs, before));
    }
    parts.push(...nodes);
    if (after.length > 0) {
      parts.push(parent.type.create(parent.attrs, after));
    }
    tr = tr.replaceWith(parentPos, parentPos + parent.nodeSize, parts);
    const at = parentPos + (before.length > 0 ? (parts[0]?.nodeSize ?? 0) : 0);
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  } else {
    tr = tr.replaceWith(pos, pos + node.nodeSize, nodes);
    tr.setSelection(
      TextSelection.near(
        tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size)),
      ),
    );
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

let current: (() => void) | null = null;

type Anchor =
  | { getBoundingClientRect: () => DOMRect }
  | { x: number; y: number };

/** `serializeNode(node)` gives Markdown for a node (tables copy as Markdown). Returns a cleanup. */
export function installBlockMenu(
  view: EditorView,
  root: HTMLElement,
  { serializeNode }: { serializeNode: (node: PMNode) => string },
) {
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  function itemsFor(target: Target): MenuItem[] {
    const { node, parent } = target;
    const kind = kindOf(node, parent);
    const out: MenuItem[] = [];
    const fresh = () => resolveTarget(view.state, target.pos) ?? target;
    if (kind !== null || ["heading", "paragraph"].includes(node.type.name)) {
      out.push({
        children: KINDS.map((k) => ({
          checked: k.key === kind,
          icon: k.icon,
          key: k.key,
          label: k.label,
          run: () => {
            turnInto(view, fresh(), k.key);
          },
        })),
        icon: I.turn,
        key: "turn",
        label: "Turn into",
      });
    }
    if (node.type.name === "table") {
      out.push(
        {
          icon: I.copy,
          key: "copy-md",
          label: "Copy as Markdown",
          run: () => {
            copy(serializeNode(node).trim());
          },
        },
        {
          icon: I.copy,
          key: "copy-tsv",
          label: "Copy as TSV",
          run: () => {
            copy(
              tableRows(node)
                .map((r) =>
                  r.map((c) => c.replaceAll(/[\t\n]/g, " ")).join("\t"),
                )
                .join("\n"),
            );
          },
        },
      );
    }
    if (node.type.name === "code_block") {
      out.push({
        icon: I.copy,
        key: "copy-code",
        label: "Copy code",
        run: () => {
          copy(node.textContent);
        },
      });
    }
    if (out.length > 0) {
      out.push({ sep: true });
    }
    out.push(
      {
        icon: I.duplicate,
        key: "duplicate",
        label: "Duplicate",
        run: () => {
          duplicate(view, fresh());
        },
      },
      {
        danger: true,
        icon: I.trash,
        key: "delete",
        label: "Delete",
        run: () => {
          remove(view, fresh());
        },
      },
    );
    return out;
  }

  // Press and release on the handle's gripper (the second operation item)
  // without dragging. Not `click`: selecting the block on mousedown moves the
  // handle, so the release lands on another element and the click on an ancestor.
  let press: null | { rect: DOMRect; t: number; x: number; y: number } = null;
  const onPointerDown = (e: PointerEvent) => {
    const grip =
      e.target instanceof Element
        ? e.target.closest(".milkdown-block-handle .operation-item")
        : null;
    press =
      grip && grip !== grip.parentElement?.firstElementChild && e.button === 0
        ? {
            rect: grip.getBoundingClientRect(),
            t: Date.now(),
            x: e.clientX,
            y: e.clientY,
          }
        : null;
  };
  const onDragStart = () => {
    press = null;
  };
  const onPointerUp = (e: PointerEvent) => {
    const p = press;
    press = null;
    if (
      !p ||
      Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4 ||
      Date.now() - p.t > 800
    ) {
      return;
    }
    // The block service selects the block and refocuses the editor on release; let that land first.
    requestAnimationFrame(() => {
      const sel = view.state.selection;
      if (!(sel instanceof NodeSelection)) {
        return;
      }
      const target = resolveTarget(view.state, sel.from);
      if (target) {
        open(itemsFor(target), { getBoundingClientRect: () => p.rect });
      }
    });
  };
  // Right-click on a block. Inside a list, the item; otherwise the top-level block.
  const onContextMenu = (e: MouseEvent) => {
    if (
      e.target instanceof Element &&
      e.target.closest("input, textarea, .cm-editor, .md-fence")
    ) {
      return;
    }
    const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!hit) {
      return;
    }
    const $pos = view.state.doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos);
    let pos: null | number = null;
    for (let d = $pos.depth; d >= 1; d--) {
      const name = $pos.node(d).type.name;
      if (name === "list_item" || name === "table") {
        pos = $pos.before(d);
        break;
      }
    }
    if (pos === null) {
      if ($pos.depth >= 1) {
        pos = $pos.before(1);
      } else if (hit.inside >= 0) {
        pos = hit.inside;
      } else {
        return;
      }
    }
    const target = resolveTarget(view.state, pos);
    if (!target) {
      return;
    }
    e.preventDefault();
    view.dispatch(
      view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
    );
    open(itemsFor(target), { x: e.clientX, y: e.clientY });
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("pointerup", onPointerUp, true);
  root.addEventListener("contextmenu", onContextMenu);
  return () => {
    current?.();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("dragstart", onDragStart, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    root.removeEventListener("contextmenu", onContextMenu);
  };
}

function menuEl(items: MenuItem[], { onClose }: { onClose: () => void }) {
  const menu: MenuElement = document.createElement("div");
  menu.className = "md-popover md-menu";
  menu.setAttribute("role", "menu");
  menu.tabIndex = -1;
  const rows: { el: HTMLElement; item: MenuItem }[] = [];
  let active = -1;
  let sub: MenuElement | null = null;
  const setActive = (i: number) => {
    active = i;
    for (const [k, r] of rows.entries())
      r.el.classList.toggle("is-active", k === i);
  };
  const closeSub = () => {
    sub?.remove();
    sub = null;
  };
  const openSub = (row: { el: HTMLElement; item: MenuItem }): MenuElement => {
    if (sub?.owner === row) {
      return sub;
    }
    closeSub();
    const next = menuEl(row.item.children ?? [], { onClose });
    next.owner = row;
    next.classList.add("is-sub");
    document.body.append(next);
    sub = next;
    void computePosition(row.el, next, {
      middleware: [
        offset({ crossAxis: -5, mainAxis: 4 }),
        flip(),
        shift({ padding: 8 }),
      ],
      placement: "right-start",
      strategy: "fixed",
    }).then(({ x, y }) =>
      Object.assign(next.style, { left: `${x}px`, top: `${y}px` }),
    );
    return next;
  };
  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement("div");
      sep.className = "md-menu-sep";
      menu.append(sep);
      continue;
    }
    if (item.heading) {
      const heading = document.createElement("div");
      heading.className = "md-menu-heading";
      heading.textContent = item.heading;
      menu.append(heading);
      continue;
    }
    const el = document.createElement("div");
    el.className = "md-menu-item";
    el.setAttribute("role", "menuitem");
    el.dataset.key = item.key ?? item.label ?? "";
    const trail = item.children
      ? `<span class="md-menu-trail">${I.chevron}</span>`
      : item.checked
        ? `<span class="md-menu-trail is-check">${I.check}</span>`
        : "";
    el.innerHTML = `<span class="md-menu-icon">${item.icon ?? ""}</span><span class="md-menu-label"></span>${trail}`;
    const label = el.querySelector(".md-menu-label");
    if (label) {
      label.textContent = item.label ?? "";
    }
    if (item.danger) {
      el.classList.add("is-danger");
    }
    const row = { el, item };
    const i = rows.length;
    rows.push(row);
    el.addEventListener("mouseenter", () => {
      setActive(i);
      if (item.children) {
        openSub(row);
      } else {
        closeSub();
      }
    });
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    el.addEventListener("click", () => {
      if (item.children) {
        openSub(row);
        return;
      }
      onClose();
      item.run?.();
    });
    menu.append(el);
  }
  menu.handleKey = (e) => {
    if (sub) {
      if (e.key === "ArrowLeft" || e.key === "Escape") {
        closeSub();
        return true;
      }
      return sub.handleKey?.(e) ?? false;
    }
    const at = rows[active];
    if (e.key === "ArrowDown") {
      setActive((active + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      setActive((active - 1 + rows.length) % rows.length);
    } else if (
      (e.key === "ArrowRight" || e.key === "Enter") &&
      at?.item.children
    ) {
      openSub(at).handleKey?.({ key: "ArrowDown" });
    } else if (e.key === "Enter" && at) {
      onClose();
      at.item.run?.();
    } else {
      return false;
    }
    return true;
  };
  menu.closeAll = () => {
    closeSub();
    menu.remove();
  };
  return menu;
}

// ---------------------------------------------------------------- wiring

function open(items: MenuItem[], anchor: Anchor) {
  current?.();
  const menu = menuEl(items, {
    onClose: () => {
      close();
    },
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !document.querySelector(".md-menu.is-sub")) {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (menu.handleKey?.(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onDown = (e: PointerEvent) => {
    if (!(e.target instanceof Element) || !e.target.closest(".md-menu")) {
      close();
    }
  };
  function close() {
    if (current !== close) {
      return;
    }
    current = null;
    menu.closeAll?.();
    for (const m of document.querySelectorAll(".md-menu.is-sub")) {
      m.remove();
    }
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("scroll", close, true);
  }
  current = close;
  document.body.append(menu);
  // An element-like anchor (the gripper) opens below it; a point (right-click) opens at the pointer.
  const isPoint = "x" in anchor;
  const ref = isPoint
    ? { getBoundingClientRect: () => new DOMRect(anchor.x, anchor.y, 0, 0) }
    : anchor;
  void computePosition(ref, menu, {
    middleware: [offset(isPoint ? 2 : 4), flip(), shift({ padding: 8 })],
    placement: isPoint ? "right-start" : "bottom-start",
    strategy: "fixed",
  }).then(({ x, y }) =>
    Object.assign(menu.style, { left: `${x}px`, top: `${y}px` }),
  );
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onDown, true);
  setTimeout(() => {
    window.addEventListener("scroll", close, true);
  }, 0);
  return close;
}
