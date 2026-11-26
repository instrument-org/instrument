import { describe, expect, it } from "vitest";

import { normalizeMathDelimiters } from "./normalize-math-delimiters";

describe("normalizeMathDelimiters", () => {
  it.each([
    ["two amounts", "Groceries ran $100 and $200 this month."],
    ["a range", "Lunches cost $5-$10 each."],
    ["an en dash range", "Lunches cost $5–$10 each."],
    ["a slash", "Plans are $5/$10 a month."],
    ["two choices", "It costs $5 or $10 depending on size."],
    ["amounts in a table", "| Lunch | $5 | $10 |"],
    ["amounts without spaces in a table", "|$5|$10|"],
    ["amounts with a scale", "Revenue went from $1.2M-$1.5M."],
    ["currencies with a country", "US$5 against CA$7"],
    ["a lone amount", "That leaves $590 of the budget."],
    ["escaped dollars", String.raw`Escape it: \$5 and \$10$`],
    ["inline code", "Run `echo $HOME/$USER` to see it."],
    ["a dollar that opens on a space", "It's $ 5 and $ 10."],
  ])("leaves %s as text", (_name, text) => {
    expect(normalizeMathDelimiters(text)).toBe(text);
  });

  it.each([
    ["an equation", "Solve $3x - 12 = 2x + 5$.", "Solve $$3x - 12 = 2x + 5$$."],
    [
      "several in a line",
      "So $x = 17$. Check: $3(17) - 12 = 39$ and $2(17) + 5 = 39$.",
      "So $$x = 17$$. Check: $$3(17) - 12 = 39$$ and $$2(17) + 5 = 39$$.",
    ],
    [
      "math beside an amount",
      "You pay $3 \\times 5 = 15$ dollars, so $15 total.",
      "You pay $$3 \\times 5 = 15$$ dollars, so $15 total.",
    ],
    [
      "parenthesized math",
      String.raw`The area is \(A = \pi r^2\), so`,
      String.raw`The area is $$A = \pi r^2$$, so`,
    ],
    [
      "math already in double dollars",
      "Then $$x^2$$ and $y$.",
      "Then $$x^2$$ and $$y$$.",
    ],
  ])("reads %s", (_name, text, expected) => {
    expect(normalizeMathDelimiters(text)).toBe(expected);
  });

  it("draws a line that is math whole as a display block", () => {
    expect(
      normalizeMathDelimiters(
        "Subtract:\n\n$$3x - 2x = 5 + 12$$\n\n> \\[ A = \\pi r^2 \\]",
      ),
    ).toMatchInlineSnapshot(`
      "Subtract:

      $$
      3x - 2x = 5 + 12
      $$

      > $$
      > A = \\pi r^2
      > $$"
    `);
  });

  it("reads bracket display math across lines", () => {
    expect(
      normalizeMathDelimiters(
        "so\n\n\\[\nA = \\pi \\cdot 4^2 = 16\\pi\n\\]\n\nand $x$",
      ),
    ).toMatchInlineSnapshot(`
      "so

      $$
      A = \\pi \\cdot 4^2 = 16\\pi
      $$

      and $$x$$"
    `);
  });

  it("leaves a display block's lines and fenced code as written", () => {
    const text =
      "$$\nx = $a$ + \\(b\\)\n$$\n\n```sh\necho $a$\n```\n\nThen $5 and $10.";
    expect(normalizeMathDelimiters(text)).toBe(text);
  });

  it("leaves a bracket inside a sentence as an escaped bracket", () => {
    const text = String.raw`Read a\[0\] first.`;
    expect(normalizeMathDelimiters(text)).toBe(text);
  });
});
