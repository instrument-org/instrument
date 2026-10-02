/**
 * Rich text on one element of the page. A Tiptap editor is mounted inside the
 * element (its document is the element's inline content, parsed from the
 * file's source, not the live DOM), with bold, italic and link in a bubble
 * menu, Shift+Enter for a line break, and Enter or Esc to finish. Any other
 * inline markup (spans with classes, icons, `<small>`, `<time>`...) rides
 * along unchanged as preserved marks and atoms, so the editor can hold nearly
 * any text block the page has. If it cannot hold one exactly, `mountRich`
 * says so and the caller falls back to plain-text editing.
 */
import {
  Editor,
  Extension,
  Mark,
  posToDOMRect,
  Node as TiptapNode,
} from "@tiptap/core";
import { BubbleMenu } from "@tiptap/extension-bubble-menu";
import { Link } from "@tiptap/extension-link";
import { StarterKit } from "@tiptap/starter-kit";

import { findAs } from "./dom";
import { icon } from "./icons";

const attrsOf = (el: Element) =>
  Object.fromEntries(
    [...el.attributes]
      .filter((a) => a.name !== "data-src-id")
      .map((a) => [a.name, a.value]),
  );
/** An attribute that carries every attribute the element was written with. */
const keepAttrs = () => ({
  attrs: {
    default: {},
    parseHTML: (el: HTMLElement) => attrsOf(el),
    renderHTML: (a: Record<string, unknown>) => {
      const attrs = a.attrs;
      return typeof attrs === "object" && attrs !== null ? attrs : {};
    },
  },
});

const Doc = TiptapNode.create({
  content: "inline*",
  name: "doc",
  topNode: true,
});

// Inline elements with no text of their own (icons, empty spans, images) are
// kept as opaque atoms and written back as they were.
const EMPTY_INLINE =
  "i, span, svg, img, small, abbr, code, kbd, mark, sub, sup, time, b, strong, em, u, s, wbr, a:not([href]), input, button, label";
const RawInline = TiptapNode.create({
  addAttributes: () => ({ html: { default: "", rendered: false } }),
  atom: true,
  group: "inline",
  inline: true,
  name: "rawInline",
  parseHTML: () => [
    {
      getAttrs: (el: HTMLElement) =>
        /\S/.test(el.textContent) ? false : { html: el.outerHTML },
      priority: 100,
      tag: EMPTY_INLINE,
    },
  ],
  renderHTML({ node }) {
    const html: unknown = node.attrs.html;
    const t = document.createElement("template");
    t.innerHTML = typeof html === "string" ? html : "";
    return t.content.firstElementChild ?? ["span", {}];
  },
  renderText: () => "￼",
  selectable: false,
});

function markWithTag(name: string, tags: [string, ...string[]], key: string) {
  return Mark.create({
    addAttributes: () => ({
      tag: {
        default: tags[0],
        parseHTML: (el: HTMLElement) => el.tagName.toLowerCase(),
        rendered: false,
      },
      ...keepAttrs(),
    }),
    addKeyboardShortcuts() {
      return {
        [`Mod-${key}`]: () => this.editor.commands.toggleMark(this.name),
      };
    },
    name,
    parseHTML: () => tags.map((tag) => ({ tag })),
    renderHTML: ({ HTMLAttributes, mark }) => {
      const tag: unknown = mark.attrs.tag;
      return [typeof tag === "string" ? tag : tags[0], HTMLAttributes, 0];
    },
  });
}
const Bold = markWithTag("bold", ["strong", "b"], "b");
const Italic = markWithTag("italic", ["em", "i"], "i");

const KEEP_TAGS = [
  "span",
  "small",
  "time",
  "abbr",
  "mark",
  "sup",
  "sub",
  "kbd",
  "u",
  "s",
  "del",
  "ins",
  "q",
  "cite",
  "dfn",
  "var",
  "samp",
  "data",
  "label",
  "code",
  "bdi",
];
const keepMarks = KEEP_TAGS.map((tag) =>
  Mark.create({
    addAttributes: () => keepAttrs(),
    excludes: "",
    name: `keep_${tag}`,
    parseHTML: () => [{ tag }],
    renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
  }),
);

// Links keep every attribute they were written with; only href is edited.
const KeepLink = Link.extend({
  addAttributes() {
    return {
      ...keepAttrs(),
      href: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("href"),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ["a", HTMLAttributes, 0];
  },
}).configure({
  autolink: false,
  enableClickSelection: false,
  HTMLAttributes: {},
  linkOnPaste: false,
  openOnClick: false,
});

// ------------------------------------------------------------------ shape

const collapse = (s: string) => s.replaceAll(/\s+/g, " ");
const sig = (el: Element) =>
  `${el.tagName.toLowerCase()}${[...el.attributes]
    .filter((a) => a.name !== "data-src-id")
    .map((a) => ` ${a.name}=${JSON.stringify(a.value)}`)
    .sort()
    .join("")}`;

/**
 * What an inline fragment is made of, apart from its words: runs of text keyed
 * by the set of elements around them (order-free, so nesting order does not
 * count), plus atoms (line breaks, empty elements). Two fragments with the
 * same `marks` differ only in text.
 */
function shapeOf(html: string) {
  const t = document.createElement("template");
  t.innerHTML = html;
  const runs: { key: string; text: null | string }[] = [];
  const push = (key: string, text: null | string) => {
    const last = runs.at(-1);
    if (text !== null && last?.key === key && last.text !== null) {
      last.text += text;
    } else {
      runs.push({ key, text });
    }
  };
  const walk = (node: Node, marks: string[]) => {
    for (const c of node.childNodes) {
      if (c instanceof Text) {
        push([...marks].sort().join("|"), c.data);
      } else if (c instanceof Element) {
        if (c.tagName === "BR") {
          push("<br>", null);
        } else if (
          !/\S/.test(c.textContent) &&
          !(c.tagName === "A" && c.hasAttribute("href"))
        ) {
          push(`atom:${sig(c)}`, null);
        } else {
          walk(c, [
            ...marks,
            sig(c).replace(/^b\b/, "strong").replace(/^i\b/, "em"),
          ]);
        }
      }
    }
  };
  walk(t.content, []);
  const text = collapse(runs.map((r) => r.text ?? "").join("")).trim();
  // Runs that are only whitespace between marks do not change the shape.
  const marks = runs
    .map((r) => ({ ...r, text: r.text === null ? null : collapse(r.text) }))
    .filter(
      (r, i) =>
        r.text?.trim() !== "" || (i > 0 && i < runs.length - 1 && r.key !== ""),
    )
    .map((r) => r.key)
    .filter((k, i, a) => k !== a[i - 1])
    .join("¦");
  return { marks, text };
}

// ------------------------------------------------------------------ bubble

const ICON = {
  bold: icon("bold", 14),
  check: icon("check", 14),
  italic: icon("italic", 14),
  link: icon("link", 14),
  unlink: icon("linkBreak", 14),
};

/** Where the caret goes when editing starts: at a point (selecting the word there), or the end. */
export type CaretAt = "end" | { select?: boolean; x: number; y: number };

// ------------------------------------------------------------------ mount

/**
 * What changed: nothing, only words (`oldText` to `newText`), or formatting
 * (the new inner HTML).
 */
export type RichResult =
  | { changed: boolean; marks: false; newText: string; oldText: string }
  | { changed: false }
  | { changed: true; html: string; marks: true };

export interface RichText {
  /** Whether a node belongs to the editor's own bubble menu. */
  containsHost: (node: EventTarget | undefined) => boolean;
  destroy: () => void;
  editor: Editor;
  result: () => RichResult;
}

/**
 * Mount on `el` with `srcInner` (the file's source between the element's
 * tags), the bubble menu drawn in `layer`, `onDone` called on Enter or Esc.
 * Returns null if the editor cannot hold that markup exactly.
 */
export function mountRich(
  el: HTMLElement,
  srcInner: string,
  {
    at,
    layer,
    onDone,
  }: { at: CaretAt; layer: HTMLElement; onDone: () => void },
): null | RichText {
  const saved = [...el.childNodes];
  const bubble = buildBubble();
  const linkRow = findAs(bubble, ".link-row", HTMLFormElement);
  const marksRow = findAs(bubble, ".marks", HTMLElement);
  const input = findAs(linkRow, "input", HTMLInputElement);
  const unlink = findAs(linkRow, "[data-cmd=unlink]", HTMLButtonElement);
  let linkEditing = false;

  const Keys = Extension.create({
    addKeyboardShortcuts: () => ({
      Enter: () => {
        onDone();
        return true;
      },
      Escape: () => {
        if (linkEditing) {
          closeLink();
        } else {
          onDone();
        }
        return true;
      },
      "Mod-k": () => {
        openLink();
        return true;
      },
    }),
    name: "editorKeys",
    priority: 1000,
  });

  el.replaceChildren();
  const editor: Editor = new Editor({
    content: srcInner,
    editorProps: {
      attributes: { class: "editor-guest-pm", spellcheck: "false" },
    },
    element: el,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        document: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        paragraph: false,
        strike: false,
        trailingNode: false,
        underline: false,
      }),
      Doc,
      RawInline,
      Bold,
      Italic,
      KeepLink,
      ...keepMarks,
      Keys,
      BubbleMenu.configure({
        appendTo: () => layer,
        element: bubble,
        getReferencedVirtualElement: () => {
          const v = editor.view;
          const { from, to } = v.state.selection;
          const r = posToDOMRect(v, from, to);
          const rect = new DOMRect(r.left, r.top, r.width, r.height);
          return {
            getBoundingClientRect: () => rect,
            getClientRects: () => [rect],
          };
        },
        options: {
          flip: { padding: 8 },
          offset: 8,
          placement: "top",
          scrollTarget: window,
          shift: { padding: 8 },
          strategy: "fixed",
        },
        shouldShow: ({ editor: ed, state }) => {
          if (linkEditing) {
            return true;
          }
          const root = bubble.getRootNode();
          const active =
            root instanceof ShadowRoot || root instanceof Document
              ? root.activeElement
              : null;
          if (bubble.contains(active)) {
            return true;
          }
          if (!ed.view.hasFocus()) {
            return false;
          }
          return !state.selection.empty || ed.isActive("link");
        },
        updateDelay: 60,
      }),
    ],
    injectCSS: false,
  });

  const before = editor.getHTML();
  const want = shapeOf(srcInner);
  const got = shapeOf(before);
  if (want.marks !== got.marks || want.text !== got.text) {
    editor.destroy();
    el.replaceChildren(...saved);
    return null;
  }

  const refresh = () => {
    for (const b of marksRow.querySelectorAll<HTMLElement>("[data-cmd]")) {
      b.classList.toggle("on", editor.isActive(b.dataset.cmd ?? ""));
    }
  };
  editor.on("transaction", refresh);

  function openLink() {
    linkEditing = true;
    const { state } = editor;
    if (state.selection.empty && !editor.isActive("link")) {
      // Nothing selected: link the word under the caret.
      const { from } = state.selection;
      const text = state.doc.textBetween(0, state.doc.content.size, "\n", "￼");
      let a = from;
      let b = from;
      while (a > 0 && /\w/.test(text[a - 1] ?? "")) {
        a--;
      }
      while (b < text.length && /\w/.test(text[b] ?? "")) {
        b++;
      }
      if (b > a) {
        editor.commands.setTextSelection({ from: a, to: b });
      }
    }
    if (editor.isActive("link")) {
      editor.commands.extendMarkRange("link");
    }
    const href: unknown = editor.getAttributes("link").href;
    input.value = typeof href === "string" ? href : "";
    marksRow.hidden = true;
    linkRow.hidden = false;
    unlink.hidden = !editor.isActive("link");
    editor.view.dispatch(editor.state.tr.setMeta("bubbleMenu", "show"));
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }
  function closeLink(refocus = true) {
    linkEditing = false;
    linkRow.hidden = true;
    marksRow.hidden = false;
    if (refocus) {
      editor.commands.focus();
    }
  }

  bubble.addEventListener("mousedown", (e) => {
    if (e.target instanceof Element && e.target.closest("button")) {
      e.preventDefault();
    }
  });
  marksRow.addEventListener("click", (e) => {
    const cmd =
      e.target instanceof Element
        ? e.target.closest<HTMLElement>("[data-cmd]")?.dataset.cmd
        : undefined;
    if (cmd === "bold" || cmd === "italic") {
      editor.chain().focus().toggleMark(cmd).run();
    } else if (cmd === "link") {
      openLink();
    }
  });
  linkRow.addEventListener("submit", (e) => {
    e.preventDefault();
    const href = input.value.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (href) {
      chain
        .setMark("link", {
          href: /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(href)
            ? `mailto:${href}`
            : href,
        })
        .run();
    } else {
      chain.unsetMark("link").run();
    }
    closeLink();
  });
  unlink.addEventListener("click", () => {
    editor.chain().focus().extendMarkRange("link").unsetMark("link").run();
    closeLink();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeLink();
    }
  });

  // Caret where the double-click landed, selecting the word under it.
  requestAnimationFrame(() => {
    const v = editor.view;
    const hit = at === "end" ? null : v.posAtCoords({ left: at.x, top: at.y });
    if (hit && at !== "end") {
      const text = v.state.doc.textBetween(
        0,
        v.state.doc.content.size,
        "\n",
        "￼",
      );
      let a = hit.pos;
      let b = hit.pos;
      while (a > 0 && /[\p{L}\p{N}'’-]/u.test(text[a - 1] ?? "")) {
        a--;
      }
      while (b < text.length && /[\p{L}\p{N}'’-]/u.test(text[b] ?? "")) {
        b++;
      }
      editor
        .chain()
        .focus()
        .setTextSelection(at.select && b > a ? { from: a, to: b } : hit.pos)
        .run();
    } else {
      editor.commands.focus("end");
    }
  });

  return {
    containsHost: (node) => node instanceof Node && bubble.contains(node),
    destroy() {
      if (linkEditing) {
        closeLink(false);
      }
      bubble.remove();
      editor.destroy();
      el.replaceChildren(...saved);
    },
    editor,
    result() {
      const html = editor.getHTML();
      if (html === before) {
        return { changed: false };
      }
      const a = shapeOf(before);
      const b = shapeOf(html);
      if (a.marks === b.marks) {
        return {
          changed: a.text !== b.text,
          marks: false,
          newText: b.text,
          oldText: a.text,
        };
      }
      return { changed: true, html, marks: true };
    },
  };
}

function buildBubble() {
  const el = document.createElement("div");
  el.className = "bubble";
  el.innerHTML = `
    <div class="bubble-row marks">
      <button type="button" data-cmd="bold" title="Bold (⌘B)">${ICON.bold}</button>
      <button type="button" data-cmd="italic" title="Italic (⌘I)">${ICON.italic}</button>
      <span class="sep"></span>
      <button type="button" data-cmd="link" title="Link (⌘K)">${ICON.link}<span>Link</span></button>
    </div>
    <form class="bubble-row link-row" hidden>
      <span class="link-ico">${ICON.link}</span>
      <input type="text" spellcheck="false" placeholder="Paste a link or email" aria-label="Link address">
      <button type="submit" data-cmd="apply" title="Apply link">${ICON.check}</button>
      <button type="button" data-cmd="unlink" title="Remove link">${ICON.unlink}</button>
    </form>`;
  return el;
}
