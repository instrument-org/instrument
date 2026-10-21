import { describe, expect, it } from "vitest";

import { splitFrontMatter } from "./front-matter";

describe("splitFrontMatter", () => {
  it.each([
    ["dashes", "---\na: 1\n---\nbody\n"],
    ["dots", "---\na: 1\n...\nbody\n"],
    ["trailing spaces", "--- \na: 1\n---  \nbody\n"],
    ["CRLF", "---\r\na: 1\r\nb: 2\r\n---\r\nbody\r\n"],
    ["a byte-order mark", "\uFEFF---\na: 1\n---\nbody\n"],
    ["an empty block", "---\n---\nbody\n"],
    ["a close at the end", "---\na: 1\n---"],
  ])("reads front matter with %s", (_name, text) => {
    const split = splitFrontMatter(text);
    expect(split.ok).toBe(true);
    expect(split.fm + split.body).toBe(text);
  });

  it("keeps the line after the opening fence in the block", () => {
    expect(splitFrontMatter("---\r\na: 1\r\nb: 2\r\n---\r\nbody"))
      .toMatchInlineSnapshot(`
      {
        "block": "
      a: 1
      b: 2",
        "body": "body",
        "fm": "---
      a: 1
      b: 2
      ---
      ",
        "ok": true,
      }
    `);
  });

  it.each([
    ["no fence", "body\n", "no-frontmatter"],
    ["a horizontal rule", "----\nbody\n", "no-frontmatter"],
    ["no close", "---\na: 1\nbody\n", "unterminated"],
    [
      "a close that is not the whole line",
      "---\na: 1\n--- x\nbody\n",
      "unterminated",
    ],
  ])("refuses %s", (_name, text, reason) => {
    expect(splitFrontMatter(text)).toEqual({
      body: text,
      fm: "",
      ok: false,
      reason,
    });
  });
});
