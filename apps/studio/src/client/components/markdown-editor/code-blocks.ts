// Code blocks on top of Crepe's CodeMirror block:
//
// - The whole info string survives. Milkdown's code block keeps only `lang`,
//   so a fence like ```ts:src/budget.ts or ```ts title="budget.ts" would lose
//   its path or meta the moment the block was edited. `info` holds everything
//   after the language, and serialization puts it back.
// - A label from `lang:path` or `title="…"`, shown in the block's header.
// - Blocks past 24 lines collapse behind "Show more" until expanded.
// - A language picker with search that ranks prefix matches first, common
//   languages on top, and full keyboard use.
// - Previews: fences Studio draws as something other than code (a message
//   card, a files block, a Mermaid diagram) and ```math fences. "Edit" on the
//   block shows the source.
import { LanguageDescription } from "@codemirror/language";
import { languages as cmLanguages } from "@codemirror/language-data";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { type Node as PMNode } from "@milkdown/kit/prose/model";
import { type EditorView } from "@milkdown/kit/prose/view";
import katex from "katex";

// ---------------------------------------------------------------- schema

interface MdCode {
  lang?: null | string;
  meta?: null | string;
  value?: string;
}

/** "ts:src/a.ts" -> ["ts", ":src/a.ts"] */
function splitLang(lang: string): [string, string] {
  const i = lang.indexOf(":");
  return i > 0 ? [lang.slice(0, i), lang.slice(i)] : [lang, ""];
}

export const codeBlockInfo = codeBlockSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    attrs: { ...base.attrs, info: { default: "", validate: "string" } },
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        const code = node as MdCode;
        const [language, suffix] = splitLang(code.lang ?? "");
        state.openNode(type, {
          info: suffix + (code.meta ? ` ${code.meta}` : ""),
          language,
        });
        if (code.value) {
          state.addText(code.value);
        }
        state.closeNode();
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        const text = node.content.firstChild?.text ?? "";
        const language = String(node.attrs.language ?? "");
        // Crepe's LaTeX blocks are `$$` math in the file.
        if (language.toLowerCase() === "latex") {
          state.addNode("math", undefined, text);
          return;
        }
        const info = String(node.attrs.info ?? "");
        const sp = info.indexOf(" ");
        const suffix = sp === -1 ? info : info.slice(0, sp);
        const meta = sp === -1 ? null : info.slice(sp + 1);
        state.addNode("code", undefined, text, {
          lang: language + suffix || null,
          meta,
        });
      },
    },
  };
});

export function labelOf(info: string): string {
  if (!info) {
    return "";
  }
  const title = /title=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(info);
  if (title) {
    return title[1] ?? title[2] ?? title[3] ?? "";
  }
  if (info.startsWith(":")) {
    return info.slice(1).split(" ")[0] ?? "";
  }
  return "";
}

// ---------------------------------------------------------------- languages

const extra = [
  LanguageDescription.of({
    alias: ["mermaid"],
    load: async () => (await import("@codemirror/lang-markdown")).markdown(),
    name: "Mermaid",
  }),
  LanguageDescription.of({
    alias: ["message", "files"],
    load: async () => (await import("@codemirror/lang-markdown")).markdown(),
    name: "Studio block",
  }),
];
export const languages = [...cmLanguages, ...extra];

// What the fence is written as: the short, conventional tag.
const PREFERRED: Record<string, string> = {
  "C#": "csharp",
  "C++": "cpp",
  Go: "go",
  JavaScript: "js",
  JSX: "jsx",
  LaTeX: "latex",
  Markdown: "md",
  "Plain text": "",
  Python: "python",
  Ruby: "ruby",
  Rust: "rust",
  Shell: "bash",
  TSX: "tsx",
  TypeScript: "ts",
  YAML: "yaml",
};
const COMMON = [
  "Plain text",
  "TypeScript",
  "JavaScript",
  "Python",
  "Shell",
  "JSON",
  "HTML",
  "CSS",
  "Markdown",
  "SQL",
  "YAML",
  "Go",
  "Rust",
  "Mermaid",
  "LaTeX",
];

interface Entry {
  alias: readonly string[];
  name: string;
}
const entries: Entry[] = [
  { alias: ["text", "plain", "txt"], name: "Plain text" },
  ...languages.map((l) => ({ alias: l.alias, name: l.name })),
];
const tagOf = (e: Entry) =>
  PREFERRED[e.name] ?? e.alias[0] ?? e.name.toLowerCase();
export const displayName = (language: string) => {
  if (!language) {
    return "Plain text";
  }
  const lower = language.toLowerCase();
  return (
    entries.find(
      (e) => e.name.toLowerCase() === lower || e.alias.includes(lower),
    )?.name ?? language
  );
};

function rank(query: string): Entry[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    const common = COMMON.flatMap((n) => entries.filter((e) => e.name === n));
    return [
      ...common,
      ...entries
        .filter((e) => !COMMON.includes(e.name))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ];
  }
  const scored: { e: Entry; s: number }[] = [];
  for (const e of entries) {
    const names = [e.name.toLowerCase(), ...e.alias];
    let s = -1;
    if (names.includes(q)) {
      s = 0;
    } else if (names.some((n) => n.startsWith(q))) {
      s = 1;
    } else if (names.some((n) => n.includes(q))) {
      s = 2;
    }
    if (s >= 0) {
      scored.push({
        e,
        s: s * 100 + (COMMON.includes(e.name) ? 0 : 50) + e.name.length / 100,
      });
    }
  }
  return scored.sort((a, b) => a.s - b.s).map((x) => x.e);
}

// ---------------------------------------------------------------- picker

let openPicker: (() => void) | null = null;

/** Opens the picker under `anchor`; `choose(tag)` receives the fence tag ('' for plain text). */
export function openLanguagePicker(
  anchor: HTMLElement,
  current: string,
  choose: (tag: string) => void,
) {
  openPicker?.();
  const pop = document.createElement("div");
  pop.className = "md-popover md-lang-picker";
  const input = document.createElement("input");
  input.className = "md-input";
  input.placeholder = "Search languages";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  const list = document.createElement("div");
  list.className = "md-lang-list";
  list.setAttribute("role", "listbox");
  pop.append(input, list);
  let items: Entry[] = [];
  let active = 0;
  const currentName = displayName(current);
  const mark = () => {
    for (const [i, r] of [...list.children].entries())
      r.classList.toggle("is-active", i === active);
    list.children[active]?.scrollIntoView({ block: "nearest" });
  };
  // Declared ahead of `close`, which removes it; `close` is hoisted.
  const onDown = (e: PointerEvent) => {
    const target = e.target instanceof Node ? e.target : null;
    if (!pop.contains(target) && !anchor.contains(target)) {
      close();
    }
  };
  function close() {
    if (openPicker !== close) {
      return;
    }
    openPicker = null;
    document.removeEventListener("pointerdown", onDown, true);
    pop.remove();
  }
  const pick = (e: Entry) => {
    close();
    choose(tagOf(e));
  };
  const render = () => {
    items = rank(input.value);
    list.replaceChildren();
    if (items.length === 0) {
      const none = document.createElement("div");
      none.className = "md-lang-empty";
      none.textContent = input.value.trim()
        ? `Use “${input.value.trim()}”`
        : "No languages";
      list.append(none);
    }
    for (const [i, e] of items.entries()) {
      const row = document.createElement("div");
      row.className = "md-lang-item";
      row.setAttribute("role", "option");
      row.classList.toggle("is-active", i === active);
      row.classList.toggle("is-current", e.name === currentName);
      const name = document.createElement("span");
      name.textContent = e.name;
      row.append(name);
      if (i === (input.value ? -1 : COMMON.length - 1)) {
        row.classList.add("is-group-end");
      }
      row.addEventListener("mousemove", () => {
        if (active !== i) {
          active = i;
          mark();
        }
      });
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
      });
      row.addEventListener("click", () => {
        pick(e);
      });
      list.append(row);
    }
  };
  input.addEventListener("input", () => {
    active = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown": {
        active = Math.min(items.length - 1, active + 1);

        break;
      }
      case "ArrowUp": {
        active = Math.max(0, active - 1);

        break;
      }
      case "Enter": {
        e.preventDefault();
        const chosen = items[active];
        if (chosen) {
          pick(chosen);
        } else if (input.value.trim()) {
          close();
          choose(input.value.trim().toLowerCase());
        }
        return;
      }
      case "Escape": {
        e.preventDefault();
        close();
        return;
      }
      default: {
        return;
      }
    }
    e.preventDefault();
    mark();
  });
  openPicker = close;
  document.body.append(pop);
  document.addEventListener("pointerdown", onDown, true);
  render();
  // Open on the current language so a glance shows it.
  const cur = items.findIndex((e) => e.name === currentName);
  if (cur !== -1) {
    active = cur;
    mark();
  }
  void computePosition(anchor, pop, {
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    placement: "bottom-start",
    strategy: "fixed",
  }).then(({ x, y }) => {
    Object.assign(pop.style, { left: `${x}px`, top: `${y}px` });
  });
  input.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- previews

/**
 * Wraps Crepe's preview hook. `renderFence` draws the fences Studio draws as
 * something other than code (the element it returns is filled in by React);
 * ```math fences render with KaTeX.
 */
export function renderPreview(
  renderFence: (language: string, content: string) => null | string,
) {
  return (language: string, content: string): HTMLElement | null | string => {
    const lang = language.toLowerCase();
    const fence = content.trim() ? renderFence(lang, content) : null;
    if (fence) {
      return fence;
    }
    if (lang === "math" && content.trim()) {
      return katex.renderToString(content, {
        displayMode: true,
        throwOnError: false,
      });
    }
    return null;
  };
}

// ---------------------------------------------------------------- decoration of Crepe's DOM

const COLLAPSE_AT = 24;

/**
 * Keeps the label, the collapse control, and the picker hook on every code
 * block's DOM. Crepe's component owns the block's children and rebuilds them
 * when a block scrolls back into view, so this re-applies after mutations.
 * Returns a scheduler for a pass, and a cleanup.
 */
export function decorateCodeBlocks(view: EditorView, root: HTMLElement) {
  const expanded = new WeakSet<Element>();
  const apply = () => {
    for (const dom of root.querySelectorAll(".milkdown-code-block")) {
      const node = codeBlockAt(view, dom);
      if (!node) {
        continue;
      }
      const label = labelOf(String(node.attrs.info ?? ""));
      const tools = dom.querySelector(".tools");
      if (tools) {
        let tag = tools.querySelector(".md-code-label");
        if (label) {
          if (!tag) {
            tag = document.createElement("span");
            tag.className = "md-code-label";
            tools.querySelector(".language-picker")?.after(tag);
          }
          if (tag.textContent !== label) {
            tag.textContent = label;
          }
        } else {
          tag?.remove();
        }
        const btn = tools.querySelector(".language-button");
        const shown = displayName(String(node.attrs.language ?? ""));
        const text = btn?.querySelector(".md-lang-name");
        if (btn && !text) {
          const s = document.createElement("span");
          s.className = "md-lang-name";
          s.textContent = shown;
          btn.prepend(s);
        } else if (text && text.textContent !== shown) {
          text.textContent = shown;
        }
      }
      const lines = node.textContent.split("\n").length;
      const long = lines > COLLAPSE_AT;
      dom.classList.toggle("is-long", long);
      dom.classList.toggle(
        "is-collapsed",
        long && !expanded.has(dom) && !dom.classList.contains("selected"),
      );
      let more = dom.querySelector(":scope > .md-code-more");
      if (long && !more) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "md-code-more";
        button.addEventListener("mousedown", (e) => {
          e.preventDefault();
        });
        button.addEventListener("click", () => {
          if (expanded.has(dom)) {
            expanded.delete(dom);
          } else {
            expanded.add(dom);
          }
          apply();
        });
        dom.append(button);
        more = button;
      } else if (!long) {
        more?.remove();
      }
      const moreText = expanded.has(dom)
        ? "Show less"
        : `Show ${lines - COLLAPSE_AT} more lines`;
      // Write only on change: every write is a mutation this is watching for.
      if (more && more.textContent !== moreText) {
        more.textContent = moreText;
      }
    }
  };
  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(apply);
  };
  // Only structural changes to code blocks (Crepe mounting or tearing one
  // down, a block added) need a pass.
  const ours = (n: Node) =>
    n instanceof Element &&
    (n.classList.contains("md-code-label") ||
      n.classList.contains("md-code-more") ||
      n.classList.contains("md-lang-name"));
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (r) =>
          r.target instanceof Element &&
          r.target.closest(".milkdown-code-block, .ProseMirror") &&
          [...r.addedNodes, ...r.removedNodes].some(
            (n) => !ours(n) && n instanceof Element,
          ),
      )
    ) {
      schedule();
    }
  });
  observer.observe(root, { childList: true, subtree: true });

  // Our picker instead of Crepe's: intercept the language button.
  const onClick = (e: MouseEvent) => {
    const btn =
      e.target instanceof Element
        ? e.target.closest<HTMLElement>(".milkdown-code-block .language-button")
        : null;
    if (!btn || !view.editable) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const dom = btn.closest(".milkdown-code-block");
    if (!dom) {
      return;
    }
    const find = () => {
      let pos: number;
      try {
        pos = view.posAtDOM(dom, 0);
      } catch {
        return null;
      }
      for (const p of [pos - 1, pos]) {
        if (p >= 0 && view.state.doc.nodeAt(p)?.type.name === "code_block") {
          return p;
        }
      }
      const $p = view.state.doc.resolve(pos);
      return $p.parent.type.name === "code_block" ? $p.before() : null;
    };
    const at = find();
    if (at === null) {
      return;
    }
    openLanguagePicker(
      btn,
      String(view.state.doc.nodeAt(at)?.attrs.language ?? ""),
      (language) => {
        const p = find();
        const n = p === null ? null : view.state.doc.nodeAt(p);
        if (p === null || !n) {
          return;
        }
        view.dispatch(
          view.state.tr.setNodeMarkup(p, null, { ...n.attrs, language }),
        );
      },
    );
  };
  const onPointerDown = (e: PointerEvent) => {
    if (
      e.target instanceof Element &&
      e.target.closest(".milkdown-code-block .language-button")
    ) {
      e.stopPropagation();
    }
  };
  root.addEventListener("click", onClick, true);
  root.addEventListener("pointerdown", onPointerDown, true);
  return {
    destroy: () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("pointerdown", onPointerDown, true);
      openPicker?.();
    },
    schedule,
  };
}

function codeBlockAt(view: EditorView, dom: Element): null | PMNode {
  let pos: number;
  try {
    pos = view.posAtDOM(dom, 0);
  } catch {
    return null;
  }
  const doc = view.state.doc;
  const $pos = doc.resolve(pos);
  if ($pos.parent.type.name === "code_block") {
    return $pos.parent;
  }
  for (const p of [pos - 1, pos]) {
    const n = p >= 0 ? doc.nodeAt(p) : null;
    if (n?.type.name === "code_block") {
      return n;
    }
  }
  return null;
}
