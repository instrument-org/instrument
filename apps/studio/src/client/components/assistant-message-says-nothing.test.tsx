import { describe, expect, it } from "vitest";

import { saysNothing } from "./assistant-message";

describe("saysNothing", () => {
  it.each([
    ["", true],
    ["  \n", true],
    ["```", true],
    ["```\n```", true],
    ["~~~", true],
    ["Example Domain from icann.org", false],
    ["```ts\nconst a = 1;\n```", false],
  ])("%j says nothing: %s", (text, nothing) => {
    expect(saysNothing(text)).toBe(nothing);
  });
});
