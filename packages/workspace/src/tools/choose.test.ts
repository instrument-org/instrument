import { describe, expect, it } from "vitest";

import { TOOLS } from "./all";

const input = { choices: ["React", "Vue"], question: "Which framework?" };

describe("choose", () => {
  it("tells the model a choice from an answer of the user's own, and passes on a note or a skip", () => {
    const outputs = [
      { selectedChoice: "Vue" },
      { selectedChoice: "Plain HTML" },
      { note: "The team knows it.", selectedChoice: "React" },
      { declined: true as const },
      { declined: true as const, note: "Ask design." },
    ];
    expect(
      outputs.map(
        (output) =>
          TOOLS.Choose.toModelOutput({ input, output, toolCallId: "test" })
            .value,
      ),
    ).toMatchInlineSnapshot(`
      [
        "User selected: Vue",
        "User answered in their own words: Plain HTML",
        "User selected: React
      Their note: The team knows it.",
        "The user skipped the question. Decide without the answer: take the likelier reading and say which, or say what you cannot do without it.",
        "The user skipped the question. Decide without the answer: take the likelier reading and say which, or say what you cannot do without it.
      Their note: Ask design.",
      ]
    `);
  });

  // What the card sends is checked against this schema before it reaches the
  // agent, so a blank answer or note has to be refused here.
  it.each([
    { selectedChoice: "  " },
    { note: " ", selectedChoice: "React" },
    { declined: false },
    {},
  ])("refuses %o as an answer", (output) => {
    expect(TOOLS.Choose.outputSchema.safeParse(output).success).toBe(false);
  });
});
