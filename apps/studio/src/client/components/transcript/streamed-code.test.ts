import { describe, expect, it } from "vitest";

import {
  type ColoredLines,
  STREAMED_CODE_MAX_CHARS,
  streamedCode,
} from "./streamed-code";

/**
 * A grammar whose colors depend on what came before, as a block comment's
 * do: each line is `c:` inside a comment the given code opened, else `x:`.
 */
function highlight(code: string): string[] {
  let isComment = false;
  return code.split("\n").map((line) => {
    if (line.includes("/*")) {
      isComment = true;
    }
    const marked = `${isComment ? "c" : "x"}:${line}`;
    if (line.includes("*/")) {
      isComment = false;
    }
    return marked;
  });
}

const plain = (line: string) => `plain:${line}`;

/** The spans for each successive text of a stream, carrying its colors on. */
function stream(...texts: string[]): string[][] {
  let colored: ColoredLines | undefined;
  return texts.map((text) => {
    const shown = streamedCode(colored, text, { highlight, plain });
    colored = shown?.colored;
    return shown?.spans ?? [];
  });
}

describe("code still arriving", () => {
  it("shows the line still arriving plain, and colors it once it is whole", () => {
    expect(stream("/* a", "/* a\nb */\nc", "/* a\nb */\nc\n"))
      .toMatchInlineSnapshot(`
      [
        [
          "plain:/* a",
        ],
        [
          "c:/* a",
          "c:b */",
          "plain:c",
        ],
        [
          "c:/* a",
          "c:b */",
          "x:c",
          "plain:",
        ],
      ]
    `);
  });

  it("keeps a line's colors when the start of the words moves past what set them", () => {
    // The window slides on: the comment's opening line drops off the top, which
    // would read the line after it as code if colored again.
    expect(stream("/* a\nb\nc */\n", "b\nc */\nd\n")).toMatchInlineSnapshot(`
      [
        [
          "c:/* a",
          "c:b",
          "c:c */",
          "plain:",
        ],
        [
          "c:b",
          "c:c */",
          "x:d",
          "plain:",
        ],
      ]
    `);
  });

  it("colors words that start over from scratch", () => {
    expect(stream("/* a\n", "x\n")).toMatchInlineSnapshot(`
      [
        [
          "c:/* a",
          "plain:",
        ],
        [
          "x:x",
          "plain:",
        ],
      ]
    `);
  });

  it("colors nothing past its cap", () => {
    expect(
      streamedCode(undefined, "a\n".repeat(STREAMED_CODE_MAX_CHARS), {
        highlight,
        plain,
      }),
    ).toBeUndefined();
  });

  it("keeps the same lines when nothing new is whole", () => {
    const first = streamedCode(undefined, "a\nb", { highlight, plain });
    const next = streamedCode(first?.colored, "a\nbc", { highlight, plain });
    expect(next?.colored).toBe(first?.colored);
  });
});
