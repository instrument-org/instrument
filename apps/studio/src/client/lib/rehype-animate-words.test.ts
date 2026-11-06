import { describe, expect, it } from "vitest";

import { rehypeAnimateWords } from "./rehype-animate-words";

interface Node {
  children?: Node[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
  value?: string;
}

const element = (tagName: string, ...children: Node[]): Node => ({
  children,
  properties: {},
  tagName,
  type: "element",
});

const text = (value: string): Node => ({ type: "text", value });

const root = (...children: Node[]): Node => ({ children, type: "root" });

/** Words the transform wrapped read as `[word]`, everything else as it was. */
function show(node: Node): string {
  if (node.type === "text") {
    return node.value ?? "";
  }
  const inside = (node.children ?? []).map(show).join("");
  if (node.tagName === "span" && node.properties?.dataStreamWord === "") {
    return `[${inside}]`;
  }
  if (node.type === "root") {
    return inside;
  }
  const tagName = node.tagName ?? node.type;
  return `<${tagName}>${inside}</${tagName}>`;
}

const animate = (tree: Node): string => {
  rehypeAnimateWords()(tree);
  return show(tree);
};

describe("rehypeAnimateWords", () => {
  it("wraps each word and leaves the whitespace between them alone", () => {
    expect(
      animate(root(element("p", text("Reading the config file")))),
    ).toMatchInlineSnapshot(`"<p>[Reading] [the] [config] [file]</p>"`);
  });

  it("keeps the whitespace a paragraph ends on, so the next word has its gap", () => {
    expect(animate(root(element("p", text("Reading "))))).toMatchInlineSnapshot(
      `"<p>[Reading] </p>"`,
    );
  });

  it("descends through inline markup", () => {
    expect(
      animate(
        root(
          element(
            "p",
            text("Read "),
            element("strong", text("every file")),
            text(" twice"),
          ),
        ),
      ),
    ).toMatchInlineSnapshot(
      `"<p>[Read] <strong>[every] [file]</strong> [twice]</p>"`,
    );
  });

  it.each([
    { tagName: "code" },
    { tagName: "pre" },
    { tagName: "math" },
    { tagName: "svg" },
  ])(
    "leaves the text inside $tagName whole, since something downstream reads it",
    ({ tagName }) => {
      expect(animate(root(element(tagName, text("const x = 1"))))).toBe(
        `<${tagName}>const x = 1</${tagName}>`,
      );
    },
  );

  it("wraps headings the same as prose", () => {
    expect(
      animate(root(element("h2", text("What changed")))),
    ).toMatchInlineSnapshot(`"<h2>[What] [changed]</h2>"`);
  });

  it("leaves a node with no text of its own untouched", () => {
    expect(animate(root(element("hr")))).toMatchInlineSnapshot(`"<hr></hr>"`);
  });

  // The identity of a word already on screen is its index in the parent's
  // children, and that is what stops it animating a second time. Growing the
  // text may only append.
  it("gives a word the same position it had before the text grew", () => {
    const words = (markdown: string): string[] =>
      [
        ...animate(root(element("p", text(markdown)))).matchAll(/\[(.*?)\]/g),
      ].map(([, word]) => word ?? "");

    const before = words("Reading the");
    const after = words("Reading the config");
    expect(after.slice(0, before.length)).toEqual(before);
  });
});
