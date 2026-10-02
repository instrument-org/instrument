import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

import { splitMarkdownBlocks } from "./split-markdown-blocks";

// The documents a reply is made of, plus the shapes that are only a problem
// once a document is cut into pieces.
const documents = {
  "adjacent tables": "| a |\n| - |\n| 1 |\n\n| b |\n| - |\n| 2 |\n",
  "blockquote with a lazy line": "> quoted\ncontinued\n\nAfter.\n",
  "custom element across blocks":
    "<my-note>\n\nInside the element.\n\n</my-note>\n\nAfter.\n",
  "display math split by a rule line": "$$\nx = 1\n===\ny = 2\n$$\n\nAfter.\n",
  "duplicate headings": "## Setup\n\ntext\n\n## Setup\n\nmore\n",
  "fence holding a dollar pair": "```sh\necho $$\n```\n\n| a |\n| - |\n| 1 |\n",
  "fence holding something like a link definition":
    "```\n[d]: not-a-definition\n```\n\nAfter.\n",
  "html across a blank line":
    "<details>\n<summary>More</summary>\n\nHidden prose.\n\n</details>\n\nAfter.\n",
  "indented code after a list": "- item\n\n      code\n\nAfter.\n",
  "list then paragraph": "- one\n- two\n\nAfter.\n",
  "nested same-name html":
    "<div>\n<div>\n\ninner\n\n</div>\n\nouter still\n\n</div>\n\nAfter.\n",
  "self-closing html then prose": "<hr />\n\nAfter.\n",
  "setext heading": "Title\n=====\n\nbody\n",
  "table then heading": "| a |\n| - |\n| 1 |\n\n## Next\n\nprose\n",
  "trailing blank lines": "One.\n\n\n\nTwo.\n",
  "void tag inside a paragraph": "Line one<br>\nLine two\n\nAfter.\n",
};

// What must be parsed whole, because a name in one block is defined in another.
const wholeDocumentOnly = {
  "footnote definition and reference":
    "A claim.[^1]\n\nMore prose.\n\n[^1]: The source.\n",
  "footnote reference alone": "A claim.[^note]\n\nMore prose.\n",
  "indented link reference definition":
    "See [the docs][d].\n\nprose\n\n   [d]: https://example.test\n",
  "link reference definition":
    "See [the docs][d].\n\nMore prose.\n\n[d]: https://example.test\n",
};

const all = { ...documents, ...wholeDocumentOnly };

describe("splitMarkdownBlocks", () => {
  // The invariant everything else rests on. A split that loses or reorders a
  // byte changes the document, and every case below would still pass while the
  // reader saw something else.
  it.each(Object.entries(all))("puts %s back together", (_name, markdown) => {
    expect(splitMarkdownBlocks(markdown).join("")).toBe(markdown);
  });

  it.each(Object.entries(wholeDocumentOnly))(
    "keeps %s in one piece",
    (_name, markdown) => {
      expect(splitMarkdownBlocks(markdown)).toEqual([markdown]);
    },
  );

  it("holds a run of raw HTML together until its tag closes", () => {
    expect(splitMarkdownBlocks(documents["html across a blank line"])).toEqual([
      "<details>\n<summary>More</summary>\n\nHidden prose.\n\n</details>\n\n",
      "After.\n",
    ]);
  });

  it("does not let a nested tag of the same name close the outer one", () => {
    const [first] = splitMarkdownBlocks(documents["nested same-name html"]);

    expect(first).toContain("outer still");
  });

  it("keeps a self-closing tag from swallowing what follows", () => {
    expect(
      splitMarkdownBlocks(documents["self-closing html then prose"]),
    ).toEqual(["<hr />\n\n", "After.\n"]);
  });

  it("splits adjacent tables apart", () => {
    expect(splitMarkdownBlocks(documents["adjacent tables"])).toHaveLength(2);
  });

  it("has nothing to split in an empty document", () => {
    expect(splitMarkdownBlocks("")).toEqual([]);
  });
});

/**
 * The test the split exists to survive: a block rendered on its own has to
 * produce what it produces as part of the whole document.
 *
 * Through react-markdown rather than a bare pipeline, because that is what
 * renders it, and as static markup because none of this is about the DOM.
 *
 * Compared without whitespace, on both sides. Rendering a document whole puts a
 * newline between siblings and rendering each block into its own subtree has
 * nowhere to put one, so every difference this would otherwise report is that
 * newline. It is safe to drop because the two tests together still pin
 * everything: the round-trip above is what guarantees not a byte of the source
 * moved, and this is what guarantees the tree built from it is the same tree.
 * A split that lost, duplicated or reordered anything shows up here as
 * different elements or different text, neither of which is whitespace.
 *
 * Twice over, because raw HTML is the case the block merging exists for and it
 * is inert without `rehype-raw`: with the parser off, a `<details>` is escaped
 * text and a merge that split it wrong still reads the same.
 */
const renderers = {
  "raw html escaped": (markdown: string) =>
    renderToStaticMarkup(
      createElement(
        ReactMarkdown,
        { remarkPlugins: [remarkGfm, remarkBreaks] },
        markdown,
      ),
    ),
  "raw html parsed": (markdown: string) =>
    renderToStaticMarkup(
      createElement(
        ReactMarkdown,
        {
          rehypePlugins: [rehypeRaw],
          remarkPlugins: [remarkGfm, remarkBreaks],
        },
        markdown,
      ),
    ),
};

const structure = (html: string) => html.replaceAll(/\s+/g, "");

describe.each(Object.entries(renderers))(
  "a block renders as itself (%s)",
  (_mode, render) => {
    it.each(Object.entries(all))("%s", (_name, markdown) => {
      const whole = render(markdown);
      const perBlock = splitMarkdownBlocks(markdown).map(render).join("");

      expect(structure(perBlock)).toBe(structure(whole));
    });
  },
);
