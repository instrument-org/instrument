import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

import { numberedListsAfterText } from "./numbered-lists-after-text";

const html = (markdown: string) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm, remarkBreaks] },
      numberedListsAfterText(markdown),
    ),
  );

describe("numberedListsAfterText", () => {
  it("draws a list numbered on from an earlier section as a list", () => {
    expect(
      html(
        "**Change what the phone is**\n1. Delete apps.\n2. Grayscale.\n\n**Build friction**\n3. Downtime.\n4. Passcode.\n",
      ),
    ).toMatchInlineSnapshot(
      `"<p><strong>Change what the phone is</strong></p>
<ol>
<li>Delete apps.</li>
<li>Grayscale.</li>
</ol>
<p><strong>Build friction</strong></p>
<ol start="3">
<li>Downtime.</li>
<li>Passcode.</li>
</ol>"`,
    );
  });

  it.each([
    ["a year starting a wrapped line", "It ships in\n2026. Then more.\n"],
    ["a fence", "```\nnote\n6. not a list\n```\n"],
    ["a list item's lazy line", "5. Five\ncontinued\n6. Six\n"],
    ["an indented continuation", "5. Five\n   more\n6. Six\n"],
    ["a block quote", "> quoted\n6. after\n"],
    ["a table", "| a |\n| - |\n| 1 |\n6. after\n"],
    ["a document with no numbered line", "Just prose.\nMore prose.\n"],
  ])("leaves %s as it was", (_, markdown) => {
    expect(numberedListsAfterText(markdown)).toBe(markdown);
  });

  it("opens the list under a line of plain text too", () => {
    expect(numberedListsAfterText("Then these:\n6. Six\n7. Seven")).toBe(
      "Then these:\n\n6. Six\n7. Seven",
    );
  });
});
