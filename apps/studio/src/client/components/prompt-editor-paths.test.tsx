import { describe, expect, it } from "vitest";

import { promptDocFromText } from "./prompt-editor-model";
import { pathDecorations } from "./prompt-editor-paths";

describe("pathDecorations", () => {
  it("tints the words of each path, on every line and past a skill", () => {
    const doc = promptDocFromText(
      "Use [$release](skill:release) on /Users/casey/app.ts\nand ~/Projects/site/ too",
    );
    const tinted = pathDecorations(doc, "darwin")
      .find()
      .filter((decoration) => decoration.from !== decoration.to)
      .map((decoration) =>
        doc.textBetween(decoration.from, decoration.to, "\n", "#"),
      );
    expect(tinted).toMatchInlineSnapshot(`
      [
        "/Users/casey/app.ts",
        "~/Projects/site/",
      ]
    `);
  });
});
