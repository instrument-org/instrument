import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";

import { SessionMarkdown } from "./session-markdown";

describe("a quote in a reply", () => {
  it("is upright, with no marks around its words", async () => {
    await renderInBrowser(
      <SessionMarkdown markdown={"> First line.\n>\n> Last line."} />,
    );

    const quote = document.querySelector("blockquote");
    const [first, second, ...rest] = quote?.querySelectorAll("p") ?? [];
    if (!quote || !first || !second || rest.length > 0) {
      throw new Error("expected a quote of two paragraphs");
    }

    expect(getComputedStyle(quote).fontStyle).toBe("normal");
    expect(getComputedStyle(first, "::before").content).toBe("none");
    expect(getComputedStyle(second, "::after").content).toBe("none");
    expect(
      Number.parseFloat(getComputedStyle(quote).borderInlineStartWidth),
    ).toBeGreaterThan(0);
  });
});

// A surface sets one text size and everything inside follows it. Anything
// that sets its own stays put when a card shrinks the text, and sticks out
// of the sentence around it.
describe("prose sized by its surface", () => {
  const DOCUMENT = [
    "# Title",
    "",
    "Open [Memory](instrument://settings/memory) to see it, or run `ls`.",
    "",
    "```",
    "ls -la",
    "```",
    "",
    "| Name | Size |",
    "| --- | --- |",
    "| a.md | 2 KB |",
  ].join("\n");

  const fontSizeOf = (selector: string) => {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`nothing matched ${selector}`);
    }
    return getComputedStyle(element).fontSize;
  };

  it.each([
    { body: "12px", code: "12px", size: "xs" },
    { body: "14px", code: "14px", size: "sm" },
    // A reply sets code and tables a step below its 15px.
    { body: "15px", code: "14px", size: "md" },
  ] as const)(
    "sets a chip at the sentence's size and code at $code in $size text",
    async ({ body, code, size }) => {
      await renderInBrowser(
        <SessionMarkdown headings="card" markdown={DOCUMENT} size={size} />,
      );

      expect(fontSizeOf("p")).toBe(body);
      const chip = [...document.querySelectorAll("p > span")].find(
        (element) => element.textContent === "Memory",
      );
      expect(chip && getComputedStyle(chip).fontSize).toBe(body);
      expect(fontSizeOf("pre")).toBe(code);
      expect(fontSizeOf("table")).toBe(code);
      expect(Number.parseFloat(fontSizeOf("h1"))).toBeLessThanOrEqual(
        Number.parseFloat(body) * 1.25,
      );
    },
  );
});

describe("a task list in a reply", () => {
  const boxOf = (item: Element) => {
    const box = item.querySelector<HTMLElement>("input[type=checkbox]");
    if (!box) {
      throw new Error("an item with no box");
    }
    return box;
  };

  // A list with a blank line between its items wraps each one's words in a
  // paragraph, box included.
  it.each([
    ["tight", "- [ ] Call the plumber\n- [x] Find the lease"],
    ["loose", "- [ ] Call the plumber\n\n- [x] Find the lease"],
  ])("has a box in place of each bullet, %s", async (_case, markdown) => {
    await renderInBrowser(<SessionMarkdown markdown={markdown} />);

    const [open, done, ...rest] = document.querySelectorAll("li");
    if (!open || !done || rest.length > 0) {
      throw new Error("expected two items");
    }

    for (const item of [open, done]) {
      const box = boxOf(item).getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(boxOf(item).parentElement ?? item);
      range.setStartAfter(boxOf(item));
      const words = range.getClientRects()[0];
      expect(getComputedStyle(item).listStyleType).toBe("none");
      expect(box.right).toBeLessThan(words?.left ?? 0);
      expect(
        Math.abs(
          (box.top + box.bottom) / 2 -
            ((words?.top ?? 0) + (words?.bottom ?? 0)) / 2,
        ),
      ).toBeLessThan(1.5);
    }
    expect(getComputedStyle(boxOf(done)).backgroundColor).not.toBe(
      getComputedStyle(boxOf(open)).backgroundColor,
    );
  });

  it("keeps the bullets of the items that have no box", async () => {
    await renderInBrowser(
      <SessionMarkdown markdown={"- [ ] Call\n- Plain\n  - Nested"} />,
    );

    expect(
      [...document.querySelectorAll("li")].map(
        (item) => getComputedStyle(item).listStyleType,
      ),
    ).toEqual(["none", "disc", "disc"]);
  });

  it("keeps a numbered item's number beside its box", async () => {
    await renderInBrowser(<SessionMarkdown markdown={"1. [x] Call"} />);

    const item = document.querySelector("li");
    if (!item) {
      throw new Error("no item");
    }
    expect(getComputedStyle(item).listStyleType).toBe("decimal");
    expect(getComputedStyle(boxOf(item)).position).toBe("static");
  });
});
