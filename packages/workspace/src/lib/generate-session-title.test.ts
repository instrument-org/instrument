import { describe, expect, it } from "vitest";

import { isUntitledChatSessionTitle } from "./generate-session-title";

describe("isUntitledChatSessionTitle", () => {
  it.each([
    ["Untitled chat", true],
    ["Untitled chat 10", true],
    ["untitled chat", false],
    ["Untitled research", false],
    ["Untitled chat notes", false],
    ["My Untitled chat", false],
  ])("(%s) -> %s", (title, expected) => {
    expect(isUntitledChatSessionTitle(title)).toBe(expected);
  });
});
