import { describe, expect, it } from "vitest";

import { isDefaultGeneratedSessionTitle } from "./generate-session-title";

describe("isDefaultGeneratedSessionTitle", () => {
  it.each([
    ["Untitled chat", true],
    ["Untitled chat 2", true],
    ["Untitled chat 10", true],
    ["untitled chat", false],
    ["Untitled Chat", false],
    ["Untitled research", false],
    ["My project", false],
    ["2026-04-29 Chat", false],
    ["2026-04-29 Chat 2", false],
    ["2026-04-29 Chat 10", false],
    ["2026-4-29 Chat", false],
    ["2026-04-29", false],
    ["2026-04-29 Research", false],
  ])("(%s) -> %s", (title, expected) => {
    expect(isDefaultGeneratedSessionTitle(title)).toBe(expected);
  });
});
