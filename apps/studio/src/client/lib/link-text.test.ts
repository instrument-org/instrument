import { describe, expect, it } from "vitest";

import { splitLinks } from "./link-text";

/** The segments as one readable string, so a case reads as what it renders. */
const shape = (text: string) =>
  splitLinks(text)
    .map((segment) =>
      segment.type === "text"
        ? segment.text
        : `<${segment.label} -> ${segment.href}>`,
    )
    .join("");

describe("splitLinks", () => {
  it("finds a Markdown link", () => {
    expect(shape("Check [the doc](https://example.com/a) first")).toBe(
      "Check <the doc -> https://example.com/a> first",
    );
  });

  it("finds a bare URL", () => {
    expect(shape("see https://example.com/a for more")).toBe(
      "see <https://example.com/a -> https://example.com/a> for more",
    );
  });

  it("finds an address, written either way", () => {
    expect(shape("ping neil@finalpoint.co about it")).toBe(
      "ping <neil@finalpoint.co -> mailto:neil@finalpoint.co> about it",
    );
    expect(shape("ping [Neil](mailto:neil@finalpoint.co)")).toBe(
      "ping <Neil -> mailto:neil@finalpoint.co>",
    );
  });

  // The end of a sentence is not part of the address it follows, and getting
  // this wrong is what makes an autolinked URL look broken.
  it.each([
    ["ends a sentence", "see https://example.com/a.", "."],
    ["ends a clause", "see https://example.com/a, then", ", then"],
    ["is quoted", "see https://example.com/a?", "?"],
  ])("leaves punctuation that %s outside the link", (_case, text, tail) => {
    expect(shape(text)).toBe(
      `see <https://example.com/a -> https://example.com/a>${tail}`,
    );
  });

  it("keeps a parenthesis the URL itself opened", () => {
    expect(shape("see https://example.com/Foo_(bar) now")).toBe(
      "see <https://example.com/Foo_(bar) -> https://example.com/Foo_(bar)> now",
    );
  });

  it("drops a parenthesis the sentence opened", () => {
    expect(shape("see (https://example.com/a) now")).toBe(
      "see (<https://example.com/a -> https://example.com/a>) now",
    );
  });

  // Nothing was written to click, so the brackets stay on screen as the typo
  // they are and the destination behind them is linked as the bare URL it is.
  it("links the destination of a Markdown link with no label", () => {
    expect(shape("see [](https://example.com/a)")).toBe(
      "see [](<https://example.com/a -> https://example.com/a>)",
    );
  });

  // The bare pass runs second precisely so it cannot reach inside one of these.
  it("does not re-split a Markdown link's own destination", () => {
    expect(shape("[https://example.com/a](https://example.com/b)")).toBe(
      "<https://example.com/a -> https://example.com/b>",
    );
  });

  it.each([
    ["a scheme it does not open", "see ftp://example.com/a"],
    ["a relative path", "see [the doc](output/report.md)"],
    ["prose that only looks like markup", "an [aside] (not a link)"],
    ["a path that is not an address", "src/lib/a@b"],
  ])("leaves %s as the text it is", (_case, text) => {
    expect(shape(text)).toBe(text);
  });

  it("keeps every link in a line with several", () => {
    expect(
      shape("[a](https://a.example) and b@c.example and https://d.example"),
    ).toBe(
      "<a -> https://a.example> and <b@c.example -> mailto:b@c.example> and <https://d.example -> https://d.example>",
    );
  });
});
