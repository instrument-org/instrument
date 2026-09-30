import { describe, expect, it } from "vitest";

import { spaceBeforeFamily } from "./chatgpt";

describe("spaceBeforeFamily", () => {
  it.each([
    ["GPT-5.6-Luna", "GPT-5.6 Luna"],
    ["GPT-6-Astra", "GPT-6 Astra"],
    ["GPT-5.5", "GPT-5.5"],
    ["Codex Auto Review", "Codex Auto Review"],
  ])("%s reads as %s", (label, expected) => {
    expect(spaceBeforeFamily(label)).toBe(expected);
  });
});
