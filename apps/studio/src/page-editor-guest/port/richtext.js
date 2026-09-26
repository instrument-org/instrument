// Rich text on one element of the page. A Tiptap editor is mounted inside the
// element (its document is the element's inline content, parsed from the
// file's source, not the live DOM), with bold, italic and link in a bubble
// menu, Shift+Enter for a line break, and Enter or Esc to finish. Any other
// inline markup (spans with classes, icons, <small>, <time>...) rides along
// unchanged as preserved marks and atoms, so the editor can hold nearly any
// text block the page has. If it cannot hold one exactly, `mountRich` says so
// and the caller falls back to plain-text editing.
import { Editor, Extension, Mark, Node, posToDOMRect } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/extension-bubble-menu";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";

import { icon } from "./icons.js";

const attrsOf = (el, skip = []) =>
  Object.fromEntries(
    [...el.attributes]
      .filter((a) => !skip.includes(a.name) && a.name !== "data-src-id")
      .map((a) => [a.name, a.value]),
  );
const keepAttrs = (skip) => ({
  attrs: {
    default: {},
    parseHTML: (el) => attrsOf(el, skip),
    renderHTML: (a) => a.attrs ?? {},
  },
});

const Doc = Node.create({ name: "doc", topNode: true, content: "inline*" });

// Inline elements with no text of their own (icons, empty spans, images) are
// kept as opaque atoms and written back as they were.
const EMPTY_INLINE =
  "i, span, svg, img, small, abbr, code, kbd, mark, sub, sup, time, b, strong, em, u, s, wbr, a:not([href]), input, button, label";
const RawInline = Node.create({
  name: "rawInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes: () => ({ html: { default: "", rendered: false } }),
  parseHTML: () => [
    {
      tag: EMPTY_INLINE,
      priority: 100,
      getAttrs: (el) =>
        !/\S/.test(el.textContent) ? { html: el.outerHTML } : false,
    },
  ],
  renderHTML({ node }) {
    const t = document.createElement("template");
    t.innerHTML = node.attrs.html;
    return t.content.firstElementChild ?? ["span", {}];
  },
  renderText: () => "￼",
});

function markWithTag(name, tags, key) {
  return Mark.create({
    name,
    addAttributes: () => ({
      tag: {
        default: tags[0],
        parseHTML: (el) => el.tagName.toLowerCase(),
        rendered: false,
      },
      ...keepAttrs(),
    }),
    parseHTML: () => tags.map((tag) => ({ tag })),
    renderHTML: ({ mark, HTMLAttributes }) => [
      mark.attrs.tag,
      HTMLAttributes,
      0,
    ],
    addKeyboardShortcuts() {
      return {
        [`Mod-${key}`]: () => this.editor.commands.toggleMark(this.name),
      };
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
    name: `keep_${tag}`,
    excludes: "",
    addAttributes: () => keepAttrs(),
    parseHTML: () => [{ tag }],
    renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
  }),
);

// Links keep every attribute they were written with; only href is edited.
const KeepLink = Link.extend({
  addAttributes() {
    return {
      ...keepAttrs(),
      href: { default: null, parseHTML: (el) => el.getAttribute("href") },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ["a", HTMLAttributes, 0];
  },
}).configure({
  openOnClick: false,
  autolink: false,
  linkOnPaste: false,
  enableClickSelection: false,
  HTMLAttributes: {},
});

// ------------------------------------------------------------------ shape

const collapse = (s) => s.replace(/\s+/g, " ");
const sig = (el) =>
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
export function shapeOf(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  const runs = [];
  const push = (key, text) => {
    const last = runs.at(-1);
    if (text != null && last && last.key === key && last.text != null)
      last.text += text;
    else runs.push({ key, text });
  };
  const walk = (node, marks) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) push([...marks].sort().join("|"), c.data);
      else if (c.nodeType === 1) {
        if (c.tagName === "BR") push("<br>", null);
        else if (
          !/\S/.test(c.textContent) &&
          !(c.tagName === "A" && c.hasAttribute("href"))
        )
          push(`atom:${sig(c)}`, null);
        else
          walk(c, [
            ...marks,
            sig(c).replace(/^b\b/, "strong").replace(/^i\b/, "em"),
          ]);
      }
    }
  };
  walk(t.content, []);
  let text = runs.map((r) => r.text ?? "").join("");
  const lead = text.length - text.trimStart().length;
  text = collapse(text).trim();
  // Runs that are only whitespace between marks do not change the shape.
  const marks = runs
    .map((r) => ({ ...r, text: r.text == null ? null : collapse(r.text) }))
    .filter(
      (r, i) =>
        r.text == null ||
        r.text.trim() ||
        (i > 0 && i < runs.length - 1 && r.key !== ""),
    )
    .map((r) => r.key)
    .filter((k, i, a) => k !== a[i - 1])
    .join("¦");
  return { marks, text, lead };
}

// ------------------------------------------------------------------ bubble

const ICON = {
  bold: icon("bold", 14),
  italic: icon("italic", 14),
  link: icon("link", 14),
  unlink: icon("linkBreak", 14),
  check: icon("check", 14),
};

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

// ------------------------------------------------------------------ mount

/**
 * Mount on `el` with `srcInner` (the file's source between the element's tags).
 * Returns null if the editor cannot hold that markup exactly. Options:
 *   layer     host element the bubble menu lives in
 *   onDone    called on Enter / Esc
 *   at        { x, y } in viewport coordinates to put the caret, or 'end'
 */
export function mountRich(el, srcInner, { layer, onDone, at }) {
  const saved = [...el.childNodes];
  const bubble = buildBubble();
  const linkRow = bubble.querySelector(".link-row");
  const marksRow = bubble.querySelector(".marks");
  const input = linkRow.querySelector("input");
  let linkEditing = false;

  const Keys = Extension.create({
    name: "editorKeys",
    priority: 1000,
    addKeyboardShortcuts: () => ({
      Enter: () => (onDone(), true),
      Escape: () => (linkEditing ? closeLink() : onDone(), true),
      "Mod-k": () => (openLink(), true),
    }),
  });

  el.replaceChildren();
  const editor = new Editor({
    element: el,
    injectCSS: false,
    content: srcInner,
    extensions: [
      StarterKit.configure({
        document: false,
        paragraph: false,
        heading: false,
        blockquote: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        horizontalRule: false,
        dropcursor: false,
        gapcursor: false,
        link: false,
        underline: false,
        trailingNode: false,
      }),
      Doc,
      RawInline,
      Bold,
      Italic,
      KeepLink,
      ...keepMarks,
      Keys,
      BubbleMenu.configure({
        element: bubble,
        updateDelay: 60,
        appendTo: () => layer,
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
        shouldShow: ({ editor: ed, state }) => {
          if (linkEditing) return true;
          if (bubble.contains(bubble.getRootNode().activeElement)) return true;
          if (!ed.view.hasFocus()) return false;
          return !state.selection.empty || ed.isActive("link");
        },
        options: {
          strategy: "fixed",
          placement: "top",
          offset: 8,
          flip: { padding: 8 },
          shift: { padding: 8 },
          scrollTarget: window,
        },
      }),
    ],
    editorProps: {
      attributes: { class: "editor-guest-pm", spellcheck: "false" },
    },
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
    for (const b of marksRow.querySelectorAll("[data-cmd]"))
      b.classList.toggle("on", editor.isActive(b.dataset.cmd));
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
      while (a > 0 && /\w/.test(text[a - 1])) a--;
      while (b < text.length && /\w/.test(text[b])) b++;
      if (b > a) editor.commands.setTextSelection({ from: a, to: b });
    }
    if (editor.isActive("link")) editor.commands.extendMarkRange("link");
    input.value = editor.getAttributes("link").href ?? "";
    marksRow.hidden = true;
    linkRow.hidden = false;
    linkRow.querySelector("[data-cmd=unlink]").hidden =
      !editor.isActive("link");
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
    if (refocus) editor.commands.focus();
  }

  bubble.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });
  marksRow.addEventListener("click", (e) => {
    const cmd = e.target.closest("[data-cmd]")?.dataset.cmd;
    if (cmd === "bold" || cmd === "italic")
      editor.chain().focus().toggleMark(cmd).run();
    else if (cmd === "link") openLink();
  });
  linkRow.addEventListener("submit", (e) => {
    e.preventDefault();
    const href = input.value.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href) chain.unsetMark("link").run();
    else
      chain
        .setMark("link", {
          href: /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(href)
            ? `mailto:${href}`
            : href,
        })
        .run();
    closeLink();
  });
  linkRow.querySelector("[data-cmd=unlink]").addEventListener("click", () => {
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
    const hit =
      at && at !== "end" ? v.posAtCoords({ left: at.x, top: at.y }) : null;
    if (hit) {
      const text = v.state.doc.textBetween(
        0,
        v.state.doc.content.size,
        "\n",
        "￼",
      );
      let a = hit.pos;
      let b = hit.pos;
      while (a > 0 && /[\p{L}\p{N}'’-]/u.test(text[a - 1])) a--;
      while (b < text.length && /[\p{L}\p{N}'’-]/u.test(text[b])) b++;
      editor
        .chain()
        .focus()
        .setTextSelection(at.select && b > a ? { from: a, to: b } : hit.pos)
        .run();
    } else editor.commands.focus("end");
  });

  return {
    editor,
    bubble,
    containsHost: (node) => bubble.contains(node),
    /**
     * What changed: { changed: false } | { marks: false, oldText, newText }
     * (only words changed) | { marks: true, html } (formatting changed).
     */
    result() {
      const html = editor.getHTML();
      if (html === before) return { changed: false };
      const a = shapeOf(before);
      const b = shapeOf(html);
      if (a.marks === b.marks)
        return {
          changed: a.text !== b.text,
          marks: false,
          oldText: a.text,
          newText: b.text,
        };
      return { changed: true, marks: true, html };
    },
    destroy() {
      if (linkEditing) closeLink(false);
      bubble.remove();
      editor.destroy();
      el.replaceChildren(...saved);
    },
  };
}
