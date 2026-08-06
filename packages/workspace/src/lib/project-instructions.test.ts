import { describe, expect, it } from "vitest";

import { MAX_PROJECT_INSTRUCTIONS_LENGTH } from "../constants";
import { normalizeProjectInstructions } from "./project-instructions";

/** A paragraph of `body`, padded to exactly `length` characters. */
function paragraph(body: string, length: number): string {
  return body.padEnd(length, "x");
}

describe("normalizeProjectInstructions", () => {
  it.each([
    { expected: undefined, input: "", name: "empty" },
    { expected: undefined, input: "   \n\n  \t ", name: "whitespace only" },
    { expected: "Use British spelling.", input: "  Use British spelling.  \n", name: "padded" },
  ])("returns $expected for $name input", ({ expected, input }) => {
    expect(normalizeProjectInstructions(input)).toBe(expected);
  });

  it("passes instructions inside the budget through unchanged", () => {
    const instructions = "Use British spelling.\n\nNever commit to main.";
    expect(normalizeProjectInstructions(instructions)).toBe(instructions);
  });

  it("keeps everything at exactly the budget", () => {
    const exact = paragraph("Use British spelling.\n\n", MAX_PROJECT_INSTRUCTIONS_LENGTH);
    expect(normalizeProjectInstructions(exact)).toBe(exact);
  });

  it("cuts back to the last whole paragraph and says where the rest is", () => {
    const kept = paragraph("First rule.\n\n", MAX_PROJECT_INSTRUCTIONS_LENGTH - 100);
    const dropped = paragraph("Second rule.", 500);
    const result = normalizeProjectInstructions(`${kept}\n\n${dropped}`);

    expect(result).toContain("First rule.");
    expect(result).not.toContain("Second rule.");
    expect(result).toContain("/project/AGENTS.md");
    // The cut lands on the paragraph break, so the surviving text ends as a
    // whole paragraph rather than partway through the dropped one.
    expect(result?.startsWith(kept)).toBe(true);
  });

  it("appends the notice with a blank line before it", () => {
    const over = `Keep this.\n\n${"y".repeat(MAX_PROJECT_INSTRUCTIONS_LENGTH)}`;
    const result = normalizeProjectInstructions(over);
    expect(result).toMatchInlineSnapshot(`
      "Keep this.

      [Cut off here: these instructions are too long to include in full. The rest is in /project/AGENTS.md -- read that file if you need it.]"
    `);
  });

  // The paragraph rule has no break to cut back to here. Cutting to the last one
  // would land at the start of the document and send no instructions at all, so
  // this case has to fall through to the character count.
  it("falls back to the character count for a wall of text with no blank line", () => {
    const wall = "z".repeat(MAX_PROJECT_INSTRUCTIONS_LENGTH * 2);
    const result = normalizeProjectInstructions(wall);

    expect(result).toBeDefined();
    expect(result).toContain("z".repeat(1000));
    expect(result).toContain("/project/AGENTS.md");
  });

  it("keeps the retained text within the budget however it was cut", () => {
    for (const input of [
      "z".repeat(MAX_PROJECT_INSTRUCTIONS_LENGTH * 2),
      `${paragraph("A.\n\n", MAX_PROJECT_INSTRUCTIONS_LENGTH - 10)}\n\n${paragraph("B.", 900)}`,
      "line\n".repeat(MAX_PROJECT_INSTRUCTIONS_LENGTH),
    ]) {
      const result = normalizeProjectInstructions(input);
      const kept = result?.slice(0, result.indexOf("\n\n[Cut off here:"));
      expect(kept?.length).toBeLessThanOrEqual(MAX_PROJECT_INSTRUCTIONS_LENGTH);
    }
  });
});
