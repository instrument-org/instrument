import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";

import { SessionMarkdown } from "./session-markdown";

describe("a quote in a reply", () => {
  it("is upright, with no marks around its words", async () => {
    await renderInBrowser(
      <SessionMarkdown markdown={"> First line.\n>\n> Last line."} />,
    );

    const quote = document.querySelector("blockquote");
    const paragraphs = quote?.querySelectorAll("p");
    if (!quote || paragraphs?.length !== 2) {
      throw new Error("expected a quote of two paragraphs");
    }

    expect(getComputedStyle(quote).fontStyle).toBe("normal");
    expect(getComputedStyle(paragraphs[0], "::before").content).toBe("none");
    expect(getComputedStyle(paragraphs[1], "::after").content).toBe("none");
    expect(
      Number.parseFloat(getComputedStyle(quote).borderInlineStartWidth),
    ).toBeGreaterThan(0);
  });
});
