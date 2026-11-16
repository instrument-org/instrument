import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";

import { SessionMarkdown } from "./session-markdown";

// Whatever opens or closes a reply sits flush with the reply's edges, so the
// row after it (the footer, the next turn) is spaced by its own layout alone.
// A nested block's margin that collapses out through its container shows up
// here as space between the drawn content and the row.
const EDGES = {
  paragraph: "Plain words.",
  quote: "> Canberra",
  "quote of two paragraphs": "> First.\n>\n> Last.",
  list: "- one\n- two",
  "ordered list": "1. one\n2. two",
  "loose list": "- one\n\n- two",
  "nested list": "- one\n  - inner",
  "list holding a quote": "- one\n\n  > quoted",
  "quote holding a list": "> - one\n> - two",
  "code block": "```\nls\n```",
  heading: "## Heading",
  rule: "---",
  "bold label": "**Label**",
};

const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |";

const measure = async (markdown: string) => {
  const { unmount } = await renderInBrowser(
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div data-testid="before" style={{ height: 1 }} />
      <SessionMarkdown markdown={markdown} />
      <div data-testid="after" style={{ height: 1 }} />
    </div>,
  );
  const before = document.querySelector('[data-testid="before"]');
  const after = document.querySelector('[data-testid="after"]');
  const content = before?.nextElementSibling;
  if (!before || !after || !content) {
    throw new Error("expected the reply between two rows");
  }
  // The drawn content's extent, leaving out what is placed outside the flow
  // (a table's hover controls), which may stand past it on purpose.
  let top = Infinity;
  let bottom = -Infinity;
  const visit = (element: Element) => {
    const { position } = getComputedStyle(element);
    if (position === "absolute" || position === "fixed") {
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.height > 0) {
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }
    for (const child of element.children) {
      visit(child);
    }
  };
  for (const child of content.children) {
    visit(child);
  }
  const drawn = { bottom, top };
  const gaps = {
    above: Math.round(drawn.top - before.getBoundingClientRect().bottom),
    below: Math.round(after.getBoundingClientRect().top - drawn.bottom),
  };
  await unmount();
  return gaps;
};

describe("a reply's edges", () => {
  it.each(Object.entries(EDGES))("%s", async (_, body) => {
    const opening = await measure(`${body}\n\nAfter.`);
    const closing = await measure(`Before.\n\n${body}`);
    expect({ above: opening.above, below: closing.below }).toEqual({
      above: 0,
      below: 0,
    });
  });

  // A table's hover toolbar stands above it, in the room its top margin
  // leaves, so only its bottom sits flush.
  it("table", async () => {
    const opening = await measure(`${TABLE}\n\nAfter.`);
    const closing = await measure(`Before.\n\n${TABLE}`);
    expect({ above: opening.above, below: closing.below }).toEqual({
      above: 28,
      below: 0,
    });
  });
});
