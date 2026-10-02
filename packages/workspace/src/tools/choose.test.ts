import { describe, expect, it } from "vitest";

import { TOOLS } from "./all";

const input = { choices: ["React", "Vue"], question: "Which framework?" };

function modelText(
  output: ReturnType<typeof TOOLS.Choose.toModelOutput>,
): string | undefined {
  return output.type === "text" ? output.value : undefined;
}

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
      outputs.map((output) =>
        modelText(
          TOOLS.Choose.toModelOutput({ input, output, toolCallId: "test" }),
        ),
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

  it("reads a choice written with stray spaces as selected, since the answer is stored trimmed", () => {
    expect(
      modelText(
        TOOLS.Choose.toModelOutput({
          input: { ...input, choices: ["React ", "Vue"] },
          output: { selectedChoice: "React" },
          toolCallId: "test",
        }),
      ),
    ).toBe("User selected: React");
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
