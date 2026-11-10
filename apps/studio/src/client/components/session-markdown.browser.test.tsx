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
