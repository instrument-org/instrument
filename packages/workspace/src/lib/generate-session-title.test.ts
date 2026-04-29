import { describe, expect, it } from "vitest";

import { isDefaultGeneratedSessionTitle } from "./generate-session-title";

describe("isDefaultGeneratedSessionTitle", () => {
  it.each([
    ["2026-04-29 Chat", true],
    ["2026-04-29 Chat 2", true],
    ["2026-04-29 Chat 10", true],
    ["2026-4-29 Chat", false],
    ["2026-04-29", false],
    ["My project", false],
    ["2026-04-29 Research", false],
  ])("(%s) -> %s", (title, expected) => {
    expect(isDefaultGeneratedSessionTitle(title)).toBe(expected);
  });
});
