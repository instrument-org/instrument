import { describe, expect, it } from "vitest";

import { stripMarkdown } from "./strip-markdown";

const cases: Record<string, string> = {
  blockquote: "> quoted line\n> another",
  emphasis: "**bold** and *italic* and _underline_",
  "fenced code block": "```ts\nconst x = 1\n```",
  headings: "# Heading\n## Subheading",
  "horizontal rule": "---\ntext below",
  image: "![alt text](https://example.com/img.png) caption",
  "inline code": "Run `npm install` then `build`",
  link: "See [the docs](https://example.com/path) here",
  "list markers": "- one\n- two\n* three\n1. four\n2) five",
  "loose asterisks preserved": "a * b * c and 2 * 3 = 6",
  mixed: "## Done\n\nUpdated **three** files and ran `pnpm test`.",
  "nested emphasis": "***everything*** together",
  "snake_case preserved": "keep some_snake_case_name intact",
  strikethrough: "~~struck~~ through",
};

describe("stripMarkdown", () => {
  it("strips markdown to plain text", () => {
    const output = Object.fromEntries(
      Object.entries(cases).map(([name, input]) => [
        name,
        stripMarkdown(input),
      ]),
    );
    expect(output).toMatchInlineSnapshot(`
      {
        "blockquote": "quoted line
      another",
        "emphasis": "bold and italic and underline",
        "fenced code block": "
      const x = 1
      ",
        "headings": "Heading
      Subheading",
        "horizontal rule": "
      text below",
        "image": " caption",
        "inline code": "Run npm install then build",
        "link": "See the docs here",
        "list markers": "one
      two
      three
      four
      five",
        "loose asterisks preserved": "a * b * c and 2 * 3 = 6",
        "mixed": "Done

      Updated three files and ran pnpm test.",
        "nested emphasis": "everything together",
        "snake_case preserved": "keep some_snake_case_name intact",
        "strikethrough": "struck through",
      }
    `);
  });
});
