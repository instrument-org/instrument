import { describe, expect, it } from "vitest";

import { defaultTaskName } from "./default-task-name";

describe("defaultTaskName", () => {
  it("keeps a short prompt whole", () => {
    expect(defaultTaskName("Make me a quick csv")).toBe("Make me a quick csv");
  });

  it("cuts a long prompt at a word boundary", () => {
    expect(
      defaultTaskName(
        "Navigate to this page and then use just your abilities to summarize it",
      ),
    ).toMatchInlineSnapshot(`"Navigate to this page and then use just your…"`);
  });

  // No boundary to cut on, so the budget wins.
  it("cuts inside a single oversized word", () => {
    expect(defaultTaskName("a".repeat(60))).toBe(`${"a".repeat(50)}…`);
  });

  it("trims before measuring", () => {
    expect(defaultTaskName("   hey   ")).toBe("hey");
  });
});
