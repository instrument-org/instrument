import { describe, expect, it } from "vitest";

import { modelDisplayName } from "./model-display-name";

describe("modelDisplayName", () => {
  it.each([
    { expected: "Claude", id: "claude", name: " Claude" },
    { expected: "Claude Haiku 5.5", id: "anthropic/claude-haiku-5.5" },
    { expected: "GPT 6 Luna", id: "openai/gpt-6-luna", name: "  " },
    { expected: "Auto", id: "auto" },
    { expected: "", id: "" },
  ])("names $id as '$expected'", ({ expected, id, name }) => {
    expect(modelDisplayName(id, name)).toBe(expected);
  });
});
